const fs = require("fs");
const path = require("path");

let cachedAdmin = null;

function normalizeServiceAccount(raw) {
  if (!raw || typeof raw !== "object") {
    return raw;
  }

  const normalized = { ...raw };
  if (typeof normalized.private_key === "string") {
    let key = normalized.private_key.trim();
    if (
      (key.startsWith('"') && key.endsWith('"')) ||
      (key.startsWith("'") && key.endsWith("'"))
    ) {
      key = key.slice(1, -1);
    }
    // Common .env format has escaped newlines (\n); Firebase needs real newlines.
    normalized.private_key = key.replace(/\\n/g, "\n");
  }

  return normalized;
}

function parseServiceAccountFromJson(rawJson, label) {
  if (!rawJson || typeof rawJson !== "string") {
    return null;
  }
  try {
    const parsed = JSON.parse(rawJson);
    return normalizeServiceAccount(parsed);
  } catch (error) {
    console.error(`[firebase] Invalid ${label} JSON:`, error.message);
    return null;
  }
}

function parseServiceAccountFromBase64(rawBase64, label) {
  if (!rawBase64 || typeof rawBase64 !== "string") {
    return null;
  }
  try {
    const decoded = Buffer.from(rawBase64, "base64").toString("utf8");
    const parsed = JSON.parse(decoded);
    return normalizeServiceAccount(parsed);
  } catch (error) {
    console.error(`[firebase] Invalid ${label} base64 JSON:`, error.message);
    return null;
  }
}

function resolveServiceAccountFilePaths() {
  const configuredPath = (process.env.FIREBASE_SERVICE_ACCOUNT_PATH || "").trim();

  const candidates = [];
  if (configuredPath) {
    candidates.push(
      path.isAbsolute(configuredPath)
        ? configuredPath
        : path.resolve(process.cwd(), configuredPath)
    );
  }
  candidates.push(path.resolve(process.cwd(), "firebase-service-account.json"));
  return Array.from(new Set(candidates));
}

function readServiceAccountFromFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const content = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(content);
    return normalizeServiceAccount(parsed);
  } catch (error) {
    console.error(`[firebase] Failed to parse service account file (${filePath}):`, error.message);
    return null;
  }
}

function resolveServiceAccountCandidates() {
  const candidates = [];

  for (const filePath of resolveServiceAccountFilePaths()) {
    const fromFile = readServiceAccountFromFile(filePath);
    if (fromFile) {
      candidates.push({
        source: `file:${filePath}`,
        value: fromFile,
      });
    }
  }

  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT;
  if (rawJson) {
    const parsedJson = parseServiceAccountFromJson(rawJson, "FIREBASE_SERVICE_ACCOUNT_JSON/FIREBASE_SERVICE_ACCOUNT");
    if (parsedJson) {
      candidates.push({
        source: "env-json",
        value: parsedJson,
      });
    }
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const parsedBase64 = parseServiceAccountFromBase64(
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
      "FIREBASE_SERVICE_ACCOUNT_JSON"
    );
    if (parsedBase64) {
      candidates.push({
        source: "env-base64",
        value: parsedBase64,
      });
    }
  }

  return candidates;
}

function ensureFirebaseAdmin() {
  if (cachedAdmin) {
    return cachedAdmin;
  }

  let admin;
  try {
    admin = require("firebase-admin");
  } catch (_) {
    return null;
  }

  if (admin.apps && admin.apps.length > 0) {
    cachedAdmin = admin;
    return cachedAdmin;
  }

  const serviceAccountCandidates = resolveServiceAccountCandidates();
  if (!serviceAccountCandidates.length) {
    console.warn("[firebase] No service account found. Set FIREBASE_SERVICE_ACCOUNT_PATH, FIREBASE_SERVICE_ACCOUNT_JSON, FIREBASE_SERVICE_ACCOUNT, or add firebase-service-account.json");
    return null;
  }

  for (const candidate of serviceAccountCandidates) {
    try {
      admin.initializeApp({
        credential: admin.credential.cert(candidate.value),
      });
      cachedAdmin = admin;
      console.log(`[firebase] initialized from ${candidate.source}`);
      return cachedAdmin;
    } catch (error) {
      console.error(`[firebase] initializeApp failed for ${candidate.source}:`, error.message);
    }
  }
  return null;
}

module.exports = {
  ensureFirebaseAdmin,
};
