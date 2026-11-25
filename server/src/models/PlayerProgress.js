import mongoose from 'mongoose';

const levelProgressRecordSchema = new mongoose.Schema(
  {
    levelNumber: {
      type: Number,
      required: true,
      min: 1,
    },
    stars: {
      type: Number,
      required: true,
      min: 1,
      max: 3,
      default: 1,
    },
    highScore: {
      type: Number,
      default: 0,
      min: 0,
    },
    leastMoves: {
      type: Number,
      default: 0,
      min: 0,
    },
    fastestTimeSeconds: {
      type: Number,
      default: 0,
      min: 0,
    },
    attemptsCount: {
      type: Number,
      default: 1,
      min: 1,
    },
    goldenApplesClaimed: {
      type: Number,
      default: 0,
      min: 0,
    },
    megaApplesClaimed: {
      type: Number,
      default: 0,
      min: 0,
    },
    timeApplesClaimed: {
      type: Number,
      default: 0,
      min: 0,
    },
    mysteryApplesClaimed: {
      type: Number,
      default: 0,
      min: 0,
    },
    firstCompletedAt: {
      type: Date,
      default: Date.now,
    },
    lastCompletedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const playerProgressSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    currentLevel: {
      type: Number,
      default: 1,
      min: 1,
    },
    highestUnlockedLevel: {
      type: Number,
      default: 1,
      min: 1,
    },
    completedLevels: {
      type: [levelProgressRecordSchema],
      default: [],
    },
    totalScore: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalStars: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalApplesEaten: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalGoldenApplesEaten: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalMegaApplesEaten: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalTimeApplesEaten: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalMysteryApplesEaten: {
      type: Number,
      default: 0,
      min: 0,
    },
    currentStreak: {
      type: Number,
      default: 0,
      min: 0,
    },
    bestStreak: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastPlayedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

playerProgressSchema.index({ currentLevel: 1 });
playerProgressSchema.index({ totalScore: -1 });

const PlayerProgress = mongoose.model('PlayerProgress', playerProgressSchema);

export default PlayerProgress;