const mongoose = require("mongoose");
const User = require("../models/usersModel");
const PushDeviceToken = require("../models/pushDeviceTokenModel");
const ChatUsage = require("../models/chatUsageModel");
const { ensureFirebaseAdmin } = require("../utils/firebaseAdminInit");
const {
  buildCareLimitConfig,
  computeUserIsPro,
  getCareChatLimitForUser,
  isGuestUser,
} = require("../services/careLimitService");

async function getUsers(req, res) {
  try {
    const users = await User.find({})
      .select("-password -otp -resetOTP")
      .sort({ createdAt: -1 })
      .lean();

    const limitConfig = buildCareLimitConfig();
    const rows = users.map((u) => {
      const isPro = computeUserIsPro(u);
      const isGuest = isGuestUser(u);
      const limit = getCareChatLimitForUser(u);
      const used = Number(u.careUsage?.totalMessagesUsed) || 0;

      return {
        id: u._id,
        name: u.name || "",
        email: u.email || "",
        profession: u.profession || "",
        image: u.image || "",
        emailVerified: !!u.emailVerified,
        isBanned: !!u.isBanned,
        bannedAt: u.bannedAt || null,
        bannedReason: u.bannedReason || "",
        createdAt: u.createdAt,
        updatedAt: u.updatedAt,
        deviceTokenCount: Array.isArray(u.deviceTokens) ? u.deviceTokens.length : 0,
        subscriptionPlan: u.subscriptionPlan || (isPro ? "Premium" : "Free"),
        isPro,
        subscription: u.subscription || {},
        careUsage: {
          totalMessagesUsed: used,
          updatedAt: u.careUsage?.updatedAt || null,
        },
        careEntitlement: {
          isPro,
          isGuest,
          isUnlimited: isPro,
          limit,
          freeLimit: limit,
          limits: limitConfig,
          used,
          remaining: isPro ? null : Math.max(0, limit - used),
          hardLocked: !isPro && used >= limit,
        },
        openAiUsage: {
          promptTokens: Number(u.openAiUsage?.promptTokens) || 0,
          completionTokens: Number(u.openAiUsage?.completionTokens) || 0,
          totalTokens: Number(u.openAiUsage?.totalTokens) || 0,
          requestCount: Number(u.openAiUsage?.requestCount) || 0,
          lastUsedAt: u.openAiUsage?.lastUsedAt || null,
        },
      };
    });

    return res.json({
      success: true,
      careLimits: limitConfig,
      users: rows,
    });
  } catch (error) {
    console.error("[admin:getUsers] error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch users",
      error: error.message,
    });
  }
}

async function updateUser(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user id",
      });
    }

    const allowedFields = ["name", "profession", "email", "emailVerified"];
    const payload = {};
    for (const key of allowedFields) {
      if (req.body[key] !== undefined) {
        payload[key] = req.body[key];
      }
    }

    if (payload.email && typeof payload.email === "string") {
      payload.email = payload.email.trim().toLowerCase();
    }

    if (Object.keys(payload).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid fields to update",
      });
    }

    const user = await User.findByIdAndUpdate(id, payload, { new: true }).select("-password");
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.json({
      success: true,
      message: "User updated successfully",
      user,
    });
  } catch (error) {
    console.error("[admin:updateUser] error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update user",
      error: error.message,
    });
  }
}

async function setUserBanState(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user id",
      });
    }

    const banValue = req.body?.isBanned;
    const isBanned =
      banValue === true ||
      banValue === "true" ||
      banValue === 1 ||
      banValue === "1";
    const update = {
      isBanned,
      bannedAt: isBanned ? new Date() : null,
      bannedReason: isBanned ? String(req.body?.bannedReason || "").trim() : "",
    };

    const user = await User.findByIdAndUpdate(id, update, { new: true }).select("-password");
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.json({
      success: true,
      message: isBanned ? "User banned successfully" : "User unbanned successfully",
      user: {
        id: user._id,
        email: user.email,
        isBanned: user.isBanned,
        bannedAt: user.bannedAt,
        bannedReason: user.bannedReason,
      },
    });
  } catch (error) {
    console.error("[admin:setUserBanState] error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update user ban state",
      error: error.message,
    });
  }
}

async function getUsageOverview(req, res) {
  try {
    const agg = await User.aggregate([
      {
        $group: {
          _id: null,
          users: { $sum: 1 },
          bannedUsers: {
            $sum: { $cond: [{ $eq: ["$isBanned", true] }, 1, 0] },
          },
          totalPromptTokens: { $sum: { $ifNull: ["$openAiUsage.promptTokens", 0] } },
          totalCompletionTokens: { $sum: { $ifNull: ["$openAiUsage.completionTokens", 0] } },
          totalTokens: { $sum: { $ifNull: ["$openAiUsage.totalTokens", 0] } },
          totalRequests: { $sum: { $ifNull: ["$openAiUsage.requestCount", 0] } },
        },
      },
    ]);

    const topUsers = await User.find({})
      .select("name email isBanned openAiUsage")
      .sort({ "openAiUsage.totalTokens": -1 })
      .limit(20)
      .lean();

    const summary = agg[0] || {
      users: 0,
      bannedUsers: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalTokens: 0,
      totalRequests: 0,
    };

    return res.json({
      success: true,
      summary,
      topUsers: topUsers.map((u) => ({
        id: u._id,
        name: u.name || "",
        email: u.email || "",
        isBanned: !!u.isBanned,
        openAiUsage: {
          promptTokens: Number(u.openAiUsage?.promptTokens) || 0,
          completionTokens: Number(u.openAiUsage?.completionTokens) || 0,
          totalTokens: Number(u.openAiUsage?.totalTokens) || 0,
          requestCount: Number(u.openAiUsage?.requestCount) || 0,
          lastUsedAt: u.openAiUsage?.lastUsedAt || null,
        },
      })),
    });
  } catch (error) {
    console.error("[admin:getUsageOverview] error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch usage overview",
      error: error.message,
    });
  }
}

async function broadcastNotification(req, res) {
  try {
    const firebaseAdmin = ensureFirebaseAdmin();
    if (!firebaseAdmin) {
      return res.status(503).json({
        success: false,
        message: "Push notifications not configured. Missing Firebase setup.",
      });
    }

    const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    const data = req.body?.data && typeof req.body.data === "object" ? req.body.data : {};

    if (!title || !body) {
      return res.status(400).json({
        success: false,
        message: "title and body are required",
      });
    }

    const usersWithTokens = await User.find({
      "deviceTokens.0": { $exists: true },
      isBanned: { $ne: true },
    }).select("deviceTokens");

    const uniqueTokens = new Set();
    for (const user of usersWithTokens) {
      for (const device of user.deviceTokens || []) {
        if (device?.token) {
          uniqueTokens.add(device.token);
        }
      }
    }

    const standaloneRows = await PushDeviceToken.find({ isActive: true }).select("token").lean();
    for (const row of standaloneRows) {
      if (row?.token) {
        uniqueTokens.add(row.token);
      }
    }

    const tokens = Array.from(uniqueTokens);
    if (!tokens.length) {
      return res.json({
        success: true,
        message: "No registered device tokens found",
        totalTokens: 0,
        successCount: 0,
        failureCount: 0,
      });
    }

    const chunkSize = 500;
    let successCount = 0;
    let failureCount = 0;
    for (let i = 0; i < tokens.length; i += chunkSize) {
      const chunk = tokens.slice(i, i + chunkSize);
      const response = await firebaseAdmin.messaging().sendEachForMulticast({
        tokens: chunk,
        notification: { title, body },
        data: Object.entries(data).reduce((acc, [k, v]) => {
          acc[String(k)] = String(v);
          return acc;
        }, {}),
      });

      successCount += response.successCount || 0;
      failureCount += response.failureCount || 0;
    }

    return res.json({
      success: true,
      message: "Broadcast notification sent",
      totalTokens: tokens.length,
      successCount,
      failureCount,
    });
  } catch (error) {
    console.error("[admin:broadcastNotification] error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to send broadcast notification",
      error: error.message,
    });
  }
}

async function getChatUsageOverview(req, res) {
  try {
    const agg = await ChatUsage.aggregate([
      {
        $group: {
          _id: null,
          totalRequests: { $sum: 1 },
          authenticatedRequests: {
            $sum: { $cond: [{ $eq: ["$requestType", "authenticated"] }, 1, 0] },
          },
          guestRequests: {
            $sum: { $cond: [{ $eq: ["$requestType", "guest"] }, 1, 0] },
          },
          totalPromptTokens: { $sum: { $ifNull: ["$usage.promptTokens", 0] } },
          totalCompletionTokens: { $sum: { $ifNull: ["$usage.completionTokens", 0] } },
          totalTokens: { $sum: { $ifNull: ["$usage.totalTokens", 0] } },
        },
      },
    ]);

    const summary = agg[0] || {
      totalRequests: 0,
      authenticatedRequests: 0,
      guestRequests: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalTokens: 0,
    };

    // Get top users by chat token usage
    const topChatUsers = await ChatUsage.aggregate([
      {
        $match: { userId: { $exists: true, $ne: null } },
      },
      {
        $group: {
          _id: "$userId",
          requestCount: { $sum: 1 },
          promptTokens: { $sum: { $ifNull: ["$usage.promptTokens", 0] } },
          completionTokens: { $sum: { $ifNull: ["$usage.completionTokens", 0] } },
          totalTokens: { $sum: { $ifNull: ["$usage.totalTokens", 0] } },
          lastUsedAt: { $max: "$createdAt" },
        },
      },
      { $sort: { totalTokens: -1 } },
      { $limit: 20 },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "user",
        },
      },
    ]);

    const topUsers = topChatUsers.map((item) => ({
      userId: item._id,
      name: item.user?.[0]?.name || "",
      email: item.user?.[0]?.email || "",
      requestCount: item.requestCount,
      promptTokens: item.promptTokens,
      completionTokens: item.completionTokens,
      totalTokens: item.totalTokens,
      lastUsedAt: item.lastUsedAt,
    }));

    return res.json({
      success: true,
      summary,
      topUsers,
    });
  } catch (error) {
    console.error("[admin:getChatUsageOverview] error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch chat usage overview",
      error: error.message,
    });
  }
}

async function getUserChatUsage(req, res) {
  try {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user id",
      });
    }

    const user = await User.findById(userId).select("name email");
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const usageStats = await ChatUsage.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId) } },
      {
        $group: {
          _id: null,
          requestCount: { $sum: 1 },
          promptTokens: { $sum: { $ifNull: ["$usage.promptTokens", 0] } },
          completionTokens: { $sum: { $ifNull: ["$usage.completionTokens", 0] } },
          totalTokens: { $sum: { $ifNull: ["$usage.totalTokens", 0] } },
          firstRequestAt: { $min: "$createdAt" },
          lastRequestAt: { $max: "$createdAt" },
        },
      },
    ]);

    const stats = usageStats[0] || {
      requestCount: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      firstRequestAt: null,
      lastRequestAt: null,
    };

    // Get recent chat requests
    const recentRequests = await ChatUsage.find({ userId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    return res.json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
      },
      stats,
      recentRequests: recentRequests.map((req) => ({
        id: req._id,
        sessionId: req.sessionId,
        model: req.model,
        promptTokens: req.usage?.promptTokens || 0,
        completionTokens: req.usage?.completionTokens || 0,
        totalTokens: req.usage?.totalTokens || 0,
        createdAt: req.createdAt,
      })),
    });
  } catch (error) {
    console.error("[admin:getUserChatUsage] error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch user chat usage",
      error: error.message,
    });
  }
}

async function getGuestChatStats(req, res) {
  try {
    const stats = await ChatUsage.aggregate([
      { $match: { requestType: "guest" } },
      {
        $group: {
          _id: null,
          totalRequests: { $sum: 1 },
          totalPromptTokens: { $sum: { $ifNull: ["$usage.promptTokens", 0] } },
          totalCompletionTokens: { $sum: { $ifNull: ["$usage.completionTokens", 0] } },
          totalTokens: { $sum: { $ifNull: ["$usage.totalTokens", 0] } },
          firstRequestAt: { $min: "$createdAt" },
          lastRequestAt: { $max: "$createdAt" },
        },
      },
    ]);

    const summary = stats[0] || {
      totalRequests: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalTokens: 0,
      firstRequestAt: null,
      lastRequestAt: null,
    };

    // Get average tokens per request
    const avgTokens =
      summary.totalRequests > 0
        ? Math.round(summary.totalTokens / summary.totalRequests)
        : 0;

    return res.json({
      success: true,
      summary: {
        ...summary,
        averageTokensPerRequest: avgTokens,
      },
    });
  } catch (error) {
    console.error("[admin:getGuestChatStats] error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch guest chat statistics",
      error: error.message,
    });
  }
}

module.exports = {
  getUsers,
  updateUser,
  setUserBanState,
  getUsageOverview,
  broadcastNotification,
  getChatUsageOverview,
  getUserChatUsage,
  getGuestChatStats,
};
