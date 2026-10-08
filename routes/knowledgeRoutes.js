const express = require("express");
const { requireKnowledgeAuth } = require("../middlewares/knowledgeAuth");
const {
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
} = require("../controllers/knowledgeController");

const router = express.Router();

router.get("/", listEntries);
router.get("/stats", stats);
router.get("/categories", categories);
router.get("/merged", merged);
router.get("/:id", getEntry);

router.post("/", requireKnowledgeAuth, createEntry);
router.put("/:id", requireKnowledgeAuth, updateEntry);
router.patch("/:id/deactivate", requireKnowledgeAuth, deactivateEntry);
router.patch("/:id/reactivate", requireKnowledgeAuth, reactivateEntry);
router.delete("/:id", requireKnowledgeAuth, removeEntry);

module.exports = router;
