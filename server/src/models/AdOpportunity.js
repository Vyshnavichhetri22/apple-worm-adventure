import mongoose from 'mongoose';

export const AD_PLACEMENTS = [
  'GAME_OVER_REVIVE',
  'MOVE_EXHAUSTED_EXTRA',
  'SESSION_BOOSTER',
  'POST_WIN_DOUBLE_COIN',
  'POST_WIN_DOUBLE_SCORE',
  'STORE_FREE_COINS',
];

export const AD_REWARD_TYPES = [
  'REVIVE',
  'EXTRA_MOVES',
  'BOOSTER',
  'DOUBLE_COINS',
  'DOUBLE_SCORE',
  'COIN_REWARD',
];

export const AD_OPPORTUNITY_STATUSES = [
  'REQUESTED',
  'AD_STARTED',
  'AD_COMPLETED',
  'VERIFYING',
  'VERIFIED',
  'GRANTING',
  'GRANTED',
  'REJECTED',
  'EXPIRED',
  'GRANT_FAILED',
];

const adOpportunitySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'GameSession',
      default: null,
      index: true,
    },
    placement: {
      type: String,
      enum: {
        values: AD_PLACEMENTS,
        message: '{VALUE} is not a valid ad placement',
      },
      required: true,
      index: true,
    },
    rewardType: {
      type: String,
      enum: {
        values: AD_REWARD_TYPES,
        message: '{VALUE} is not a valid ad reward type',
      },
      required: true,
    },
    rewardAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    boosterType: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: {
        values: AD_OPPORTUNITY_STATUSES,
        message: '{VALUE} is not a valid ad opportunity status',
      },
      default: 'REQUESTED',
      required: true,
      index: true,
    },
    customDataNonce: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    provider: {
      type: String,
      enum: ['ADMOB', 'MOCK'],
      default: 'MOCK',
    },
    providerTransactionId: {
      type: String,
      default: null,
      sparse: true,
      index: true,
    },
    grantId: {
      type: String,
      default: null,
    },
    grantLockExpiresAt: {
      type: Date,
      default: null,
      index: true,
    },
    grantingStartedAt: {
      type: Date,
      default: null,
    },
    grantedAt: {
      type: Date,
      default: null,
    },
    grantDetails: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    grantError: {
      type: String,
      default: null,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

adOpportunitySchema.index({ userId: 1, status: 1 });
adOpportunitySchema.index({ sessionId: 1, placement: 1 });
adOpportunitySchema.index({ userId: 1, createdAt: -1 });

const AdOpportunity =
  mongoose.models.AdOpportunity || mongoose.model('AdOpportunity', adOpportunitySchema);

export default AdOpportunity;