/**
 * Medication reminder push copy, per language.
 *
 * `private`  – default; reveals nothing on the lock screen
 * `detailed` – names the medicine
 * Falls back to English for languages without a translation yet.
 */
const MESSAGES = {
  en: {
    private: { title: "Medicine reminder", body: "You have a reminder waiting." },
    detailed: { title: "Medicine reminder", body: (name) => `It's time to take ${name}.` },
  },
};

function reminderCopy(languageCode, { medicineName, hideContent = false } = {}) {
  const set = MESSAGES[languageCode] || MESSAGES.en;
  if (hideContent) return { ...set.private };
  const { title, body } = set.detailed;
  return { title, body: body(medicineName) };
}

module.exports = { reminderCopy };
