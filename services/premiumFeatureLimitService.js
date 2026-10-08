const { computeUserIsPro, isGuestUser } = require("./careLimitService");

function parseLimit(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

const GUEST_REPORT_LIMIT = parseLimit(process.env.GUEST_REPORT_LIMIT, 2);
const GUEST_FULL_DATA_ACCESS_LIMIT = parseLimit(
  process.env.GUEST_FULL_DATA_ACCESS_LIMIT,
  2
);
const GUEST_BMI_ENTRY_LIMIT = parseLimit(process.env.GUEST_BMI_ENTRY_LIMIT, 2);
const GUEST_BLOOD_PRESSURE_ENTRY_LIMIT = parseLimit(
  process.env.GUEST_BLOOD_PRESSURE_ENTRY_LIMIT,
  2
);
const GUEST_BLOOD_GLUCOSE_ENTRY_LIMIT = parseLimit(
  process.env.GUEST_BLOOD_GLUCOSE_ENTRY_LIMIT,
  2
);
const REGISTERED_REPORT_LIMIT = parseLimit(
  process.env.REGISTERED_REPORT_LIMIT || process.env.FREE_REPORT_LIMIT,
  5
);
const REGISTERED_FULL_DATA_ACCESS_LIMIT = parseLimit(
  process.env.REGISTERED_FULL_DATA_ACCESS_LIMIT ||
    process.env.FREE_FULL_DATA_ACCESS_LIMIT,
  5
);
const REGISTERED_BMI_ENTRY_LIMIT = parseLimit(
  process.env.REGISTERED_BMI_ENTRY_LIMIT,
  5
);
const REGISTERED_BLOOD_PRESSURE_ENTRY_LIMIT = parseLimit(
  process.env.REGISTERED_BLOOD_PRESSURE_ENTRY_LIMIT,
  5
);
const REGISTERED_BLOOD_GLUCOSE_ENTRY_LIMIT = parseLimit(
  process.env.REGISTERED_BLOOD_GLUCOSE_ENTRY_LIMIT,
  5
);

const FEATURE_CONFIG = {
  reports: {
    field: "reportsUsed",
    guestLimit: GUEST_REPORT_LIMIT,
    registeredLimit: REGISTERED_REPORT_LIMIT,
  },
  fullDataAccess: {
    field: "fullDataAccessUsed",
    guestLimit: GUEST_FULL_DATA_ACCESS_LIMIT,
    registeredLimit: REGISTERED_FULL_DATA_ACCESS_LIMIT,
  },
  bmiEntries: {
    field: "bmiEntriesUsed",
    guestLimit: GUEST_BMI_ENTRY_LIMIT,
    registeredLimit: REGISTERED_BMI_ENTRY_LIMIT,
  },
  bloodPressureEntries: {
    field: "bloodPressureEntriesUsed",
    guestLimit: GUEST_BLOOD_PRESSURE_ENTRY_LIMIT,
    registeredLimit: REGISTERED_BLOOD_PRESSURE_ENTRY_LIMIT,
  },
  bloodGlucoseEntries: {
    field: "bloodGlucoseEntriesUsed",
    guestLimit: GUEST_BLOOD_GLUCOSE_ENTRY_LIMIT,
    registeredLimit: REGISTERED_BLOOD_GLUCOSE_ENTRY_LIMIT,
  },
};

function normalizeFeature(feature) {
  const normalized = String(feature || "").trim();
  return FEATURE_CONFIG[normalized] ? normalized : null;
}

function usageFor(user, feature) {
  const config = FEATURE_CONFIG[feature];
  return Number(user?.premiumFeatureUsage?.[config.field] || 0);
}

function buildFeatureState(user, feature) {
  const isPro = computeUserIsPro(user);
  const config = FEATURE_CONFIG[feature];
  const used = usageFor(user, feature);
  const limit = isGuestUser(user) ? config.guestLimit : config.registeredLimit;
  return {
    used,
    limit,
    remaining: isPro ? null : Math.max(0, limit - used),
    hardLocked: !isPro && used >= limit,
  };
}

function buildPremiumFeatureLimits(user) {
  const isPro = computeUserIsPro(user);
  const guestLimits = Object.fromEntries(
    Object.entries(FEATURE_CONFIG).map(([feature, config]) => [
      feature,
      config.guestLimit,
    ])
  );
  const registeredLimits = Object.fromEntries(
    Object.entries(FEATURE_CONFIG).map(([feature, config]) => [
      feature,
      config.registeredLimit,
    ])
  );
  const accountLimits = isGuestUser(user) ? guestLimits : registeredLimits;
  const features = Object.fromEntries(
    Object.keys(FEATURE_CONFIG).map((feature) => [
      feature,
      buildFeatureState(user, feature),
    ])
  );
  return {
    isPro,
    isUnlimited: isPro,
    limits: {
      ...accountLimits,
      guest: guestLimits,
      registered: registeredLimits,
      pro: null,
      proLabel: "unlimited",
    },
    features,
  };
}

async function consumePremiumFeature(user, feature) {
  const normalized = normalizeFeature(feature);
  if (!normalized) {
    const err = new Error("Unknown premium feature");
    err.statusCode = 400;
    throw err;
  }

  const before = buildFeatureState(user, normalized);
  if (before.hardLocked) {
    const err = new Error("Free limit reached. Upgrade to Premium to continue.");
    err.statusCode = 402;
    err.feature = normalized;
    throw err;
  }

  if (!computeUserIsPro(user)) {
    const config = FEATURE_CONFIG[normalized];
    user.premiumFeatureUsage = {
      ...(user.premiumFeatureUsage || {}),
      [config.field]: before.used + 1,
      updatedAt: new Date(),
    };
    await user.save();
  }

  return buildPremiumFeatureLimits(user);
}

module.exports = {
  buildPremiumFeatureLimits,
  consumePremiumFeature,
  normalizeFeature,
};
