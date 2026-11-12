import mongoose from 'mongoose';

const coordinateSchema = new mongoose.Schema(
  {
    x: { type: Number, required: true },
    y: { type: Number, required: true },
  },
  { _id: false }
);

const checkpointSchema = new mongoose.Schema(
  {
    checkpointIndex: { type: Number, default: 0, min: 0 },
    wormState: {
      type: [coordinateSchema],
      required: true,
      validate: {
        validator: (val) => Array.isArray(val) && val.length >= 2,
        message: 'Checkpoint wormState must have at least 2 segments.',
      },
    },
    applesRemaining: { type: [coordinateSchema], default: [] },
    keysRemaining: { type: [coordinateSchema], default: [] },
    movesTaken: { type: Number, required: true, min: 0 },
    currentScore: { type: Number, required: true, min: 0 },
    savedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const appliedRewardSchema = new mongoose.Schema(
  {
    opportunityId: { type: String, required: true },
    rewardType: { type: String, required: true },
    amount: { type: Number, default: 0 },
    appliedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const gameSessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    levelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Level',
      required: true,
      index: true,
    },
    levelNumber: {
      type: Number,
      required: true,
      min: 1,
      index: true,
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'COMPLETED', 'FAILED', 'ABANDONED'],
      default: 'ACTIVE',
      index: true,
    },
    startedAt: {
      type: Date,
      default: Date.now,
    },
    endedAt: {
      type: Date,
      default: null,
    },
    durationSeconds: {
      type: Number,
      default: 0,
      min: 0,
    },
    moves: {
      type: Number,
      default: 0,
      min: 0,
    },
    score: {
      type: Number,
      default: 0,
      min: 0,
    },
    applesCollected: {
      type: Number,
      default: 0,
      min: 0,
    },
    starsEarned: {
      type: Number,
      default: 0,
      min: 0,
      max: 3,
    },
    coinsEarned: {
      type: Number,
      default: 0,
      min: 0,
    },
    revivesUsed: {
      type: Number,
      default: 0,
      min: 0,
    },
    boostersUsed: {
      type: [String],
      default: [],
    },
    availableBoosters: {
      type: [String],
      default: [],
    },
    extraMovesAllowed: {
      type: Number,
      default: 0,
      min: 0,
    },
    appliedAdRewards: {
      type: [appliedRewardSchema],
      default: [],
    },
    failureReason: {
      type: String,
      enum: [
        'OUT_OF_MOVES',
        'HIT_SPIKE',
        'FALLEN_OFF_GRID',
        'TRAPPED',
        'MANUAL_RESTART',
        'TIMEOUT',
        'ABANDONED',
        null,
      ],
      default: null,
    },
    initialState: {
      worm: { type: [coordinateSchema], required: true },
      apples: { type: [coordinateSchema], default: [] },
      keys: { type: [coordinateSchema], default: [] },
      portal: { type: coordinateSchema, required: true },
      grid: {
        cols: { type: Number, required: true },
        rows: { type: Number, required: true },
      },
    },
    checkpoint: {
      type: checkpointSchema,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

gameSessionSchema.index({ userId: 1, status: 1 });
gameSessionSchema.index({ userId: 1, levelNumber: 1, status: 1 });
gameSessionSchema.index({ createdAt: -1 });

const GameSession = mongoose.model('GameSession', gameSessionSchema);

export default GameSession;