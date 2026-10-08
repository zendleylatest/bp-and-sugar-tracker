const mongoose = require("mongoose");
const OpenAI = require("openai");
const PromptGeneration = require("../models/promptGenerationModel");
const User = require("../models/usersModel");
const { getUser } = require("../services/userAuthService");
const { NETWORK_ERROR, INPUT_REQUIRED, INVALID_ID, NOT_FOUND } = require("../messages/message");

const SYSTEM_PROMPT = `You are an expert prompt engineer. Your task is to convert structured user inputs into a high-quality,
 ready-to-use AI prompt.

IMPORTANT:
- The output must be a prompt that instructs another AI to generate the final content.
- Do NOT generate the final content itself.
- Do NOT make assumptions or add information that is not explicitly provided.

You will receive the following inputs:
- Deliverable / Output Type (what the user wants to create)
- Topic / Idea
- Target Audience
- Goal
- Tone
- Additional Instructions (optional)
- Detail Level (Short / Medium / Detailed)

Instructions:
1. Generate a clear, structured prompt using ALL provided inputs.
2. Always include:
   - Role (e.g., "Act as an expert...")
   - Clear task definition
   - Context (topic + audience)
   - Goal or intent
   - Tone/style guidance
   - Any additional user instructions
3. Adjust prompt complexity based on Detail Level:
   - Short → concise and minimal
   - Medium → balanced structure with moderate detail
   - Detailed → highly structured with explicit instructions and clarity
4. Ensure the prompt is clear, specific, and optimized for AI output quality.
5. Do NOT include explanations, titles, or extra text. 
6. ⁠Output only the final prompt.`;

function getClient() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    const err = new Error("OPENAI_API_KEY is not configured");
    err.statusCode = 503;
    throw err;
  }
  return new OpenAI({ apiKey: key });
}

function buildUserMessage(body) {
  const input = typeof body.input === "string" ? body.input.trim() : "";
  const extra = typeof body.context === "string" ? body.context.trim() : "";
  if (!input) return "";
  if (!extra) return input;
  return `Idea:\n${input}\n\nExtra context or constraints:\n${extra}`;
}

async function resolveAuthContext(req) {
  if (req.authUser?._id) {
    return {
      userId: req.authUser._id.toString(),
      email: req.authUser.email ? req.authUser.email.toString().trim().toLowerCase() : null,
      isBanned: !!req.authUser.isBanned,
      user: req.authUser,
    };
  }

  const raw = req.headers.authorization || "";
  if (!raw.startsWith("Bearer ")) return { userId: null, email: null, isBanned: false, user: null };
  const token = raw.replace("Bearer ", "").trim();
  if (!token) return { userId: null, email: null, isBanned: false, user: null };
  try {
    const decoded = getUser(token);
    const user = decoded?._id ? await User.findById(decoded._id) : null;
    return {
      userId: user?._id ? user._id.toString() : decoded?._id ? decoded._id.toString() : null,
      email: user?.email
        ? user.email.toString().trim().toLowerCase()
        : decoded?.email
        ? decoded.email.toString().trim().toLowerCase()
        : null,
      isBanned: !!user?.isBanned,
      user,
    };
  } catch (_) {
    return { userId: null, email: null, isBanned: false, user: null };
  }
}

async function handleGeneratePrompt(req, res) {
  const userContent = buildUserMessage(req.body);
  if (!userContent) {
    return res.status(400).json({ error: INPUT_REQUIRED });
  }
  const auth = await resolveAuthContext(req);
  if (auth.isBanned) {
    return res.status(403).json({
      error: "Your account is banned. Prompt generation is disabled.",
      bannedReason: auth.user?.bannedReason || "",
    });
  }

  const model = (process.env.OPENAI_MODEL || "gpt-4o-mini").trim();

  let client;
  try {
    client = getClient();
  } catch (e) {
    return res.status(e.statusCode || 503).json({ error: e.message });
  }

  let generatedPrompt;
  let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  try {
    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      temperature: 0.7,
    });
    generatedPrompt = completion.choices?.[0]?.message?.content?.trim() || "";
    usage = {
      promptTokens: Number(completion?.usage?.prompt_tokens) || 0,
      completionTokens: Number(completion?.usage?.completion_tokens) || 0,
      totalTokens: Number(completion?.usage?.total_tokens) || 0,
    };
  } catch (err) {
    const msg =
      err?.response?.data?.error?.message ||
      err?.error?.message ||
      err?.message ||
      "OpenAI request failed";
    console.error("[prompt generate]", msg, err?.stack);
    return res.status(502).json({ error: msg });
  }

  if (!generatedPrompt) {
    return res.status(502).json({ error: "Empty response from model" });
  }

  try {
    const doc = await PromptGeneration.create({
      userId: auth.userId,
      generatedBy: auth.email || "",
      input: typeof req.body.input === "string" ? req.body.input.trim() : userContent,
      generatedPrompt,
      model,
      usage,
    });

    if (auth.userId) {
      try {
        await User.updateOne(
          { _id: auth.userId },
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
      } catch (usageErr) {
        console.error("[prompt usage update] failed:", usageErr.message);
      }
    }

    return res.status(201).json({
      id: doc._id,
      generatedBy: doc.generatedBy,
      input: doc.input,
      generatedPrompt: doc.generatedPrompt,
      model: doc.model,
      usage: doc.usage,
      createdAt: doc.createdAt,
    });
  } catch (err) {
    console.error("[prompt save]", err);
    return res.status(500).json({ error: NETWORK_ERROR });
  }
}

async function handleListPrompts(req, res) {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
  const skip = Math.max(parseInt(req.query.skip, 10) || 0, 0);
  const authUserId = req.authUser?._id;
  if (!authUserId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const query = { userId: authUserId };

  try {
    const [total, rows] = await Promise.all([
      PromptGeneration.countDocuments(query),
      PromptGeneration.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select("input generatedPrompt model generatedBy createdAt updatedAt")
        .lean(),
    ]);

    return res.json({
      total,
      limit,
      skip,
      items: rows.map((row) => ({
        id: row._id,
        generatedBy: row.generatedBy || "",
        input: row.input,
        generatedPrompt: row.generatedPrompt,
        model: row.model,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: NETWORK_ERROR });
  }
}

async function handleGetPrompt(req, res) {
  const { id } = req.params;
  const authUserId = req.authUser?._id;
  if (!authUserId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: INVALID_ID });
  }

  try {
    const row = await PromptGeneration.findOne({
      _id: id,
      userId: authUserId,
    }).lean();
    if (!row) {
      return res.status(404).json({ error: NOT_FOUND });
    }
    return res.json({
      id: row._id,
      generatedBy: row.generatedBy || "",
      input: row.input,
      generatedPrompt: row.generatedPrompt,
      model: row.model,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: NETWORK_ERROR });
  }
}

module.exports = {
  handleGeneratePrompt,
  handleListPrompts,
  handleGetPrompt,
};
