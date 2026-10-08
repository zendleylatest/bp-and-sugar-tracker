const fs = require("fs");
const path = require("path");
const multer = require("multer");

const uploadDir = path.resolve(process.cwd(), "uploads", "app-promos");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/\s+/g, "-");
    cb(null, `${base}-${uniqueSuffix}${ext}`);
  },
});

const fileFilter = (_req, file, cb) => {
  const allowed = new Set([
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/gif",
    "image/webp",
  ]);
  if (allowed.has(file.mimetype)) {
    cb(null, true);
    return;
  }
  cb(new Error("Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed."));
};

const appPromoUpload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

function deletePromoImage(filename) {
  if (!filename) return;
  const filePath = path.resolve(uploadDir, filename);
  if (!fs.existsSync(filePath)) return;
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    console.error("[appPromoUpload:deletePromoImage] error:", error.message);
  }
}

function getPromoImageUrl(filename) {
  if (!filename) return "";
  if (filename.startsWith("http://") || filename.startsWith("https://")) {
    return filename;
  }
  return `/uploads/app-promos/${filename}`;
}

module.exports = {
  appPromoUpload,
  deletePromoImage,
  getPromoImageUrl,
};
