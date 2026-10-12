function parseLimit(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

// Guests and signed-up users share the same free chat limit; Premium is unlimited.
const REGISTERED_CHAT_LIMIT = parseLimit(
  process.env.CARE_REGISTERED_CHAT_LIMIT,
  5
);
const GUEST_CHAT_LIMIT = REGISTERED_CHAT_LIMIT;

function computeUserIsPro(user) {
  if (user?.isPro) return true;
  return user?.subscriptionPlan === "Premium";
}

function isGuestUser(user) {
  if (user?.emailVerified === false) return true;
  return /^guest_[^@]+@wellorahealth\.app$/i.test(String(user?.email || ""));
}

function getCareChatLimitForUser(user) {
  if (computeUserIsPro(user)) return null;
  return isGuestUser(user) ? GUEST_CHAT_LIMIT : REGISTERED_CHAT_LIMIT;
}

function buildCareLimitConfig() {
  return {
    guest: GUEST_CHAT_LIMIT,
    registered: REGISTERED_CHAT_LIMIT,
    pro: null,
    proLabel: "unlimited",
  };
}

module.exports = {
  GUEST_CHAT_LIMIT,
  REGISTERED_CHAT_LIMIT,
  buildCareLimitConfig,
  computeUserIsPro,
  getCareChatLimitForUser,
  isGuestUser,
};
