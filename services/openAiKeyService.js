const OpenAI = require("openai");

// The OpenAI key lives in a separate key service so it can be rotated without
// redeploying every backend. Set ADMIN_TOKEN to use it; OPENAI_API_KEY is only
// a fallback (local dev, or the service being unreachable).
const KEY_SERVICE_URL =
  process.env.OPENAI_KEY_SERVICE_URL || "https://openaikeysecret.oxmite.com/api-key";
const FETCH_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = (Number(process.env.OPENAI_KEY_CACHE_SECONDS) || 300) * 1000;

let cachedKey = "";
let cachedAt = 0;
let inFlight = null;
let cachedClient = null;
let cachedClientKey = "";

async function fetchKeyFromService() {
  const response = await fetch(KEY_SERVICE_URL, {
    method: "GET",
    headers: { Authorization: `Bearer ${process.env.ADMIN_TOKEN}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch API key: ${response.status}`);
  }
  const key = (await response.text()).trim();
  if (!key) throw new Error("Key service returned an empty API key");
  return key;
}

/**
 * Returns the current OpenAI API key. Cached for a few minutes; if the key
 * service is down the last good key (or OPENAI_API_KEY) keeps chat working.
 * Throws an error with statusCode 503 when no key is available at all.
 */
async function getOpenAiApiKey() {
  const envKey = process.env.OPENAI_API_KEY?.trim() || "";

  if (!process.env.ADMIN_TOKEN) {
    if (envKey) return envKey;
    const err = new Error("OpenAI API key is not configured (set ADMIN_TOKEN or OPENAI_API_KEY)");
    err.statusCode = 503;
    throw err;
  }

  if (cachedKey && Date.now() - cachedAt < CACHE_TTL_MS) return cachedKey;

  try {
    // One request at a time, even if many chats arrive together.
    inFlight ??= fetchKeyFromService().finally(() => {
      inFlight = null;
    });
    cachedKey = await inFlight;
    cachedAt = Date.now();
    return cachedKey;
  } catch (e) {
    console.warn("[openai-key]", e.message);
    if (cachedKey) return cachedKey;
    if (envKey) return envKey;
    const err = new Error("OpenAI API key is unavailable");
    err.statusCode = 503;
    throw err;
  }
}

/** An OpenAI client for the current key (rebuilt automatically when the key rotates). */
async function getOpenAiClient() {
  const key = await getOpenAiApiKey();
  if (!cachedClient || cachedClientKey !== key) {
    cachedClient = new OpenAI({ apiKey: key });
    cachedClientKey = key;
  }
  return cachedClient;
}

module.exports = { getOpenAiApiKey, getOpenAiClient };
