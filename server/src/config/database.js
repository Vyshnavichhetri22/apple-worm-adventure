import mongoose from "mongoose";

const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error("MONGODB_URI is not defined.");
    }

    // Safety gate: If running in staging, strictly fail closed against production
    if (process.env.NODE_ENV === 'staging') {
      if (!mongoUri.includes('/apple_worm_staging')) {
        throw new Error(`SAFETY REFUSAL: NODE_ENV is staging, but target database in MONGODB_URI is not "apple_worm_staging"!`);
      }
      if (mongoUri.includes('apple_worm_adventure')) {
        throw new Error("SAFETY REFUSAL: Production database detected while running in staging mode!");
      }
    }

    const connection = await mongoose.connect(
      mongoUri,
      {
        serverSelectionTimeoutMS: 10000,
      }
    );

    console.log(
      `MongoDB connected: ${connection.connection.host}`
    );

    console.log(
      `Database name: ${connection.connection.name}`
    );
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);
    process.exit(1);
  }
};

export default connectDB;
