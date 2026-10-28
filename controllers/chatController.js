const mongoose = require("mongoose");
const ChatSession = require("../models/chatModel");
const ChatUsage = require("../models/chatUsageModel");
const User = require("../models/usersModel");
const { NETWORK_ERROR, INVALID_ID, NOT_FOUND } = require("../messages/message");
const { verifyIapPurchase } = require("../services/iapVerificationService");
const { getOpenAiClient } = require("../services/openAiKeyService");
const { getMergedKnowledgeText } = require("../services/knowledgeStoreService");
const {
  buildCareLimitConfig,
  computeUserIsPro,
  getCareChatLimitForUser,
  isGuestUser,
} = require("../services/careLimitService");
const STORE_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
const STORE_REFRESH_EXPIRY_WINDOW_MS = 24 * 60 * 60 * 1000;

// ── constants ──────────────────────────────────────────────────────────────

// Amazon recommends checking each active receipt with RVS within 72 hours.
// A transient failure (network error, throttling, 5xx, or bad server config)
// is not evidence the subscription is inactive, so we keep the last known
// entitlement until we've failed to reverify for longer than this window.
const STORE_VERIFY_GRACE_MS = 72 * 60 * 60 * 1000;

const CHAT_SYSTEM_PROMPT = `You are a health-tracking assistant embedded in the Blood Pressure & Sugar Tracker app.
Help users with:
- Understanding blood pressure, blood sugar, BMI, medications, and trend reports
- Interpreting tracked readings in plain language without diagnosing
- Encouraging safe follow-up with a qualified clinician for concerning values
- Explaining app features such as reports, full data access, reminders, and Premium limits
- Helping users build consistent logging habits

Be concise, practical, and friendly. Use plain language unless the user clearly wants technical depth.
Limit responses to 3–5 short paragraphs unless a longer explanation is genuinely needed.`;

const CARE_DATA_GUIDANCE = `Important safety and app guidance:
- Do not diagnose medical conditions or prescribe treatment. Encourage urgent care for severe symptoms or extremely abnormal readings.
- If the user asks for their readings, trends, reports, medication history, BMI, or glucose history, use only the in-app context provided below when it exists.
- If no app data is provided, explain how to check the relevant screen in the app instead of inventing readings.
- Free users have limited reports and full-data access; Premium removes ads and unlocks unlimited reports/full access.`;

function buildSystemPrompt(deviceContext) {
  if (!deviceContext || typeof deviceContext !== "string" || !deviceContext.trim()) {
    return `${CHAT_SYSTEM_PROMPT}

${CARE_DATA_GUIDANCE}`;
  }

  return `${CHAT_SYSTEM_PROMPT}

${CARE_DATA_GUIDANCE}

════════════════════════════════════════
LIVE HEALTH TRACKING DATA
════════════════════════════════════════
The Blood Pressure & Sugar Tracker app has provided the following in-app data with the user's consent. This is real, current app data — not hypothetical.

${deviceContext.trim()}

════════════════════════════════════════
HOW TO USE THIS DATA
════════════════════════════════════════
• NEVER say you cannot access the provided app data — you already have it above.
• Treat every value above as ground truth for this conversation.
• Refer to specific values such as blood pressure, blood sugar, BMI, medication, dates, and report summaries when present.
• Give targeted, personalised advice based on this exact setup rather than generic tips.
• If the user asks for a reading or trend that appears above, read the answer directly from the data above and state it clearly.`;
}

// ── helpers ────────────────────────────────────────────────────────────────

function isValidId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

/** Derive a session title from the first user message (max 60 chars). */
function deriveTitle(content) {
  const trimmed = content.trim();
  return trimmed.length <= 60 ? trimmed : trimmed.slice(0, 57).trimEnd() + "...";
}

async function getChatClient() {
  return getOpenAiClient();
}

function getModel() {
  return (process.env.OPENAI_MODEL || "gpt-4o-mini").trim();
}

function normalizeSubscriptionStatus(status) {
  const normalized = String(status || "inactive").toLowerCase();
  const allowed = new Set([
    "inactive",
    "active",
    "expired",
    "cancelled",
    "verify_failed",
    "unsupported",
  ]);
  if (normalized === "unsupported_platform") return "unsupported";
  return allowed.has(normalized) ? normalized : "inactive";
}

function isAmazonClient(req) {
  return false;
}

async function clearPremiumEntitlement(user, status = "inactive", source = "restore") {
  user.isPro = false;
  user.subscriptionPlan = "Free";
  user.subscription = {
    ...(user.subscription || {}),
    status: normalizeSubscriptionStatus(status),
    source,
    lastVerifiedAt: new Date(),
  };
  await user.save();
}

function shouldRefreshStoreSubscription(user, force = false) {
  if (force) return true;
  const subscription = user?.subscription || {};
  if (!["android", "amazon"].includes(subscription.platform)) return false;
  if (!subscription.productId || !subscription.purchaseToken) return false;
  if (subscription.platform === "amazon" && !subscription.storeUserId) return false;

  const now = Date.now();
  const lastVerifiedMs = subscription.lastVerifiedAt
    ? new Date(subscription.lastVerifiedAt).getTime()
    : 0;
  const expiresAtMs = subscription.expiresAt
    ? new Date(subscription.expiresAt).getTime()
    : 0;

  if (!lastVerifiedMs || now - lastVerifiedMs >= STORE_REFRESH_INTERVAL_MS) {
    return true;
  }
  return Boolean(expiresAtMs && expiresAtMs - now <= STORE_REFRESH_EXPIRY_WINDOW_MS);
}

async function applyStoreVerification(user, verification) {
  if (!verification.ok) {
    if (verification.retryable) {
      // Transient/configuration failure: never revoke on this alone. Keep the
      // last known entitlement until we've been unable to reverify for
      // longer than the grace window, then treat it as effectively expired.
      const subscription = user?.subscription || {};
      const lastVerifiedMs = subscription.lastVerifiedAt
        ? new Date(subscription.lastVerifiedAt).getTime()
        : 0;
      const withinGrace =
        Boolean(lastVerifiedMs) && Date.now() - lastVerifiedMs < STORE_VERIFY_GRACE_MS;

      if (withinGrace) {
        user.subscription = {
          ...subscription,
          lastVerifyAttemptAt: new Date(),
          lastVerifyError: verification.reason || verification.status || null,
        };
        await user.save();
        return;
      }
    }

    await clearPremiumEntitlement(
      user,
      verification.status || "verify_failed",
      verification.source || "google_play"
    );
    return;
  }

  user.isPro = true;
  user.subscriptionPlan = "Premium";
  user.subscription = {
    ...(user.subscription || {}),
    status: verification.status || "active",
    expiresAt: verification.expiresAt ? new Date(verification.expiresAt) : null,
    source: verification.source || "google_play",
    autoRenewing:
      typeof verification.autoRenewing === "boolean" ? verification.autoRenewing : null,
    isTrial: verification.isTrial === true,
    lastVerifiedAt: new Date(),
  };
  await user.save();
}

async function refreshStoredStoreSubscription(user, options = {}) {
  const force = options.force === true;
  const subscription = user?.subscription || {};
  if (!shouldRefreshStoreSubscription(user, force)) return null;

  try {
    const verification = await verifyIapPurchase({
      platform: subscription.platform,
      productId: subscription.productId,
      purchaseToken: subscription.purchaseToken,
      storeUserId: subscription.storeUserId,
    });
    await applyStoreVerification(user, verification);
    return verification;
  } catch (err) {
    console.warn("[chat entitlement] store refresh failed:", err.message);
    return null;
  }
}

async function ensureUsageCounter(user) {
  const stored = Number(user?.careUsage?.totalMessagesUsed || 0);
  const rows = await ChatSession.aggregate([
    { $match: { userId: user._id } },
    { $unwind: "$messages" },
    { $match: { "messages.role": "user" } },
    { $count: "count" },
  ]);
  const counted = Number(rows?.[0]?.count || 0);
  if (counted > stored) {
    user.careUsage = {
      totalMessagesUsed: counted,
      updatedAt: new Date(),
    };
    await user.save();
    return counted;
  }
  return stored;
}

async function buildEntitlement(user, options = {}) {
  const totalUsed = await ensureUsageCounter(user);
  const amazonUnlimited = options.amazonUnlimited === true;

  if (
    !amazonUnlimited &&
    computeUserIsPro(user) &&
    user?.subscription?.expiresAt &&
    new Date(user.subscription.expiresAt).getTime() <= Date.now()
  ) {
    await clearPremiumEntitlement(user, "expired", user.subscription?.source || "expiry_check");
  }

  const isPro = amazonUnlimited || computeUserIsPro(user);
  const isGuest = isGuestUser(user);
  const limit = amazonUnlimited ? null : getCareChatLimitForUser(user);
  return {
    isPro,
    isGuest,
    isUnlimited: isPro,
    freeLimit: limit,
    limit,
    limits: buildCareLimitConfig(),
    used: totalUsed,
    remaining: isPro ? null : Math.max(0, limit - totalUsed),
    hardLocked: !isPro && totalUsed >= limit,
    subscription: {
      plan: amazonUnlimited
        ? "Amazon"
        : user.subscriptionPlan || (isPro ? "Premium" : "Free"),
      status: amazonUnlimited
        ? "active"
        : user?.subscription?.status || (isPro ? "active" : "inactive"),
      productId: user?.subscription?.productId || null,
      platform: amazonUnlimited ? "amazon" : user?.subscription?.platform || "none",
      expiresAt: user?.subscription?.expiresAt || null,
      autoRenewing:
        typeof user?.subscription?.autoRenewing === "boolean"
          ? user.subscription.autoRenewing
          : null,
      isTrial: user?.subscription?.isTrial === true,
      lastVerifiedAt: user?.subscription?.lastVerifiedAt || null,
      source: amazonUnlimited ? "amazon" : user?.subscription?.source || "none",
    },
  };
}

async function handleGetCareLimits(req, res) {
  if (isAmazonClient(req)) {
    return res.json({
      success: true,
      limits: {
        guest: null,
        registered: null,
        pro: null,
        proLabel: "unlimited",
        amazon: null,
        amazonLabel: "unlimited",
      },
    });
  }
  return res.json({
    success: true,
    limits: buildCareLimitConfig(),
  });
}

async function callOpenAI(messages, deviceContext) {
  let client;
  try {
    client = await getChatClient();
  } catch (e) {
    throw e;
  }

  let systemPrompt = buildSystemPrompt(deviceContext);
  // Extra app knowledge curated in the admin hub (AI Learning). Best-effort:
  // a failure here must never break chat.
  try {
    const knowledgeText = (await getMergedKnowledgeText())?.trim();
    if (knowledgeText) {
      systemPrompt += `

════════════════════════════════════════
APP KNOWLEDGE BASE (maintained by the app team)
════════════════════════════════════════
Use this to answer questions about the app, its features, plans and policies. It does not override the safety rules above; never use it to diagnose or prescribe.

${knowledgeText}`;
    }
  } catch (err) {
    console.warn("[callOpenAI] knowledge base unavailable:", err.message);
  }
  console.log("[callOpenAI] model:", getModel());
  console.log("[callOpenAI] deviceContext provided:", !!deviceContext);
  console.log("[callOpenAI] system prompt length:", systemPrompt.length);
  console.log("[callOpenAI] system prompt:\n", systemPrompt);
  console.log("[callOpenAI] messages:", JSON.stringify(messages, null, 2));

  const completion = await client.chat.completions.create({
    model: getModel(),
    messages: [{ role: "system", content: systemPrompt }, ...messages],
    temperature: 0.7,
    max_tokens: 1024,
  });
  
  const reply = completion.choices?.[0]?.message?.content?.trim() || "";
  const usage = {
    promptTokens: Number(completion?.usage?.prompt_tokens) || 0,
    completionTokens: Number(completion?.usage?.completion_tokens) || 0,
    totalTokens: Number(completion?.usage?.total_tokens) || 0,
  };
  
  return { reply, usage };
}

// ── guest ──────────────────────────────────────────────────────────────────

/**
 * POST /api/chat/guest
 * Stateless: no auth, no history saved. Just calls AI and returns the reply.
 * Body: { messages: [{ role: "user"|"assistant", content: string }, ...] }
 */
async function handleGuestChat(req, res) {
  const { messages, deviceContext } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages array is required" });
  }

  const valid = ["user", "assistant"];
  for (const m of messages) {
    if (!valid.includes(m.role)) {
      return res.status(400).json({ error: `Invalid role "${m.role}"` });
    }
    if (typeof m.content !== "string" || !m.content.trim()) {
      return res.status(400).json({ error: "Each message must have non-empty content" });
    }
  }

  const payload = messages.map((m) => ({ role: m.role, content: m.content.trim() }));

  console.log("[chat guest] request — messages:", payload.length, "| deviceContext:", !!deviceContext);
  if (deviceContext) console.log("[chat guest] deviceContext:\n", deviceContext);

  let result;
  try {
    result = await callOpenAI(payload, deviceContext);
  } catch (err) {
    if (err.statusCode === 503) return res.status(503).json({ error: err.message });
    const msg = err?.error?.message || err?.message || "OpenAI request failed";
    console.error("[chat guest]", msg);
    return res.status(502).json({ error: msg });
  }

  const { reply, usage } = result;
  if (!reply) return res.status(502).json({ error: "Empty response from model" });
  
  // Track guest chat usage
  try {
    await ChatUsage.create({
      userId: null,
      sessionId: null,
      requestType: "guest",
      model: getModel(),
      usage,
    });
  } catch (usageErr) {
    console.error("[chat guest] usage tracking failed:", usageErr.message);
    // Don't fail the response if tracking fails
  }
  
  console.log("[chat guest] reply length:", reply.length);
  return res.json({ reply });
}

// ── authenticated respond ──────────────────────────────────────────────────

/**
 * POST /api/chat/respond   (requires JWT auth)
 * Send a user message, get AI reply, and persist both to the session.
 * Creates a new session if sessionId is omitted.
 * Body: { content: string, sessionId?: string }
 * Returns: { reply, sessionId, sessionTitle }
 */
async function handleRespond(req, res) {
  const userId = req.authUser._id;
  const content =
    typeof req.body.content === "string" ? req.body.content.trim() : "";
  if (!content) return res.status(400).json({ error: "content is required" });

  const sessionId = req.body.sessionId;
  const deviceContext =
    typeof req.body.deviceContext === "string" && req.body.deviceContext.trim()
      ? req.body.deviceContext.trim()
      : null;

  console.log("[chat respond] userId:", userId, "| sessionId:", sessionId, "| deviceContext:", !!deviceContext);
  if (deviceContext) console.log("[chat respond] deviceContext:\n", deviceContext);

  let user;
  try {
    user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: NOT_FOUND });
    if (user.isBanned) {
      return res.status(403).json({
        code: "ACCOUNT_BANNED",
        error: "Your account has been suspended. Please contact support.",
        bannedReason: user.bannedReason || "",
      });
    }

    const entitlement = await buildEntitlement(user, {
      amazonUnlimited: isAmazonClient(req),
    });
    if (entitlement.hardLocked) {
      const accountType = entitlement.isGuest ? "Guest" : "Free";
      return res.status(402).json({
        code: "CHAT_LIMIT_REACHED",
        error: `${accountType} chat limit reached. Upgrade to continue chatting.`,
        entitlement,
      });
    }
  } catch (err) {
    console.error("[chat respond] entitlement:", err);
    return res.status(500).json({ error: NETWORK_ERROR });
  }

  let session;
  try {
    if (sessionId) {
      if (!isValidId(sessionId)) return res.status(400).json({ error: INVALID_ID });
      session = await ChatSession.findOne({ _id: sessionId, userId });
      if (!session) return res.status(404).json({ error: NOT_FOUND });
    } else {
      session = await ChatSession.create({
        userId,
        title: deriveTitle(content),
        messages: [],
      });
    }
  } catch (err) {
    console.error("[chat respond] session fetch/create:", err);
    return res.status(500).json({ error: NETWORK_ERROR });
  }

  // Append user message
  session.messages.push({ role: "user", content });
  try {
    await session.save();
    user.careUsage = {
      totalMessagesUsed: Number(user?.careUsage?.totalMessagesUsed || 0) + 1,
      updatedAt: new Date(),
    };
    await user.save();
  } catch (err) {
    console.error("[chat respond] save user msg:", err);
    return res.status(500).json({ error: NETWORK_ERROR });
  }
  const updatedEntitlement = await buildEntitlement(user, {
    amazonUnlimited: isAmazonClient(req),
  });

  // Build OpenAI payload — cap at last 40 turns to stay within token limits
  const history = session.messages.slice(-40).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  let result;
  try {
    result = await callOpenAI(history, deviceContext);
  } catch (err) {
    if (err.statusCode === 503) return res.status(503).json({ error: err.message });
    const msg = err?.error?.message || err?.message || "OpenAI request failed";
    console.error("[chat respond] openai:", msg);
    return res.status(502).json({ error: msg });
  }

  const { reply, usage } = result;
  if (!reply) return res.status(502).json({ error: "Empty response from model" });

  // Append AI reply and persist
  session.messages.push({ role: "assistant", content: reply });
  try {
    await session.save();
  } catch (err) {
    console.error("[chat respond] save assistant msg:", err);
    // Reply was generated — still return it even if save failed
  }
  
  // Track chat usage for authenticated user
  try {
    await ChatUsage.create({
      userId,
      sessionId: session._id,
      requestType: "authenticated",
      model: getModel(),
      usage,
    });
    
    // Update user's total OpenAI usage stats
    if (userId) {
      await User.updateOne(
        { _id: userId },
        {
          $inc: {
            "openAiUsage.promptTokens": usage.promptTokens,
            "openAiUsage.completionTokens": usage.completionTokens,
            "openAiUsage.totalTokens": usage.totalTokens,
            "openAiUsage.requestCount": 1,
          },
          $set: {
            "openAiUsage.lastUsedAt": new Date(),
          },
        }
      );
    }
  } catch (usageErr) {
    console.error("[chat respond] usage tracking failed:", usageErr.message);
    // Don't fail the response if tracking fails
  }

  return res.json({
    reply,
    sessionId: session._id.toString(),
    sessionTitle: session.title,
    entitlement: updatedEntitlement,
  });
}

// ── session CRUD ───────────────────────────────────────────────────────────

/**
 * POST /api/chat/sessions
 * Create a new chat session, optionally seeded with a first message.
 * Body: { title?, firstMessage? }
 */
async function handleCreateSession(req, res) {
  const userId = req.authUser._id;
  const { title, firstMessage } = req.body;

  const messages = [];
  if (typeof firstMessage === "string" && firstMessage.trim()) {
    messages.push({ role: "user", content: firstMessage.trim() });
  }

  const resolvedTitle =
    typeof title === "string" && title.trim()
      ? title.trim()
      : messages.length
      ? deriveTitle(messages[0].content)
      : "New Chat";

  try {
    const session = await ChatSession.create({ userId, title: resolvedTitle, messages });
    return res.status(201).json(formatSession(session));
  } catch (err) {
    console.error("[chat create session]", err);
    return res.status(500).json({ error: NETWORK_ERROR });
  }
}

/**
 * GET /api/chat/sessions
 * List all sessions for the authenticated user (newest first, no messages).
 * Query: limit (1-100, default 50), skip (default 0)
 */
async function handleListSessions(req, res) {
  const userId = req.authUser._id;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
  const skip = Math.max(parseInt(req.query.skip, 10) || 0, 0);

  try {
    const [total, sessions] = await Promise.all([
      ChatSession.countDocuments({ userId }),
      ChatSession.find({ userId })
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .select("title createdAt updatedAt")
        .lean(),
    ]);

    return res.json({
      total,
      limit,
      skip,
      items: sessions.map((s) => ({
        id: s._id,
        title: s.title,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })),
    });
  } catch (err) {
    console.error("[chat list sessions]", err);
    return res.status(500).json({ error: NETWORK_ERROR });
  }
}

/**
 * GET /api/chat/sessions/:id
 * Get a single session with all its messages.
 */
async function handleGetSession(req, res) {
  const userId = req.authUser._id;
  const { id } = req.params;

  if (!isValidId(id)) return res.status(400).json({ error: INVALID_ID });

  try {
    const session = await ChatSession.findOne({ _id: id, userId }).lean();
    if (!session) return res.status(404).json({ error: NOT_FOUND });
    return res.json(formatSession(session));
  } catch (err) {
    console.error("[chat get session]", err);
    return res.status(500).json({ error: NETWORK_ERROR });
  }
}

/**
 * POST /api/chat/sessions/:id/messages
 * Append one or more messages to an existing session.
 * Body: { role, content } OR { messages: [{role, content}] }
 */
async function handleAddMessages(req, res) {
  const userId = req.authUser._id;
  const { id } = req.params;

  if (!isValidId(id)) return res.status(400).json({ error: INVALID_ID });

  let incoming = [];
  if (Array.isArray(req.body.messages)) {
    incoming = req.body.messages;
  } else if (typeof req.body.role === "string" && typeof req.body.content === "string") {
    incoming = [{ role: req.body.role, content: req.body.content }];
  }

  const valid = ["user", "assistant"];
  for (const msg of incoming) {
    if (!valid.includes(msg.role)) {
      return res.status(400).json({ error: `Invalid role "${msg.role}". Must be "user" or "assistant".` });
    }
    if (typeof msg.content !== "string" || !msg.content.trim()) {
      return res.status(400).json({ error: "content is required and must be a non-empty string" });
    }
  }

  if (incoming.length === 0) {
    return res.status(400).json({ error: "No messages provided" });
  }

  const newMessages = incoming.map((m) => ({ role: m.role, content: m.content.trim() }));

  try {
    const session = await ChatSession.findOneAndUpdate(
      { _id: id, userId },
      { $push: { messages: { $each: newMessages } } },
      { new: true }
    );
    if (!session) return res.status(404).json({ error: NOT_FOUND });
    return res.json(formatSession(session));
  } catch (err) {
    console.error("[chat add messages]", err);
    return res.status(500).json({ error: NETWORK_ERROR });
  }
}

/**
 * PATCH /api/chat/sessions/:id
 * Rename a session.
 * Body: { title: string }
 */
async function handleUpdateSession(req, res) {
  const userId = req.authUser._id;
  const { id } = req.params;

  if (!isValidId(id)) return res.status(400).json({ error: INVALID_ID });

  const title = typeof req.body.title === "string" ? req.body.title.trim() : null;
  if (!title) return res.status(400).json({ error: "title is required" });

  try {
    const session = await ChatSession.findOneAndUpdate(
      { _id: id, userId },
      { $set: { title } },
      { new: true }
    );
    if (!session) return res.status(404).json({ error: NOT_FOUND });
    return res.json(formatSession(session));
  } catch (err) {
    console.error("[chat update session]", err);
    return res.status(500).json({ error: NETWORK_ERROR });
  }
}

/**
 * DELETE /api/chat/sessions/:id
 * Permanently delete a session and all its messages.
 */
async function handleDeleteSession(req, res) {
  const userId = req.authUser._id;
  const { id } = req.params;

  if (!isValidId(id)) return res.status(400).json({ error: INVALID_ID });

  try {
    const result = await ChatSession.deleteOne({ _id: id, userId });
    if (result.deletedCount === 0) return res.status(404).json({ error: NOT_FOUND });
    return res.json({ success: true });
  } catch (err) {
    console.error("[chat delete session]", err);
    return res.status(500).json({ error: NETWORK_ERROR });
  }
}

// ── serialiser ─────────────────────────────────────────────────────────────

async function handleGetEntitlement(req, res) {
  try {
    const user = await User.findById(req.authUser._id);
    if (!user) return res.status(404).json({ error: NOT_FOUND });
    await refreshStoredStoreSubscription(user);
    return res.json({
      success: true,
      entitlement: await buildEntitlement(user, {
        amazonUnlimited: isAmazonClient(req),
      }),
    });
  } catch (err) {
    console.error("[chat entitlement]", err);
    return res.status(500).json({ error: "Failed to fetch entitlement" });
  }
}

async function handleVerifyIapPurchase(req, res) {
  try {
    const user = await User.findById(req.authUser._id);
    if (!user) return res.status(404).json({ error: NOT_FOUND });

    const {
      platform = "android",
      productId,
      purchaseToken,
      packageName,
      transactionId,
      storeUserId,
    } = req.body || {};

    if (!productId || !purchaseToken) {
      return res.status(400).json({
        error: "productId and purchaseToken are required",
        entitlement: await buildEntitlement(user),
      });
    }

    const verification = await verifyIapPurchase({
      platform,
      productId,
      purchaseToken,
      packageName,
      storeUserId,
    });

    if (!verification.ok) {
      await clearPremiumEntitlement(
        user,
        verification.status || "verify_failed",
        verification.source || "verify_failed"
      );
      return res.status(400).json({
        success: false,
        error: "Purchase verification failed",
        verification,
        entitlement: await buildEntitlement(user),
      });
    }

    user.subscription = {
      platform,
      productId,
      purchaseToken,
      storeUserId: storeUserId || null,
      originalTransactionId: transactionId || null,
      status: "inactive",
      expiresAt: null,
      source: "pending",
    };
    await applyStoreVerification(user, verification);

    return res.json({
      success: true,
      message: "Purchase verified and premium unlocked",
      verification,
      entitlement: await buildEntitlement(user),
    });
  } catch (err) {
    console.error("[chat verify iap]", err);
    return res.status(500).json({ error: "Failed to verify purchase" });
  }
}

async function handleClearPremiumAfterRestore(req, res) {
  try {
    const user = await User.findById(req.authUser._id);
    if (!user) return res.status(404).json({ error: NOT_FOUND });

    // The device reported no purchases to restore, but that alone is not
    // reliable (restore pagination gaps). If we have a previously stored
    // receipt, re-verify it directly with the store rather than trusting an
    // empty client-side result before revoking access.
    const hasStoredReceipt = Boolean(
      user?.subscription?.productId && user?.subscription?.purchaseToken
    );
    if (hasStoredReceipt) {
      const verification = await refreshStoredStoreSubscription(user, { force: true });
      if (!verification || verification.ok || verification.retryable) {
        return res.json({
          success: true,
          message: verification?.ok
            ? "Existing subscription is still active."
            : "Could not confirm restore; keeping existing entitlement.",
          entitlement: await buildEntitlement(user),
        });
      }
    }

    await clearPremiumEntitlement(user, "inactive", "restore_no_active_purchase");

    return res.json({
      success: true,
      message: "No active restored purchase found. Premium removed.",
      entitlement: await buildEntitlement(user),
    });
  } catch (err) {
    console.error("[chat clear premium after restore]", err);
    return res.status(500).json({ error: "Failed to clear premium after restore" });
  }
}

function formatSession(doc) {
  return {
    id: doc._id,
    title: doc.title,
    messages: (doc.messages || []).map((m) => ({
      id: m._id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
    })),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

module.exports = {
  handleGuestChat,
  handleGetCareLimits,
  handleRespond,
  handleCreateSession,
  handleListSessions,
  handleGetSession,
  handleAddMessages,
  handleUpdateSession,
  handleDeleteSession,
  handleGetEntitlement,
  handleVerifyIapPurchase,
  handleClearPremiumAfterRestore,
};
