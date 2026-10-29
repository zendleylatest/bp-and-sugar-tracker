require("dotenv").config();

const express = require("express");
const cors = require("cors");
const MongoDBConnect = require("./connection/connection");
const ensureBody = require("./middlewares/parseRequest");
const promptRouter = require("./routes/promptRoutes");
const userAuthRouter = require("./routes/userAuthRoutes");
const adminRouter = require("./routes/adminRoutes");
const adminAuthRouter = require("./routes/adminAuthRoutes");
const notificationRouter = require("./routes/notificationRoutes");
const appPromoRouter = require("./routes/appPromoRoutes");
const adminPromoRouter = require("./routes/adminPromoRoutes");
const chatRouter = require("./routes/chatRoutes");
const premiumFeatureRouter = require("./routes/premiumFeatureRoutes");
const faqRouter = require("./routes/faqRoutes");
const knowledgeRouter = require("./routes/knowledgeRoutes");
const medicationReminderRouter = require("./routes/medicationReminderRoutes");
const {
  startMedicationReminderScheduler,
} = require("./services/medicationReminderPushService");
const { ensureFirebaseAdmin } = require("./utils/firebaseAdminInit");
const { logGooglePlayVerificationStatus } = require("./services/iapVerificationService");
// shd
const mongoUri = process.env.MONGODB_URI;
if (!mongoUri) {
  console.error("Missing MONGODB_URI. Create a .env file (see .env.example).");
  process.exit(1);
}

const app = express();
const port = Number(process.env.PORT) || 8000;
const defaultAllowedOrigins = [
  "https://adminofwifianalyzer.oxmite.com",
  "https://adminofallapss.oxmite.com",
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
  "http://127.0.0.1:8000",
  "http://127.0.0.1:3000"
];
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean)
  : defaultAllowedOrigins;

const corsOptions = {
  origin(origin, callback) {
    if (!origin) {
      return callback(null, true);
    }
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    console.warn(`[cors] blocked origin: ${origin}`);
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Origin", "X-Requested-With", "Content-Type", "Accept", "Authorization", "X-Service-Key", "X-Knowledge-Key"],
  optionsSuccessStatus: 204,
};

app.use("/uploads", express.static("uploads"));
app.use(
  cors(corsOptions)
);
app.options(/.*/, cors(corsOptions));
app.use(express.json({ limit: "4mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(ensureBody);

app.use((req, res, next) => {
  if (req.path.includes("/api/admin/auth/login")) {
    console.log(
      `[admin-login:request] ${req.method} ${req.originalUrl} origin=${req.headers.origin || "n/a"} contentType=${req.headers["content-type"] || "n/a"}`
    );
  }
  next();
});

app.get("/", (req, res) => {
  res.json({
    service: "Blood Pressure & Sugar Tracker API",
    app: "Blood Pressure & Sugar Tracker",
    description:
      "Backend for user auth, guest binding, profile data, notifications, premium subscriptions, per-feature limits, and app admin services.",
    endpoints: {
      auth: {
        guest: "POST /auth/guest",
        signup: "POST /auth/signup",
        verifyOtp: "POST /auth/verify-otp",
        login: "POST /auth/login",
        googleLogin: "POST /auth/google-login",
        profileGet: "GET /auth/profile/:id",
        profilePut: "PUT /auth/profile/:id",
        deleteAccount: "DELETE /auth/account",
        forgotPassword: "POST /auth/forgot-password",
        resetPassword: "POST /auth/reset-password",
      },
      generate: "POST /api/prompts/generate",
      list: "GET /api/prompts",
      getOne: "GET /api/prompts/:id",
      notifications: {
        registerToken:
          "POST /api/notifications/register-token (token required; userId optional string or Mongo id; JWT optional)",
        send: "POST /api/notifications/send",
      },
      promos: {
        list: "GET /api/app-promos",
        getOne: "GET /api/app-promos/:id",
      },
      chat: {
        guest: "POST /api/chat/guest (no auth)",
        respond: "POST /api/chat/respond (auth, auto-creates session)",
        entitlement: "GET /api/chat/entitlement",
        verifyIap: "POST /api/chat/iap/verify",
        restoreClear: "POST /api/chat/iap/restore-clear",
        createSession: "POST /api/chat/sessions",
        listSessions: "GET /api/chat/sessions",
        getSession: "GET /api/chat/sessions/:id",
        addMessages: "POST /api/chat/sessions/:id/messages",
        updateSession: "PATCH /api/chat/sessions/:id",
        deleteSession: "DELETE /api/chat/sessions/:id",
      },
      premiumFeatures: {
        limits: "GET /api/premium-features/limits",
        consume: "POST /api/premium-features/consume",
      },
      faq: {
        chat: "POST /api/faq/chat",
      },
      knowledge: {
        list: "GET /api/knowledge",
        create: "POST /api/knowledge (X-Service-Key, X-Knowledge-Key, or admin Bearer token)",
        merged: "GET /api/knowledge/merged",
      },
      admin: {
        login: "POST /api/admin/auth/login",
        users: "GET /api/admin/users",
        usage: "GET /api/admin/usage",
        banUser: "PATCH /api/admin/users/:id/ban",
        broadcastNotification: "POST /api/admin/notifications/broadcast",
        createPromo: "POST /api/admin/app-promos",
        updatePromo: "PUT/PATCH /api/admin/app-promos/:id",
        deletePromo: "DELETE /api/admin/app-promos/:id",
      },
    },
  });
});

app.use("/auth", userAuthRouter);
app.use("/api/prompts", promptRouter);
app.use("/api/notifications", notificationRouter);
app.use("/api/app-promos", appPromoRouter);
app.use("/api/admin/auth", adminAuthRouter);
app.use("/api/admin", adminRouter);
app.use("/api/admin/app-promos", adminPromoRouter);
app.use("/api/chat", chatRouter);
app.use("/api/premium-features", premiumFeatureRouter);
app.use("/api/faq", faqRouter);
app.use("/api/knowledge", knowledgeRouter);
app.use("/api/medication-reminders", medicationReminderRouter);
// gsddhh
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((error, req, res, next) => {
  console.error(`[express-error] ${req.method} ${req.originalUrl}:`, error.message);
  if (res.headersSent) {
    return next(error);
  }
  return res.status(500).json({ error: "Internal server error" });
});

MongoDBConnect(mongoUri)
  .then(() => {
    console.log(`[cors] allowed origins: ${allowedOrigins.join(", ")}`);
    const firebaseAdmin = ensureFirebaseAdmin();
    console.log(
      `[firebase] Push notifications: ${firebaseAdmin ? "ready" : "not configured (set FIREBASE_SERVICE_ACCOUNT or firebase-service-account.json)"}`
    );
    app.listen(port, () => {
      console.log(`Server listening on port ${port}`);
    });
    startMedicationReminderScheduler();
    logGooglePlayVerificationStatus();
  })
  .catch(() => process.exit(1));

process.on("uncaughtException", (error) => {
  console.error("[process] uncaughtException:", error);
});

process.on("unhandledRejection", (reason) => {
  console.error("[process] unhandledRejection:", reason);
});
