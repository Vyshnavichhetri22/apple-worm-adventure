import mongoose from 'mongoose';

const dailyChallengeCompletionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    date: {
      type: String,
      required: true,
      index: true, // UTC Date formatted as 'YYYY-MM-DD'
    },
    levelNumber: {
      type: Number,
      required: true,
      min: 1,
    },
    levelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Level',
      default: null,
    },
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'GameSession',
      default: null,
    },
    completed: {
      type: Boolean,
      default: true,
    },
    completedAt: {
      type: Date,
      default: Date.now,
    },
    score: {
      type: Number,
      default: 0,
      min: 0,
    },
    moves: {
      type: Number,
      default: 0,
      min: 0,
    },
    durationSeconds: {
      type: Number,
      default: 0,
      min: 0,
    },
    rewardCoins: {
      type: Number,
      default: 150,
      min: 0,
    },
    rewardClaimed: {
      type: Boolean,
      default: true,
    },
    streakCount: {
      type: Number,
      default: 1,
      min: 1,
    },
  },
  {
    timestamps: true,
  }
);

// Compound unique index strictly guarantees at most ONE completed record per user per UTC day
dailyChallengeCompletionSchema.index({ userId: 1, date: 1 }, { unique: true });
dailyChallengeCompletionSchema.index({ date: 1, score: -1 });

const DailyChallengeCompletion = mongoose.model(
  'DailyChallengeCompletion',
  dailyChallengeCompletionSchema
);

export default DailyChallengeCompletion;
