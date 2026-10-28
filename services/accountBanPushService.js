const { ensureFirebaseAdmin } = require("../utils/firebaseAdminInit");

const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Tells a just-banned user's devices to sign out right away. Data-only, high
 * priority: the app clears its session (foreground or background) and shows
 * the suspended dialog. `userId` lets the app ignore the push if a different
 * account is signed in on that device (tokens can outlive a logout).
 * Best-effort: never throws.
 */
async function sendBanPush(user) {
  try {
    const admin = ensureFirebaseAdmin();
    if (!admin) {
      console.warn("[ban-push] Firebase not configured; user will be signed out on next app check");
      return { sent: 0, reason: "firebase_not_configured" };
    }
    const tokens = [
      ...new Set((user.deviceTokens || []).map((d) => d.token).filter(Boolean)),
    ];
    if (!tokens.length) {
      console.log(`[ban-push] user=${user._id} has no device tokens; signed out on next app check`);
      return { sent: 0, reason: "no_tokens" };
    }

    const response = await admin.messaging().sendEachForMulticast({
      tokens,
      data: {
        type: "account_banned",
        userId: String(user._id),
        bannedReason: String(user.bannedReason || ""),
      },
      android: { priority: "high", ttl: TTL_MS },
      apns: {
        headers: { "apns-priority": "5", "apns-push-type": "background" },
        payload: { aps: { "content-available": 1 } },
      },
    });
    console.log(
      `[ban-push] user=${user._id} sent=${response.successCount} failed=${response.failureCount}`
    );
    return { sent: response.successCount, failed: response.failureCount };
  } catch (err) {
    console.warn("[ban-push] failed:", err.message);
    return { sent: 0, reason: "error" };
  }
}

module.exports = { sendBanPush };
