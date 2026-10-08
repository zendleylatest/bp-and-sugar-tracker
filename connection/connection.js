const mongoose = require("mongoose");

async function MongoDBConnect(url) {
  const dbName = process.env.MONGODB_DB_NAME || "ai_prompt_generator";
  try {
    await mongoose.connect(url, { dbName });
    console.log(`MongoDB connected (database: ${dbName}).`);
  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
    throw error;
  }
}

module.exports = MongoDBConnect;
