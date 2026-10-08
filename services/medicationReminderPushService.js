const User = require("../models/usersModel");
const MedicationReminder = require("../models/medicationReminderModel");
const { ensureFirebaseAdmin } = require("../utils/firebaseAdminInit");
const { reminderCopy } = require("./medicationReminderMessages");

// A due reminder is still delivered up to this long after its time (covers
// sweep interval + server downtime) but never later, so it can't arrive hours
// stale.
const GRACE_MINUTES = 60;
// Pushes older than the grace window are useless; don't let FCM/APNs deliver
// them to a phone that was off.
const PUSH_TTL_MS = GRACE_MINUTES * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SENT_SLOTS = 200;
const DEFAULT_DEBUG_DELAY_SECONDS = 60;
const MAX_DEBUG_DELAY_SECONDS = 60 * 60;
const ANDROID_PACKAGE = process.env.ANDROID_PACKAGE_NAME || "com.sugur.blood.playstore";
const WEEKDAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"]; // by getUTCDay()

// ── date helpers (date-only maths is done on UTC midnights) ─────────────────

function parseDateKey(key) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ""));
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function formatDateKey(utcMidnightMs) {
  const d = new Date(utcMidnightMs);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** The user's local "now" expressed as a shifted UTC date (use getUTC*). */
function localNow(nowMs, utcOffsetMinutes) {
  return new Date(nowMs + (Number(utcOffsetMinutes) || 0) * 60 * 1000);
}

function parseTime(value) {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value || "").trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute, label: `${String(hour).padStart(2, "0")}:${match[2]}` };
}

/** Last day of the reminder window; mirrors the app's duration options. */
function endDateMs(startMs, duration) {
  const start = new Date(startMs);
  switch (duration) {
    case "This Week": {
      // Dart weekday: Mon=1..Sun=7; window runs to Sunday.
      const dartWeekday = start.getUTCDay() === 0 ? 7 : start.getUTCDay();
      return startMs + (7 - dartWeekday) * DAY_MS;
    }
    case "15 Days":
      return startMs + 14 * DAY_MS;
    case "This Month":
      return Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0);
    case "Today":
    default:
      return startMs;
  }
}

/**
 * Reminders due right now for one stored document.
 * Returns `[{ slot, medicine }]`; `slot` is the de-duplication key.
 */
function dueReminders({ medicines, utcOffsetMinutes, sentSlots = [], nowMs }) {
  const local = localNow(nowMs, utcOffsetMinutes);
  const todayMs = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const todayKey = formatDateKey(todayMs);
  const nowMinutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  const sent = new Set(sentSlots);
  const due = [];

  for (const medicine of medicines || []) {
    const startMs = parseDateKey(medicine.startDate);
    if (startMs === null) continue;
    if (todayMs < startMs || todayMs > endDateMs(startMs, medicine.duration)) continue;

    const days = medicine.weekDays?.length
      ? medicine.weekDays
      : [WEEKDAY_CODES[new Date(startMs).getUTCDay()]];
    if (!days.includes(WEEKDAY_CODES[local.getUTCDay()])) continue;

    for (const raw of medicine.times || []) {
      const time = parseTime(raw);
      if (!time) continue;
      const at = time.hour * 60 + time.minute;
      if (nowMinutes < at || nowMinutes >= at + GRACE_MINUTES) continue;
      const slot = `${medicine.clientId}|${todayKey}|${time.label}`;
      if (sent.has(slot)) continue;
      due.push({ slot, medicine });
    }
  }
  return due;
}

function buildReminderMessage(medicine, { debug = false, languageCode = "en" } = {}) {
  const base = reminderCopy(languageCode, { medicineName: medicine?.name || "your medicine" });
  return debug ? { ...base, body: `${base.body} (debug test)` } : { ...base };
}

// ── sending ─────────────────────────────────────────────────────────────────

const INVALID_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

/** Sends to every device token of a user and prunes dead tokens. */
async function sendPushToUser(userId, { title, body, data = {} }) {
  const admin = ensureFirebaseAdmin();
  if (!admin) return { sent: 0, reason: "firebase_not_configured" };

  const user = await User.findById(userId).select("deviceTokens isBanned");
  if (!user || user.isBanned) return { sent: 0, reason: "no_user" };
  const tokens = (user.deviceTokens || []).map((d) => d.token).filter(Boolean);
  if (!tokens.length) return { sent: 0, reason: "no_tokens" };

  const expirySeconds = Math.floor((Date.now() + PUSH_TTL_MS) / 1000);
  const response = await admin.messaging().sendEachForMulticast({
    tokens,
    notification: { title, body },
    android: {
      priority: "high",
      ttl: PUSH_TTL_MS,
      notification: { channelId: "medicine_reminders" },
    },
    apns: {
      headers: { "apns-priority": "10", "apns-expiration": String(expirySeconds) },
      payload: { aps: { sound: "default" } },
    },
    data: Object.fromEntries(
      Object.entries({ targetPackageNames: ANDROID_PACKAGE, ...data }).map(([k, v]) => [
        String(k),
        String(v),
      ])
    ),
  });

  const dead = [];
  response.responses.forEach((r, i) => {
    if (!r.success && INVALID_TOKEN_CODES.has(r.error?.code)) dead.push(tokens[i]);
  });
  if (dead.length) {
    await User.updateOne({ _id: userId }, { $pull: { deviceTokens: { token: { $in: dead } } } });
  }
  return { sent: response.successCount || 0, failed: response.failureCount || 0 };
}

// ── sweep ───────────────────────────────────────────────────────────────────

/**
 * One pass over every stored reminder document. Safe to run on several
 * instances: a slot is claimed atomically before it is sent, and released
 * again if no device received it so a later pass (within the grace window)
 * retries.
 */
async function sweepMedicationReminders({
  nowMs = Date.now(),
  cursor = () => MedicationReminder.find({ "medicines.0": { $exists: true } }).lean().cursor(),
  claim = async (doc, slot) => {
    const res = await MedicationReminder.updateOne(
      { _id: doc._id, sentSlots: { $ne: slot } },
      { $push: { sentSlots: { $each: [slot], $slice: -MAX_SENT_SLOTS } } }
    );
    return res.modifiedCount > 0;
  },
  release = async (doc, slot) =>
    MedicationReminder.updateOne({ _id: doc._id }, { $pull: { sentSlots: slot } }),
  send = sendPushToUser,
} = {}) {
  const summary = { checked: 0, due: 0, sent: 0 };
  for await (const doc of cursor()) {
    summary.checked += 1;
    const due = dueReminders({
      medicines: doc.medicines,
      utcOffsetMinutes: doc.utcOffsetMinutes,
      sentSlots: doc.sentSlots,
      nowMs,
    });

    for (const { slot, medicine } of due) {
      summary.due += 1;
      if (!(await claim(doc, slot))) continue; // another instance got it

      try {
        const message = buildReminderMessage(medicine, { languageCode: doc.languageCode });
        const result = await send(doc.userId, {
          ...message,
          data: { type: "medicine_reminder", medicineId: medicine.clientId, slot },
        });
        if (result.sent > 0) {
          summary.sent += 1;
        } else {
          await release(doc, slot);
        }
      } catch (err) {
        console.error("[medication-reminder] send failed:", err.message);
        await release(doc, slot);
      }
    }
  }
  return summary;
}

function pushRemindersEnabled() {
  return String(process.env.MEDICATION_REMINDER_PUSH_ENABLED || "").toLowerCase() === "true";
}

let schedulerTimer = null;

/** Starts the periodic sweep (no-op unless MEDICATION_REMINDER_PUSH_ENABLED=true). */
function startMedicationReminderScheduler() {
  if (!pushRemindersEnabled()) {
    console.log(
      "[medication-reminder] push reminders disabled (set MEDICATION_REMINDER_PUSH_ENABLED=true)"
    );
    return;
  }
  if (schedulerTimer) return;
  const run = async () => {
    try {
      const summary = await sweepMedicationReminders();
      if (summary.due) console.log("[medication-reminder] sweep:", JSON.stringify(summary));
    } catch (err) {
      console.error("[medication-reminder] sweep failed:", err.message);
    }
  };
  schedulerTimer = setInterval(run, SWEEP_INTERVAL_MS);
  schedulerTimer.unref?.();
  console.log("[medication-reminder] push reminder scheduler started");
}

// ── debug: push a test reminder after a delay ───────────────────────────────

const debugTimers = new Map();

function debugRemindersEnabled() {
  return String(process.env.MEDICATION_REMINDER_DEBUG_ENABLED || "").toLowerCase() === "true";
}

/**
 * Schedules a test push for one user. A new request replaces the previous
 * pending one. In-memory only: lost on server restart, which is fine for
 * debugging.
 */
function scheduleDebugReminder(userId, delaySeconds, medicine, languageCode = "en") {
  const seconds = Math.min(
    Math.max(Number(delaySeconds) || DEFAULT_DEBUG_DELAY_SECONDS, 1),
    MAX_DEBUG_DELAY_SECONDS
  );
  const key = String(userId);
  clearTimeout(debugTimers.get(key));
  const timer = setTimeout(async () => {
    debugTimers.delete(key);
    try {
      const message = buildReminderMessage(medicine, { debug: true, languageCode });
      const result = await sendPushToUser(userId, {
        ...message,
        data: { type: "medicine_reminder_debug" },
      });
      console.log(`[medication-reminder] debug push for ${key}:`, JSON.stringify(result));
    } catch (err) {
      console.error("[medication-reminder] debug push failed:", err.message);
    }
  }, seconds * 1000);
  timer.unref?.();
  debugTimers.set(key, timer);
  return { delaySeconds: seconds, fireAt: new Date(Date.now() + seconds * 1000).toISOString() };
}

module.exports = {
  dueReminders,
  endDateMs,
  buildReminderMessage,
  sendPushToUser,
  sweepMedicationReminders,
  startMedicationReminderScheduler,
  debugRemindersEnabled,
  scheduleDebugReminder,
  GRACE_MINUTES,
};
