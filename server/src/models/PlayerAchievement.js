import mongoose from 'mongoose';

export const ACHIEVEMENT_DEFINITIONS = {
  FIRST_VICTORY: {
    id: 'FIRST_VICTORY',
    title: 'First Victory',
    description: 'Complete your very first puzzle level.',
    icon: '🏆',
    target: 1,
    rewardCoins: 50,
  },
  APPLE_COLLECTOR: {
    id: 'APPLE_COLLECTOR',
    title: 'Apple Collector',
    description: 'Collect 50 apples across all completed puzzles.',
    icon: '🍎',
    target: 50,
    rewardCoins: 100,
  },
  WORM_MASTER: {
    id: 'WORM_MASTER',
    title: 'Worm Master',
    description: 'Grow your worm to 6 or more body segments.',
    icon: '🐛',
    target: 6,
    rewardCoins: 75,
  },
  SPEED_RUNNER: {
    id: 'SPEED_RUNNER',
    title: 'Speed Runner',
    description: 'Complete any level in 15 seconds or less.',
    icon: '⚡',
    target: 1,
    rewardCoins: 80,
  },
  STAR_CHAMPION: {
    id: 'STAR_CHAMPION',
    title: 'Star Champion',
    description: 'Accumulate 30 stars across all completed puzzles.',
    icon: '⭐',
    target: 30,
    rewardCoins: 150,
  },
  PIT_BRIDGER: {
    id: 'PIT_BRIDGER',
    title: 'Pit Bridger',
    description: 'Bridge a pit hazard with a pushed boulder.',
    icon: '🪨',
    target: 1,
    rewardCoins: 60,
  },
  KEY_HUNTER: {
    id: 'KEY_HUNTER',
    title: 'Key Hunter',
    description: 'Collect 5 keys to open locked security gates.',
    icon: '🔑',
    target: 5,
    rewardCoins: 75,
  },
  LEVEL_EXPLORER: {
    id: 'LEVEL_EXPLORER',
    title: 'Level Explorer',
    description: 'Advance and unlock Level 10.',
    icon: '🗺️',
    target: 10,
    rewardCoins: 120,
  },
  MYSTERY_LOVER: {
    id: 'MYSTERY_LOVER',
    title: 'Mystery Lover',
    description: 'Discover and consume 5 mystery apples.',
    icon: '❓',
    target: 5,
    rewardCoins: 100,
  },
  VETERAN_PLAYER: {
    id: 'VETERAN_PLAYER',
    title: 'Veteran Player',
    description: 'Conquer and complete 20 puzzle levels.',
    icon: '🎖️',
    target: 20,
    rewardCoins: 200,
  },
};

const playerAchievementSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    achievementId: {
      type: String,
      required: true,
      enum: Object.keys(ACHIEVEMENT_DEFINITIONS),
    },
    unlocked: {
      type: Boolean,
      default: false,
    },
    unlockedAt: {
      type: Date,
      default: null,
    },
    claimed: {
      type: Boolean,
      default: false,
    },
    claimedAt: {
      type: Date,
      default: null,
    },
    rewardCoins: {
      type: Number,
      required: true,
      min: 0,
    },
    progress: {
      type: Number,
      default: 0,
      min: 0,
    },
    target: {
      type: Number,
      required: true,
      min: 1,
    },
  },
  {
    timestamps: true,
  }
);

// Compound unique index prevents race condition duplicate records per user/achievement
playerAchievementSchema.index({ userId: 1, achievementId: 1 }, { unique: true });

const PlayerAchievement = mongoose.model('PlayerAchievement', playerAchievementSchema);

export default PlayerAchievement;
