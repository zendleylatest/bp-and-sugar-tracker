const Knowledge = require("../models/knowledgeModel");

function formatEntryBlock(entry) {
  const title = entry.title?.trim();
  const content = entry.content?.trim();
  if (!content) return "";
  const header = title ? `${title.toUpperCase()}\n` : "";
  const category = entry.category?.trim();
  const meta = category ? `(Category: ${category})\n` : "";
  return `${header}${meta}${content}`;
}

function formatLearnedKnowledge(entries) {
  return entries.map(formatEntryBlock).filter(Boolean).join("\n\n");
}

async function listKnowledgeEntries(opts = {}) {
  const filter = {};
  if (opts.active !== undefined) filter.active = opts.active;
  else filter.active = true;
  if (opts.category) filter.category = opts.category;
  if (opts.search) filter.$text = { $search: opts.search };

  const query = Knowledge.find(filter).sort({ createdAt: -1 });
  if (opts.limit) query.limit(opts.limit);
  if (opts.skip) query.skip(opts.skip);
  return query.lean();
}

async function countKnowledgeEntries(opts = {}) {
  const filter = {};
  if (opts.active !== undefined) filter.active = opts.active;
  else filter.active = true;
  if (opts.category) filter.category = opts.category;
  if (opts.search) filter.$text = { $search: opts.search };
  return Knowledge.countDocuments(filter);
}

function normalizeTags(tags) {
  return Array.isArray(tags)
    ? tags.map((tag) => String(tag).trim()).filter(Boolean)
    : [];
}

async function getKnowledgeEntry(id) {
  return Knowledge.findById(id).lean();
}

async function addKnowledgeEntry(input) {
  const content = input?.content?.trim();
  if (!content) throw new Error("content is required");

  const entry = await Knowledge.create({
    title: input.title?.trim() || null,
    content,
    category: input.category?.trim() || null,
    tags: normalizeTags(input.tags),
    addedBy: input.addedBy || "api",
  });
  return entry.toObject();
}

async function addKnowledgeEntriesBulk(entries, addedBy = "api") {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("entries array is required");
  }

  const docs = entries
    .filter((item) => item?.content?.trim())
    .map((item) => ({
      title: item.title?.trim() || null,
      content: item.content.trim(),
      category: item.category?.trim() || null,
      tags: normalizeTags(item.tags),
      addedBy,
    }));

  if (docs.length === 0) {
    throw new Error("no valid entries (each needs content)");
  }

  const created = await Knowledge.insertMany(docs);
  return created.map((doc) => doc.toObject());
}

async function updateKnowledgeEntry(id, patch = {}) {
  const update = {};
  if (patch.title !== undefined) update.title = patch.title?.trim() || null;
  if (patch.content !== undefined) {
    const content = patch.content?.trim();
    if (!content) throw new Error("content cannot be empty");
    update.content = content;
  }
  if (patch.category !== undefined) update.category = patch.category?.trim() || null;
  if (patch.tags !== undefined) update.tags = normalizeTags(patch.tags);
  if (patch.active !== undefined) update.active = Boolean(patch.active);

  return Knowledge.findByIdAndUpdate(id, update, {
    new: true,
    runValidators: true,
  }).lean();
}

async function deleteKnowledgeEntry(id) {
  const result = await Knowledge.findByIdAndDelete(id);
  return Boolean(result);
}

async function deactivateKnowledgeEntry(id) {
  return Knowledge.findByIdAndUpdate(id, { active: false }, { new: true }).lean();
}

async function reactivateKnowledgeEntry(id) {
  return Knowledge.findByIdAndUpdate(id, { active: true }, { new: true }).lean();
}

async function getMergedKnowledgeText() {
  const entries = await Knowledge.find({ active: true }).sort({ createdAt: 1 }).lean();
  const learned = formatLearnedKnowledge(entries);
  if (!learned) return "";
  return `\n\n--- LEARNED KNOWLEDGE ---\n\n${learned}\n`;
}

async function getKnowledgeCategories() {
  return Knowledge.distinct("category", { active: true, category: { $ne: null } });
}

async function getKnowledgeStats() {
  const [total, active, inactive, categories] = await Promise.all([
    Knowledge.countDocuments(),
    Knowledge.countDocuments({ active: true }),
    Knowledge.countDocuments({ active: false }),
    Knowledge.distinct("category", { active: true, category: { $ne: null } }),
  ]);
  return { total, active, inactive, categories: categories.length, categoryList: categories };
}

module.exports = {
  formatEntryBlock,
  formatLearnedKnowledge,
  listKnowledgeEntries,
  countKnowledgeEntries,
  getKnowledgeEntry,
  addKnowledgeEntry,
  addKnowledgeEntriesBulk,
  updateKnowledgeEntry,
  deleteKnowledgeEntry,
  deactivateKnowledgeEntry,
  reactivateKnowledgeEntry,
  getMergedKnowledgeText,
  getKnowledgeCategories,
  getKnowledgeStats,
};
