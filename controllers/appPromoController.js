const mongoose = require("mongoose");
const AppPromo = require("../models/appPromoModel");
const {
  deletePromoImage,
  getPromoImageUrl,
} = require("../middlewares/appPromoUpload");

function mapPromo(promo) {
  return {
    id: promo._id.toString(),
    title: promo.title,
    image: getPromoImageUrl(promo.image) || promo.image,
    link: promo.link,
    isActive: !!promo.isActive,
    order: Number(promo.order) || 0,
    screen: promo.screen || "",
    createdAt: promo.createdAt,
    updatedAt: promo.updatedAt,
  };
}

async function getAllAppPromos(req, res) {
  try {
    const { isActive } = req.query;
    const query = {};
    if (isActive !== undefined) {
      query.isActive = isActive === "true";
    }
    const promos = await AppPromo.find(query).sort({ order: 1, createdAt: -1 }).lean();
    return res.json({
      success: true,
      data: promos.map(mapPromo),
    });
  } catch (error) {
    console.error("[appPromos:getAll] error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch app promos.",
      error: error.message,
    });
  }
}

async function getAppPromoById(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid promo id",
      });
    }
    const promo = await AppPromo.findById(id).lean();
    if (!promo) {
      return res.status(404).json({
        success: false,
        message: "App promo not found.",
      });
    }
    return res.json({
      success: true,
      data: mapPromo(promo),
    });
  } catch (error) {
    console.error("[appPromos:getById] error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch app promo.",
      error: error.message,
    });
  }
}

async function createAppPromo(req, res) {
  try {
    const { title, link, isActive, order, screen } = req.body || {};
    const imageFile = req.file;

    if (!title || !link) {
      if (imageFile) deletePromoImage(imageFile.filename);
      return res.status(400).json({
        success: false,
        message: "Title and link are required.",
      });
    }
    if (!imageFile) {
      return res.status(400).json({
        success: false,
        message: "Image file is required.",
      });
    }

    const promo = await AppPromo.create({
      title: String(title).trim(),
      image: imageFile.filename,
      link: String(link).trim(),
      isActive:
        isActive !== undefined ? isActive === "true" || isActive === true : true,
      order: Number.parseInt(order, 10) || 0,
      screen: typeof screen === "string" ? screen.trim() : "",
    });

    return res.status(201).json({
      success: true,
      message: "App promo created successfully.",
      data: mapPromo(promo),
    });
  } catch (error) {
    if (req.file) deletePromoImage(req.file.filename);
    console.error("[appPromos:create] error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create app promo.",
      error: error.message,
    });
  }
}

async function updateAppPromo(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      if (req.file) deletePromoImage(req.file.filename);
      return res.status(400).json({
        success: false,
        message: "Invalid promo id",
      });
    }

    const { title, link, isActive, order, screen } = req.body || {};
    const imageFile = req.file;
    const promo = await AppPromo.findById(id);
    if (!promo) {
      if (imageFile) deletePromoImage(imageFile.filename);
      return res.status(404).json({
        success: false,
        message: "App promo not found.",
      });
    }

    const oldImage = promo.image;
    if (title !== undefined) promo.title = String(title).trim();
    if (link !== undefined) promo.link = String(link).trim();
    if (isActive !== undefined) promo.isActive = isActive === "true" || isActive === true;
    if (order !== undefined) promo.order = Number.parseInt(order, 10) || 0;
    if (screen !== undefined) promo.screen = typeof screen === "string" ? screen.trim() : "";
    if (imageFile) promo.image = imageFile.filename;

    await promo.save();
    if (imageFile && oldImage && oldImage !== imageFile.filename) {
      deletePromoImage(oldImage);
    }

    return res.json({
      success: true,
      message: "App promo updated successfully.",
      data: mapPromo(promo),
    });
  } catch (error) {
    if (req.file) deletePromoImage(req.file.filename);
    console.error("[appPromos:update] error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update app promo.",
      error: error.message,
    });
  }
}

async function deleteAppPromo(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid promo id",
      });
    }
    const promo = await AppPromo.findById(id);
    if (!promo) {
      return res.status(404).json({
        success: false,
        message: "App promo not found.",
      });
    }
    if (promo.image) {
      deletePromoImage(promo.image);
    }
    await AppPromo.findByIdAndDelete(id);
    return res.json({
      success: true,
      message: "App promo deleted successfully.",
    });
  } catch (error) {
    console.error("[appPromos:delete] error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete app promo.",
      error: error.message,
    });
  }
}

module.exports = {
  getAllAppPromos,
  getAppPromoById,
  createAppPromo,
  updateAppPromo,
  deleteAppPromo,
};
