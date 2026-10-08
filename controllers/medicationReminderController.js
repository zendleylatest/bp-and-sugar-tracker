const MedicationReminder = require("../models/medicationReminderModel");
const {
  debugRemindersEnabled,
  scheduleDebugReminder,
} = require("../services/medicationReminderPushService");

const MAX_MEDICINES = 100;
const MAX_TIMES_PER_MEDICINE = 24;
const WEEKDAY_CODES = new Set(["MO", "TU", "WE", "TH", "FR", "SA", "SU"]);
const DURATIONS = new Set(["Today", "This Week", "15 Days", "This Month"]);

function sanitizeMedicine(raw) {
  if (!raw || typeof raw !== "object") return null;
  const clientId = String(raw.clientId ?? "").trim();
  const name = String(raw.name ?? "").trim().slice(0, 120);
  const startDate = String(raw.startDate ?? "").trim();
  if (!clientId || !name || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return null;

  const times = (Array.isArray(raw.times) ? raw.times : [])
    .map((t) => String(t).trim())
    .filter((t) => /^([01]?\d|2[0-3]):[0-5]\d$/.test(t))
    .slice(0, MAX_TIMES_PER_MEDICINE);
  if (!times.length) return null;

  return {
    clientId,
    name,
    startDate,
    duration: DURATIONS.has(raw.duration) ? raw.duration : "Today",
    weekDays: (Array.isArray(raw.weekDays) ? raw.weekDays : [])
      .map((d) => String(d).trim().toUpperCase())
      .filter((d) => WEEKDAY_CODES.has(d)),
    times,
  };
}

/** GET /api/medication-reminders */
async function getMedicationReminders(req, res) {
  try {
    const record = await MedicationReminder.findOne({ userId: req.authUser._id }).lean();
    return res.json({ success: true, medicines: record?.medicines || [] });
  } catch (err) {
    console.error("[medication-reminder] get error:", err);
    return res.status(500).json({ error: "Could not load reminders" });
  }
}

/**
 * PUT /api/medication-reminders
 * Replaces the user's full reminder list (the app is the source of truth).
 * Body: { medicines: [...], utcOffsetMinutes, languageCode }
 */
async function saveMedicationReminders(req, res) {
  try {
    if (!Array.isArray(req.body?.medicines)) {
      return res.status(400).json({ error: "medicines must be an array" });
    }
    const medicines = req.body.medicines
      .slice(0, MAX_MEDICINES)
      .map(sanitizeMedicine)
      .filter(Boolean);

    // Only trust a plausible offset (UTC-14 .. UTC+14); otherwise keep the old one.
    const offset = Number(req.body?.utcOffsetMinutes);
    const offsetUpdate =
      Number.isFinite(offset) && Math.abs(offset) <= 14 * 60
        ? { utcOffsetMinutes: Math.round(offset) }
        : {};

    const language = String(req.body?.languageCode || "").toLowerCase().split(/[-_]/)[0];
    const languageUpdate = /^[a-z]{2}$/.test(language) ? { languageCode: language } : {};

    await MedicationReminder.findOneAndUpdate(
      { userId: req.authUser._id },
      { $set: { medicines, ...offsetUpdate, ...languageUpdate } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return res.json({ success: true, count: medicines.length });
  } catch (err) {
    console.error("[medication-reminder] save error:", err);
    return res.status(500).json({ error: "Could not save reminders" });
  }
}

/** DELETE /api/medication-reminders */
async function deleteMedicationReminders(req, res) {
  try {
    await MedicationReminder.deleteOne({ userId: req.authUser._id });
    return res.json({ success: true });
  } catch (err) {
    console.error("[medication-reminder] delete error:", err);
    return res.status(500).json({ error: "Could not delete reminders" });
  }
}

/**
 * Debug only (MEDICATION_REMINDER_DEBUG_ENABLED=true): pushes a test reminder
 * to the caller's devices after `delaySeconds` (default 60).
 */
async function handleDebugMedicationReminder(req, res) {
  try {
    if (!debugRemindersEnabled()) {
      return res.status(404).json({ error: "Not found" });
    }
    const record = await MedicationReminder.findOne({ userId: req.authUser._id }).lean();
    const scheduled = scheduleDebugReminder(
      req.authUser._id,
      req.body?.delaySeconds,
      record?.medicines?.[0] || { name: "your medicine" },
      record?.languageCode
    );
    return res.status(202).json({ success: true, ...scheduled });
  } catch (err) {
    console.error("[medication-reminder] debug endpoint error:", err);
    return res.status(500).json({ error: "Could not schedule the debug reminder" });
  }
}

module.exports = {
  getMedicationReminders,
  saveMedicationReminders,
  deleteMedicationReminders,
  handleDebugMedicationReminder,
};
