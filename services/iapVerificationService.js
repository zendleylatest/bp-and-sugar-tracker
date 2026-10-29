const fs = require("fs");
const path = require("path");
const { JWT } = require("google-auth-library");

const GOOGLE_SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const DEFAULT_ANDROID_PACKAGE_NAME =
  "com.sugur.blood.playstore";
const AMAZON_RVS_PRODUCTION_URL = "https://appstore-sdk.amazon.com";
const AMAZON_RVS_SANDBOX_URL = "https://appstore-sdk.amazon.com/sandbox";
const ACTIVE_V2_STATES = new Set([
  "SUBSCRIPTION_STATE_ACTIVE",
  "SUBSCRIPTION_STATE_CANCELED",
  "SUBSCRIPTION_STATE_IN_GRACE_PERIOD",
]);

function strictVerifyEnabled() {
  return (
    process.env.IAP_ANDROID_STRICT_VERIFY === "1" ||
    process.env.IAP_ANDROID_STRICT_VERIFY === "true"
  );
}

/**
 * Parses a service account from raw env/file text. Accepts plain JSON, JSON
 * wrapped in quotes, or base64 of the JSON (easier to paste into hosting env
 * settings). Repairs a private_key whose newlines were flattened to a literal
 * "\\n" by the hosting UI, which otherwise makes signing fail.
 */
function parseServiceAccount(raw, label) {
  let text = String(raw || "").trim();
  if (!text) return null;
  if (
    (text.startsWith("'") && text.endsWith("'")) ||
    (text.startsWith('"') && text.endsWith('"') && !text.startsWith('"{"'))
  ) {
    text = text.slice(1, -1);
  }

  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch (_) {
    try {
      parsed = JSON.parse(Buffer.from(text, "base64").toString("utf8"));
    } catch (_) {
      console.warn(`[iapVerify] ${label} is neither valid JSON nor base64 JSON`);
      return null;
    }
  }
  if (parsed && typeof parsed.private_key === "string") {
    parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  }
  return parsed;
}

let cachedServiceAccount;
let cachedServiceAccountSource = "";

function loadGoogleServiceAccount() {
  if (cachedServiceAccount) return cachedServiceAccount;

  const candidates = [];
  if (process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON) {
    candidates.push({
      label: "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON",
      read: () => process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON,
    });
  }
  const explicitPath = (process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_PATH || "").trim();
  if (explicitPath) {
    candidates.push({
      label: `GOOGLE_PLAY_SERVICE_ACCOUNT_PATH (${explicitPath})`,
      // Relative paths resolve against the backend root, not the cwd.
      read: () => fs.readFileSync(path.resolve(__dirname, "..", explicitPath), "utf8"),
    });
  }
  const defaultPath = path.join(__dirname, "..", "google-play-service-account.json");
  candidates.push({
    label: "google-play-service-account.json",
    read: () => (fs.existsSync(defaultPath) ? fs.readFileSync(defaultPath, "utf8") : ""),
  });

  for (const c of candidates) {
    try {
      const sa = parseServiceAccount(c.read(), c.label);
      if (sa?.client_email && sa?.private_key) {
        cachedServiceAccount = sa;
        cachedServiceAccountSource = c.label;
        return sa;
      }
    } catch (e) {
      console.warn(`[iapVerify] Could not read ${c.label}:`, e.message);
    }
  }
  return null;
}

let cachedJwtClient = null;
let cachedJwtEmail = "";

async function getGoogleAccessToken() {
  const sa = loadGoogleServiceAccount();
  if (!sa?.client_email || !sa?.private_key) {
    throw new Error(
      "Google Play service account is missing (set GOOGLE_PLAY_SERVICE_ACCOUNT_JSON, " +
        "GOOGLE_PLAY_SERVICE_ACCOUNT_PATH, or add google-play-service-account.json)"
    );
  }

  // Reuse one client so its access token is cached until it expires.
  if (!cachedJwtClient || cachedJwtEmail !== sa.client_email) {
    cachedJwtClient = new JWT({
      email: sa.client_email,
      key: sa.private_key,
      scopes: [GOOGLE_SCOPE],
    });
    cachedJwtEmail = sa.client_email;
  }
  const { token } = await cachedJwtClient.getAccessToken();
  if (!token) throw new Error("Could not create Google Play access token");
  return token;
}

/**
 * Logs whether Google Play verification is usable. Call once at startup: it
 * signs in as the service account (no purchase needed), so a missing or broken
 * key shows up in the logs immediately instead of on a customer's purchase.
 */
async function logGooglePlayVerificationStatus() {
  const strict = strictVerifyEnabled();
  const sa = loadGoogleServiceAccount();
  if (!sa) {
    console.warn(
      `[iapVerify] Google Play service account NOT configured. ` +
        (strict
          ? "IAP_ANDROID_STRICT_VERIFY is on: Android purchases will be rejected."
          : "IAP_ANDROID_STRICT_VERIFY is off: Android purchases are accepted WITHOUT verification (fallback_dev).")
    );
    return;
  }
  try {
    await getGoogleAccessToken();
    console.log(
      `[iapVerify] Google Play verification ready (source=${cachedServiceAccountSource}, ` +
        `account=${sa.client_email}, strict=${strict}).`
    );
  } catch (e) {
    console.warn(
      `[iapVerify] Google Play service account found (${sa.client_email}) but sign-in failed: ${e.message}`
    );
  }
}

function buildAndroidSubscriptionResult(data) {
  const now = Date.now();
  const expiryMs = Number(data?.expiryTimeMillis || 0);
  const paymentState = data?.paymentState;
  const paymentOk =
    paymentState === undefined ||
    paymentState === null ||
    paymentState === 1 ||
    paymentState === 2 ||
    paymentState === 3;
  const active = expiryMs > now && paymentOk;

  return {
    ok: active,
    status: active ? "active" : "expired",
    expiresAt: expiryMs ? new Date(expiryMs).toISOString() : null,
    platform: "android",
    source: "google_play",
    autoRenewing: typeof data?.autoRenewing === "boolean" ? data.autoRenewing : null,
    // paymentState 2 = free trial.
    isTrial: paymentState === 2,
    payload: {
      paymentState,
      cancelReason: data?.cancelReason,
      autoRenewing: data?.autoRenewing,
      orderId: data?.orderId,
      priceCurrencyCode: data?.priceCurrencyCode,
      priceAmountMicros: data?.priceAmountMicros,
      countryCode: data?.countryCode,
      purchaseType: data?.purchaseType,
      acknowledgementState: data?.acknowledgementState,
      kind: data?.kind,
    },
  };
}

function parseTime(value) {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

function buildAndroidSubscriptionV2Result(data, productId) {
  const now = Date.now();
  const lineItems = Array.isArray(data?.lineItems) ? data.lineItems : [];
  const matchingLine =
    lineItems.find((item) => item?.productId === productId) || lineItems[0] || null;
  const expiryMs = Math.max(
    0,
    ...lineItems
      .map((item) => parseTime(item?.expiryTime))
      .filter((ms) => Number.isFinite(ms) && ms > 0)
  );
  const subscriptionState = data?.subscriptionState;
  const active = expiryMs > now && ACTIVE_V2_STATES.has(subscriptionState);
  const autoRenewingPlan = matchingLine?.autoRenewingPlan || null;

  return {
    ok: active,
    status: active ? "active" : "expired",
    expiresAt: expiryMs ? new Date(expiryMs).toISOString() : null,
    platform: "android",
    source: "google_play_v2",
    autoRenewing:
      typeof autoRenewingPlan?.autoRenewEnabled === "boolean"
        ? autoRenewingPlan.autoRenewEnabled
        : null,
    // The v2 payload has no simple trial flag; leave unknown rather than guess.
    isTrial: null,
    payload: {
      subscriptionState,
      acknowledgementState: data?.acknowledgementState,
      linkedPurchaseToken: data?.linkedPurchaseToken,
      regionCode: data?.regionCode,
      latestSuccessfulOrderId: matchingLine?.latestSuccessfulOrderId,
      productId: matchingLine?.productId,
      autoRenewEnabled: autoRenewingPlan?.autoRenewEnabled,
      planType: matchingLine?.autoRenewingPlan
        ? "auto_renewing"
        : matchingLine?.prepaidPlan
        ? "prepaid"
        : null,
      kind: data?.kind,
    },
  };
}

function amazonSandboxEnabled() {
  const value = String(process.env.AMAZON_RVS_SANDBOX || "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function amazonSharedSecret() {
  return (
    process.env.AMAZON_RVS_SHARED_SECRET ||
    process.env.AMAZON_DEVELOPER_SECRET ||
    ""
  ).trim();
}

function buildAmazonSubscriptionResult(data, productId, receiptId) {
  const cancelDateMs = Number(data?.cancelDate || 0);
  const renewalDateMs = Number(data?.renewalDate || 0);
  const purchaseDateMs = Number(data?.purchaseDate || 0);
  const now = Date.now();

  // Current Amazon RVS responses identify the SKU in `productId`. Some older/
  // legacy payloads reportedly used `sku` instead, so fall back to that only
  // when `productId` is absent from the response.
  const usedLegacySkuField = !data?.productId && Boolean(data?.sku);
  const responseProductId = data?.productId || data?.sku;

  const productMatches = Boolean(responseProductId) && responseProductId === productId;
  const receiptMatches = Boolean(data?.receiptId) && data.receiptId === receiptId;
  const isSubscription = data?.productType === "SUBSCRIPTION";
  const notCancelled = !cancelDateMs;
  const notExpired = !renewalDateMs || renewalDateMs > now;

  const identityValid = productMatches && receiptMatches && isSubscription;
  const active = identityValid && notCancelled && notExpired;

  let status;
  if (!identityValid) {
    status = "invalid";
  } else if (!active) {
    status = "expired";
  } else {
    status = "active";
  }

  return {
    ok: active,
    status,
    retryable: false,
    expiresAt: renewalDateMs ? new Date(renewalDateMs).toISOString() : null,
    platform: "amazon",
    source: "amazon_rvs",
    autoRenewing:
      typeof data?.autoRenewing === "boolean" ? data.autoRenewing : !cancelDateMs,
    isTrial: Number(data?.freeTrialEndDate || 0) > now,
    payload: {
      receiptId,
      productId: responseProductId,
      sku: data?.sku,
      usedLegacySkuField,
      productMatches,
      receiptMatches,
      productType: data?.productType,
      purchaseDate: purchaseDateMs ? new Date(purchaseDateMs).toISOString() : null,
      cancelDate: cancelDateMs ? new Date(cancelDateMs).toISOString() : null,
      renewalDate: renewalDateMs ? new Date(renewalDateMs).toISOString() : null,
      autoRenewing: data?.autoRenewing,
      term: data?.term,
      betaProduct: data?.betaProduct,
      testTransaction: data?.testTransaction,
    },
  };
}

async function verifyAmazonPurchase({ productId, purchaseToken, storeUserId }) {
  const secret = amazonSharedSecret();
  if (!secret) {
    const err = new Error("Amazon RVS shared secret is missing");
    err.retryable = true; // configuration problem, not proof the subscription is inactive
    throw err;
  }
  if (!productId || !purchaseToken || !storeUserId) {
    const err = new Error("Missing productId/purchaseToken/storeUserId");
    err.retryable = true;
    throw err;
  }

  const baseUrl = amazonSandboxEnabled()
    ? AMAZON_RVS_SANDBOX_URL
    : AMAZON_RVS_PRODUCTION_URL;
  const url = `${baseUrl}/version/1.0/verifyReceiptId/developer/${encodeURIComponent(
    secret
  )}/user/${encodeURIComponent(storeUserId)}/receiptId/${encodeURIComponent(
    purchaseToken
  )}`;

  let response;
  try {
    response = await fetch(url, { headers: { Accept: "application/json" } });
  } catch (e) {
    const err = new Error(`Amazon RVS request failed: ${e.message}`);
    err.retryable = true;
    throw err;
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data?.message || `Amazon RVS verify failed (${response.status})`);
    err.httpStatus = response.status;
    // 400/404/410 are Amazon's documented invalid/cancelled/not-found receipt
    // responses — treat those as definitive. Throttling (429), server errors
    // (5xx), and anything else unexpected are transient/configuration issues
    // that must not be treated as proof the subscription is inactive.
    err.retryable = !(
      response.status === 400 ||
      response.status === 404 ||
      response.status === 410
    );
    throw err;
  }

  return buildAmazonSubscriptionResult(data, productId, purchaseToken);
}

async function verifyAndroidPurchase({ packageName, productId, purchaseToken }) {
  if (!packageName || !productId || !purchaseToken) {
    throw new Error("Missing packageName/productId/purchaseToken");
  }

  const accessToken = await getGoogleAccessToken();

  const v2Url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(
    packageName
  )}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;

  const v2Response = await fetch(v2Url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const v2Data = await v2Response.json().catch(() => ({}));
  if (v2Response.ok) {
    return buildAndroidSubscriptionV2Result(v2Data, productId);
  }

  console.warn(
    "[iapVerify] subscriptionsv2 failed; trying legacy endpoint:",
    v2Data?.error?.message || v2Response.status
  );

  const legacyUrl = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(
    packageName
  )}/purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(
    purchaseToken
  )}`;

  const response = await fetch(legacyUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || `Google Play verify failed (${response.status})`);
  }
  return buildAndroidSubscriptionResult(data);
}

async function verifyIapPurchase({
  platform,
  productId,
  purchaseToken,
  packageName,
  storeUserId,
}) {
  if (platform === "amazon") {
    try {
      return await verifyAmazonPurchase({ productId, purchaseToken, storeUserId });
    } catch (e) {
      console.warn("[iapVerify] Amazon verification failed:", e.message);
      // Default to retryable when unclassified: an unexpected error is never
      // proof that a subscription is inactive, so it must not revoke access.
      const retryable = e.retryable !== false;
      return {
        ok: false,
        status: retryable ? "verify_failed" : "invalid",
        retryable,
        platform: "amazon",
        source: "amazon_rvs",
        expiresAt: null,
        payload: {},
        reason: e.message,
      };
    }
  }

  if (platform !== "android") {
    return {
      ok: false,
      status: "unsupported_platform",
      platform,
      source: "none",
      expiresAt: null,
      payload: {},
      reason: "Only android verification is implemented on this backend",
    };
  }

  const appPackage =
    packageName || process.env.ANDROID_PACKAGE_NAME || DEFAULT_ANDROID_PACKAGE_NAME;
  try {
    return await verifyAndroidPurchase({
      packageName: appPackage,
      productId,
      purchaseToken,
    });
  } catch (e) {
    const strict = strictVerifyEnabled();
    console.warn("[iapVerify] Android verification failed:", e.message);
    if (strict) {
      return {
        ok: false,
        status: "verify_failed",
        retryable: true,
        platform: "android",
        source: "google_play",
        expiresAt: null,
        payload: {},
        reason: e.message,
      };
    }

    return {
      ok: Boolean(purchaseToken && productId),
      status: purchaseToken && productId ? "active" : "verify_failed",
      platform: "android",
      source: "fallback_dev",
      expiresAt: null,
      payload: { warning: "strict verification disabled" },
      reason: "Strict verification disabled; using fallback",
    };
  }
}

module.exports = {
  verifyIapPurchase,
  logGooglePlayVerificationStatus,
  buildAmazonSubscriptionResult,
};
