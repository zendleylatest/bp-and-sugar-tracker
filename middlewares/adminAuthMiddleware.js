const jwt = require("jsonwebtoken");

const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET || "change-this-admin-secret";

function signAdminToken(adminId) {
  return jwt.sign({ adminId }, ADMIN_JWT_SECRET, { expiresIn: "7d" });
}

function verifyAdmin(req, res, next) {
  try {
    const header = req.header("Authorization");
    const token = header?.replace("Bearer ", "");
    if (!token) {
      return res.status(401).json({
        success: false,
        message: "No admin token provided",
      });
    }

    const decoded = jwt.verify(token, ADMIN_JWT_SECRET);
    req.adminId = decoded.adminId;
    next();
  } catch (_) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired admin token",
    });
  }
}

module.exports = {
  signAdminToken,
  verifyAdmin,
};
