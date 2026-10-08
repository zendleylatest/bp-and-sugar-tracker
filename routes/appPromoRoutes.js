const express = require("express");
const {
  getAllAppPromos,
  getAppPromoById,
} = require("../controllers/appPromoController");

const router = express.Router();

router.get("/", getAllAppPromos);
router.get("/:id", getAppPromoById);

module.exports = router;
