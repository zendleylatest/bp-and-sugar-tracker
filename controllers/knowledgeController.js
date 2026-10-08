const {
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
} = require("../services/knowledgeStoreService");

async function listEntries(req, res) {
  try {
    const { category, search, active, limit = 50, skip = 0 } = req.query;
    const opts = {
      category: category || undefined,
      search: search || undefined,
      limit: Math.min(Number(limit) || 50, 200),
      skip: Number(skip) || 0,
    };

    if (active === "all") opts.active = undefined;
    else if (active === "false") opts.active = false;
    else opts.active = true;

    const [entries, total] = await Promise.all([
      listKnowledgeEntries(opts),
      countKnowledgeEntries(opts),
    ]);

    return res.json({ success: true, count: entries.length, total, entries });
  } catch (error) {
    console.error("GET /api/knowledge:", error?.message || error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to list knowledge entries",
    });
  }
}

async function stats(req, res) {
  try {
    const data = await getKnowledgeStats();
    return res.json({ success: true, ...data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || "Stats failed" });
  }
}

async function categories(req, res) {
  try {
    const items = await getKnowledgeCategories();
    return res.json({ success: true, categories: items });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || "Categories failed" });
  }
}

async function merged(req, res) {
  try {
    const text = await getMergedKnowledgeText();
    return res.json({
      success: true,
      totalCharacters: text.length,
      text,
      note: "This is the combined learned knowledge for AI prompt injection.",
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || "Merge failed" });
  }
}

async function getEntry(req, res) {
  try {
    const entry = await getKnowledgeEntry(req.params.id);
    if (!entry) {
      return res.status(404).json({ success: false, message: "Entry not found" });
    }
    return res.json({ success: true, entry });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to get entry" });
  }
}

async function createEntry(req, res) {
  try {
    if (Array.isArray(req.body?.entries)) {
      const created = await addKnowledgeEntriesBulk(
        req.body.entries,
        req.adminId || req.knowledgeAuthMethod || "api"
      );
      return res.status(201).json({
        success: true,
        created: created.length,
        entries: created,
        message: `${created.length} knowledge entries added successfully.`,
      });
    }

    const content = req.body?.content;
    if (!content || typeof content !== "string" || !content.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Provide "content" (string) or "entries" (array of { title?, content }).',
      });
    }

    const entry = await addKnowledgeEntry({
      title: req.body.title,
      content,
      category: req.body.category,
      tags: req.body.tags,
      addedBy: req.adminId || req.knowledgeAuthMethod || "api",
    });

    return res.status(201).json({
      success: true,
      entry,
      message: "Knowledge entry added successfully.",
    });
  } catch (error) {
    console.error("POST /api/knowledge:", error?.message || error);
    return res.status(400).json({
      success: false,
      message: error?.message || "Failed to add knowledge",
    });
  }
}

async function updateEntry(req, res) {
  try {
    const entry = await updateKnowledgeEntry(req.params.id, {
      title: req.body?.title,
      content: req.body?.content,
      category: req.body?.category,
      tags: req.body?.tags,
      active: req.body?.active,
    });
    if (!entry) {
      return res.status(404).json({ success: false, message: "Entry not found" });
    }
    return res.json({ success: true, entry, message: "Knowledge entry updated." });
  } catch (error) {
    return res.status(400).json({ success: false, message: error?.message || "Failed to update" });
  }
}

async function deactivateEntry(req, res) {
  try {
    const entry = await deactivateKnowledgeEntry(req.params.id);
    if (!entry) {
      return res.status(404).json({ success: false, message: "Entry not found" });
    }
    return res.json({ success: true, entry, message: "Entry deactivated." });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to deactivate" });
  }
}

async function reactivateEntry(req, res) {
  try {
    const entry = await reactivateKnowledgeEntry(req.params.id);
    if (!entry) {
      return res.status(404).json({ success: false, message: "Entry not found" });
    }
    return res.json({ success: true, entry, message: "Entry reactivated." });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to reactivate" });
  }
}

async function removeEntry(req, res) {
  try {
    const removed = await deleteKnowledgeEntry(req.params.id);
    if (!removed) {
      return res.status(404).json({ success: false, message: "Entry not found" });
    }
    return res.json({ success: true, deleted: req.params.id, message: "Entry permanently deleted." });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to delete" });
  }
}

module.exports = {
  listEntries,
  stats,
  categories,
  merged,
  getEntry,
  createEntry,
  updateEntry,
  deactivateEntry,
  reactivateEntry,
  removeEntry,
};
