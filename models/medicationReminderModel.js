const mongoose = require("mongoose");

const medicineSchema = new mongoose.Schema(
  {
    // Local SQLite row id on the device; stable key for de-duplication.
    clientId: { type: String, required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    // First day of the reminder window (YYYY-MM-DD, user's local date).
    startDate: { type: String, required: true },
    // "Today" | "This Week" | "15 Days" | "This Month" (same labels as the app).
    duration: { type: String, default: "Today" },
    // Two-letter weekday codes: MO TU WE TH FR SA SU.
    weekDays: { type: [String], default: [] },
    // Local times of day, "HH:mm".
    times: { type: [String], default: [] },
  },
  { _id: false }
);

const medicationReminderSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
      unique: true,
      index: true,
    },
    medicines: { type: [medicineSchema], default: [] },
    // Minutes ahead of UTC on the user's device (e.g. 300 for UTC+5), sent by
    // the app on save so reminders fire at the right local time.
    utcOffsetMinutes: { type: Number, default: 0 },
    // App language (2-letter code); reminder pushes are written in it.
    languageCode: { type: String, default: "en" },
    // "<clientId>|<YYYY-MM-DD>|<HH:mm>" slots already pushed (capped).
    sentSlots: { type: [String], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model("MedicationReminder", medicationReminderSchema);
