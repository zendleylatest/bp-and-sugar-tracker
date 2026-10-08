require("dotenv").config();

const secretKey = process.env.JWT_SECRET;
if (!secretKey) {
  throw new Error("JWT_SECRET is required. Set it in a .env file (see .env.example).");
}

module.exports = secretKey;
