import mongoose from 'mongoose';

export const TRANSACTION_TYPES = [
  'LEVEL_REWARD',
  'GOLDEN_APPLE_REWARD',
  'STAR_BONUS',
  'DAILY_REWARD',
  'AD_REWARD',
  'ACHIEVEMENT_REWARD',
  'STREAK_MILESTONE_REWARD',
  'HINT_PURCHASE',
  'UNDO_PURCHASE',
  'BOOSTER_PURCHASE',
  'REVIVE_REWARD',
  'BONUS',
  'REVERSAL',
];

export const TRANSACTION_DIRECTIONS = ['CREDIT', 'DEBIT'];

const walletTransactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User reference is required'],
      index: true,
    },
    walletId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Wallet',
      required: [true, 'Wallet reference is required'],
      index: true,
    },
    // Canonical operation ID for exact-once recovery and deduplication
    opId: {
      type: String,
      default: null,
      trim: true,
    },
    // Monotonic sequence number allocated by Wallet atomic mutation
    sequence: {
      type: Number,
      default: null,
      validate: {
        validator: (v) =>
          v === null ||
          v === undefined ||
          (Number.isInteger(v) && v >= 1 && Number.isSafeInteger(v)),
        message: 'Transaction sequence must be a positive safe integer or null for legacy records',
      },
    },
    // Deterministic cryptographic checksum of canonical operation identity
    fingerprint: {
      type: String,
      default: null,
      trim: true,
    },
    // Version of canonical fingerprint serialization format
    fingerprintVersion: {
      type: Number,
      default: null,
      validate: {
        validator: (v) =>
          v === null ||
          v === undefined ||
          (Number.isInteger(v) && v >= 1),
        message: 'Transaction fingerprintVersion must be a positive integer or null for legacy records',
      },
    },
    direction: {
      type: String,
      enum: {
        values: TRANSACTION_DIRECTIONS,
        message: '{VALUE} is not a valid transaction direction',
      },
      required: [true, 'Transaction direction (CREDIT/DEBIT) is required'],
      index: true,
    },
    type: {
      type: String,
      enum: {
        values: TRANSACTION_TYPES,
        message: '{VALUE} is not a valid transaction type',
      },
      required: [true, 'Transaction type is required'],
      index: true,
    },
    amount: {
      type: Number,
      required: [true, 'Transaction amount is required'],
      min: [1, 'Transaction amount must be at least 1'],
      validate: {
        validator: (v) => Number.isInteger(v) && v >= 1 && Number.isSafeInteger(v),
        message: 'Transaction amount must be a positive safe integer',
      },
    },
    balanceBefore: {
      type: Number,
      required: [true, 'balanceBefore is required'],
      min: [0, 'balanceBefore cannot be negative'],
      validate: {
        validator: (v) => Number.isInteger(v) && v >= 0 && Number.isSafeInteger(v),
        message: 'balanceBefore must be a non-negative safe integer',
      },
    },
    balanceAfter: {
      type: Number,
      required: [true, 'balanceAfter is required'],
      min: [0, 'balanceAfter cannot be negative'],
      validate: {
        validator: (v) => Number.isInteger(v) && v >= 0 && Number.isSafeInteger(v),
        message: 'balanceAfter must be a non-negative safe integer',
      },
    },
    referenceId: {
      type: String,
      default: null,
      index: true,
    },
    idempotencyKey: {
      type: String,
      default: null,
      trim: true,
    },
    description: {
      type: String,
      required: [true, 'Transaction description is required'],
      trim: true,
      maxlength: [200, 'Description cannot exceed 200 characters'],
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    createdAt: {
      type: Date,
      default: Date.now,
      immutable: true,
      index: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
  }
);

// High-performance compound indexes for user transaction queries and audits
walletTransactionSchema.index({ userId: 1, createdAt: -1 });
walletTransactionSchema.index({ walletId: 1, createdAt: -1 });
walletTransactionSchema.index({ referenceId: 1, type: 1 });

// User-scoped compound unique index for transaction idempotency.
walletTransactionSchema.index(
  { userId: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: 'string' } },
    name: 'userId_1_idempotencyKey_1',
  }
);

// User-scoped compound unique index for operation identity (opId).
// Strictly matches the Step 2.1A migration utility specification.
walletTransactionSchema.index(
  { userId: 1, opId: 1 },
  {
    unique: true,
    partialFilterExpression: { opId: { $type: 'string' } },
    name: 'userId_1_opId_1',
  }
);

// Strictly enforce immutability: prevent updates and deletions from application code
const rejectMutation = function () {
  throw new Error('WalletTransaction is an immutable append-only ledger and cannot be altered or removed.');
};

walletTransactionSchema.pre('updateOne', rejectMutation);
walletTransactionSchema.pre('updateMany', rejectMutation);
walletTransactionSchema.pre('findOneAndUpdate', rejectMutation);
walletTransactionSchema.pre('replaceOne', rejectMutation);
walletTransactionSchema.pre('findOneAndReplace', rejectMutation);
walletTransactionSchema.pre('deleteOne', rejectMutation);
walletTransactionSchema.pre('deleteMany', rejectMutation);
walletTransactionSchema.pre('findOneAndDelete', rejectMutation);

walletTransactionSchema.pre('save', function () {
  if (!this.isNew) {
    throw new Error('WalletTransaction is an immutable append-only ledger and cannot be altered or removed.');
  }
});

walletTransactionSchema.pre('bulkWrite', function (ops) {
  if (Array.isArray(ops)) {
    for (const op of ops) {
      if (
        op.updateOne ||
        op.updateMany ||
        op.replaceOne ||
        op.deleteOne ||
        op.deleteMany
      ) {
        throw new Error(
          'WalletTransaction is an immutable append-only ledger and cannot be altered or removed via bulkWrite.'
        );
      }
    }
  }
});

const WalletTransaction =
  mongoose.models.WalletTransaction ||
  mongoose.model('WalletTransaction', walletTransactionSchema);

export default WalletTransaction;
