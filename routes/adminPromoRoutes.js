const express = require("express");
const { verifyAdmin } = require("../middlewares/adminAuthMiddleware");
const { appPromoUpload } = require("../middlewares/appPromoUpload");
const {
  createAppPromo,
  updateAppPromo,
  deleteAppPromo,
} = require("../controllers/appPromoController");

const router = express.Router();

router.use(verifyAdmin);
router.post("/", appPromoUpload.single("image"), createAppPromo);
router.put("/:id", appPromoUpload.single("image"), updateAppPromo);
router.patch("/:id", appPromoUpload.single("image"), updateAppPromo);
router.delete("/:id", deleteAppPromo);

module.exports = router;
