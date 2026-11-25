import mongoose from 'mongoose';

export const STREAK_MILESTONES = {
  3: { days: 3, rewardCoins: 100, label: '3-Day Streak', icon: '🥉' },
  7: { days: 7, rewardCoins: 250, label: '7-Day Streak', icon: '🥈' },
  14: { days: 14, rewardCoins: 500, label: '14-Day Streak', icon: '🥇' },
  30: { days: 30, rewardCoins: 1000, label: '30-Day Master', icon: '👑' },
};

const playerDailyStreakSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    currentStreak: {
      type: Number,
      default: 0,
      min: 0,
    },
    longestStreak: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastCompletedDate: {
      type: String,
      default: null, // UTC 'YYYY-MM-DD'
    },
    claimedMilestones: {
      type: [Number],
      default: [],
    },
    totalCompletions: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastCompletionAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

const PlayerDailyStreak = mongoose.model('PlayerDailyStreak', playerDailyStreakSchema);

export default PlayerDailyStreak;
