import mongoose from 'mongoose';

export const TRANSACTION_TYPES = [
  'LEVEL_REWARD',
  'GOLDEN_APPLE_REWARD',
  'STAR_BONUS',
  'DAILY_REWARD',
  'AD_REWARD',
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
        validator: Number.isInteger,
        message: 'Transaction amount must be an integer',
      },
    },
    balanceBefore: {
      type: Number,
      required: [true, 'balanceBefore is required'],
      min: [0, 'balanceBefore cannot be negative'],
      validate: {
        validator: Number.isInteger,
        message: 'balanceBefore must be an integer',
      },
    },
    balanceAfter: {
      type: Number,
      required: [true, 'balanceAfter is required'],
      min: [0, 'balanceAfter cannot be negative'],
      validate: {
        validator: Number.isInteger,
        message: 'balanceAfter must be an integer',
      },
    },
    referenceId: {
      type: String,
      default: null,
      index: true,
    },
    idempotencyKey: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
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

// Strictly enforce immutability: prevent updates and deletions from application code
const rejectMutation = function () {
  throw new Error('WalletTransaction is an immutable append-only ledger and cannot be altered or removed.');
};

walletTransactionSchema.pre('updateOne', rejectMutation);
walletTransactionSchema.pre('updateMany', rejectMutation);
walletTransactionSchema.pre('findOneAndUpdate', rejectMutation);
walletTransactionSchema.pre('deleteOne', rejectMutation);
walletTransactionSchema.pre('deleteMany', rejectMutation);

const WalletTransaction =
  mongoose.models.WalletTransaction ||
  mongoose.model('WalletTransaction', walletTransactionSchema);

export default WalletTransaction;