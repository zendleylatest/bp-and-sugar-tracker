const express = require("express");
const { faqChat } = require("../controllers/faqController");

const router = express.Router();

router.post("/chat", faqChat);

module.exports = router;
