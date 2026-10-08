const express = require("express");
const {
  getMedicationReminders,
  saveMedicationReminders,
  deleteMedicationReminders,
  handleDebugMedicationReminder,
} = require("../controllers/medicationReminderController");
const { authenticate } = require("../middlewares/authMiddleware");

const router = express.Router();

router.get("/", authenticate, getMedicationReminders);
router.put("/", authenticate, saveMedicationReminders);
router.delete("/", authenticate, deleteMedicationReminders);
router.post("/debug", authenticate, handleDebugMedicationReminder);

module.exports = router;
