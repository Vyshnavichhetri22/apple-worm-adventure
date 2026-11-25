import mongoose from 'mongoose';

const coordinateSchema = new mongoose.Schema(
  {
    x: { type: Number, required: true },
    y: { type: Number, required: true },
  },
  { _id: false }
);

const appleItemSchema = new mongoose.Schema(
  {
    x: { type: Number, required: true },
    y: { type: Number, required: true },
    type: { type: String, default: 'normal' },
  },
  { _id: false }
);

const keyItemSchema = new mongoose.Schema(
  {
    x: { type: Number, required: true },
    y: { type: Number, required: true },
    keyId: { type: String, default: 'default' },
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
    direction: { type: String, default: 'RIGHT' },
    movesTaken: { type: Number, required: true, min: 0 },
    applesEaten: { type: Number, default: 0, min: 0 },
    goldenApplesEaten: { type: Number, default: 0, min: 0 },
    megaApplesEaten: { type: Number, default: 0, min: 0 },
    timeApplesEaten: { type: Number, default: 0, min: 0 },
    mysteryApplesEaten: { type: Number, default: 0, min: 0 },
    mysteryEffectsApplied: {
      type: [
        {
          x: Number,
          y: Number,
          type: { type: String },
          value: Number,
        },
      ],
      default: [],
    },
    currentScore: { type: Number, required: true, min: 0 },
    applesRemaining: { type: [appleItemSchema], default: [] },
    keysRemaining: { type: [keyItemSchema], default: [] },
    stones: { type: [coordinateSchema], default: [] },
    collectedKeys: { type: [String], default: [] },
    filledPits: { type: [String], default: [] },
    savedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const appliedBoosterSchema = new mongoose.Schema(
  {
    idempotencyKey: { type: String, required: true },
    boosterType: { type: String, required: true },
    movesAdded: { type: Number, required: true },
    appliedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const appliedUndoSchema = new mongoose.Schema(
  {
    idempotencyKey: { type: String, required: true },
    restoredMoves: { type: Number, required: true },
    restoredCheckpoint: { type: checkpointSchema, required: true },
    appliedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const appliedHintSchema = new mongoose.Schema(
  {
    idempotencyKey: { type: String, required: true },
    hintType: { type: String, default: 'NEXT_MOVES' },
    solutionMoves: { type: [String], default: [] },
    appliedAt: { type: Date, default: Date.now },
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
    isDailyChallenge: {
      type: Boolean,
      default: false,
      index: true,
    },
    challengeDate: {
      type: String,
      default: null,
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
    goldenApplesCollected: {
      type: Number,
      default: 0,
      min: 0,
    },
    megaApplesCollected: {
      type: Number,
      default: 0,
      min: 0,
    },
    timeApplesCollected: {
      type: Number,
      default: 0,
      min: 0,
    },
    mysteryApplesCollected: {
      type: Number,
      default: 0,
      min: 0,
    },
    mysteryEffects: {
      type: [
        {
          x: Number,
          y: Number,
          type: { type: String },
          value: Number,
        },
      ],
      default: [],
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
    extraMovesAllowed: {
      type: Number,
      default: 0,
      min: 0,
    },
    boostersUsed: {
      type: Number,
      default: 0,
      min: 0,
    },
    undosUsed: {
      type: Number,
      default: 0,
      min: 0,
    },
    hintsUsed: {
      type: Number,
      default: 0,
      min: 0,
    },
    revivesUsed: {
      type: Number,
      default: 0,
      min: 0,
    },
    appliedBoosters: {
      type: [appliedBoosterSchema],
      default: [],
    },
    appliedUndos: {
      type: [appliedUndoSchema],
      default: [],
    },
    appliedHints: {
      type: [appliedHintSchema],
      default: [],
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
        'SELF_COLLISION',
        'CRUSHED',
        'TRAPPED',
        'MANUAL_RESTART',
        'TIMEOUT',
        'ABANDONED',
        null,
      ],
      default: null,
    },
    initialState: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    checkpoint: {
      type: checkpointSchema,
      default: null,
    },
    checkpointHistory: {
      type: [checkpointSchema],
      default: [],
    },
    rewardClaimed: {
      type: Boolean,
      default: false,
    },
    rewardTransactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WalletTransaction',
      default: null,
    },
    rewardBreakdown: {
      type: mongoose.Schema.Types.Mixed,
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