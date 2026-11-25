import mongoose from 'mongoose';

/**
 * Subdocument schema representing an unsettled financial operation snapshot
 * pending ledger settlement or recovery.
 *
 * Immutability: snapshots represent an atomic in-flight operation state.
 * Subdocument IDs are explicitly disabled (_id: false) to prevent schema pollution.
 */
const unsettledOperationSchema = new mongoose.Schema(
  {
    opId: {
      type: String,
      required: [true, 'Snapshot opId is required'],
      trim: true,
    },
    sequence: {
      type: Number,
      required: [true, 'Snapshot sequence is required'],
      validate: {
        validator: (v) => Number.isInteger(v) && v >= 1 && Number.isSafeInteger(v),
        message: 'Snapshot sequence must be a positive safe integer',
      },
    },
    amount: {
      type: Number,
      required: [true, 'Snapshot amount is required'],
      validate: {
        validator: (v) => Number.isInteger(v) && v >= 1 && Number.isSafeInteger(v),
        message: 'Snapshot amount must be a positive safe integer',
      },
    },
    direction: {
      type: String,
      required: [true, 'Snapshot direction is required'],
      enum: {
        values: ['CREDIT', 'DEBIT'],
        message: '{VALUE} is not a valid snapshot direction',
      },
    },
    type: {
      type: String,
      required: [true, 'Snapshot type is required'],
      trim: true,
    },
    referenceId: {
      type: String,
      default: null,
      trim: true,
    },
    idempotencyKey: {
      type: String,
      default: null,
      trim: true,
    },
    balanceBefore: {
      type: Number,
      required: [true, 'Snapshot balanceBefore is required'],
      validate: {
        validator: (v) => Number.isInteger(v) && v >= 0 && Number.isSafeInteger(v),
        message: 'Snapshot balanceBefore must be a non-negative safe integer',
      },
    },
    balanceAfter: {
      type: Number,
      required: [true, 'Snapshot balanceAfter is required'],
      validate: {
        validator: (v) => Number.isInteger(v) && v >= 0 && Number.isSafeInteger(v),
        message: 'Snapshot balanceAfter must be a non-negative safe integer',
      },
    },
    fingerprint: {
      type: String,
      required: [true, 'Snapshot fingerprint is required'],
      trim: true,
    },
    fingerprintVersion: {
      type: Number,
      required: [true, 'Snapshot fingerprintVersion is required'],
      validate: {
        validator: (v) => Number.isInteger(v) && v >= 1,
        message: 'Snapshot fingerprintVersion must be a positive integer',
      },
    },
    createdAt: {
      type: Date,
      default: Date.now,
      required: true,
    },
  },
  {
    _id: false, // Ensures snapshots are not assigned unnecessary Mongoose subdocument IDs
    versionKey: false,
  }
);

const walletSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User reference is required for a wallet'],
      unique: true,
      index: true,
    },
    balance: {
      type: Number,
      required: [true, 'Wallet balance is required'],
      default: 0,
      min: [0, 'Wallet balance cannot be negative'],
      validate: {
        validator: (v) => Number.isInteger(v) && v >= 0 && Number.isSafeInteger(v),
        message: 'Wallet balance must be a non-negative safe integer <= Number.MAX_SAFE_INTEGER',
      },
    },
    currency: {
      type: String,
      default: 'COIN',
      uppercase: true,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // Strictly monotonic operation sequence counter
    sequence: {
      type: Number,
      default: function () {
        return this.isNew ? 0 : undefined;
      },
      validate: {
        validator: (v) =>
          v === undefined ||
          v === null ||
          (Number.isInteger(v) && v >= 0 && Number.isSafeInteger(v)),
        message: 'Wallet sequence must be a non-negative safe integer',
      },
    },
    // Frozen historical balance at baseline establishment
    baselineBalance: {
      type: Number,
      default: function () {
        return this.isNew ? (this.balance ?? 0) : undefined;
      },
      validate: {
        validator: (v) =>
          v === undefined ||
          v === null ||
          (Number.isInteger(v) && v >= 0 && Number.isSafeInteger(v)),
        message: 'Wallet baselineBalance must be a non-negative safe integer',
      },
    },
    // Sequence value at baseline establishment (always 0)
    baselineSequence: {
      type: Number,
      default: function () {
        return this.isNew ? 0 : undefined;
      },
      validate: {
        validator: (v) =>
          v === undefined ||
          v === null ||
          (Number.isInteger(v) && v >= 0 && Number.isSafeInteger(v)),
        message: 'Wallet baselineSequence must be a non-negative safe integer',
      },
    },
    // In-flight unsettled operations array
    unsettledOperations: {
      type: [unsettledOperationSchema],
      default: function () {
        return this.isNew ? [] : undefined;
      },
    },
    // Timestamp when baseline was established
    baselineEstablishedAt: {
      type: Date,
      default: function () {
        return this.isNew ? new Date() : undefined;
      },
    },
    // Operational recovery metadata for starvation prevention & exponential backoff
    recoveryAttempts: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastRecoveryAttemptAt: {
      type: Date,
      default: null,
    },
    nextRecoveryAttemptAt: {
      type: Date,
      default: null,
      index: true,
    },
    lastRecoveryError: {
      type: String,
      default: null,
      trim: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

walletSchema.index({ balance: 1 });

// Document-level validation hook for save()
walletSchema.pre('save', function () {
  if (!this.isNew) {
    // 1. Sequence monotonicity: sequence cannot decrease below baselineSequence
    if (this.isModified('sequence') && this.sequence !== undefined && this.sequence !== null) {
      if (
        this.baselineSequence !== undefined &&
        this.baselineSequence !== null &&
        this.sequence < this.baselineSequence
      ) {
        throw new Error(
          `Wallet sequence (${this.sequence}) cannot be less than baselineSequence (${this.baselineSequence}).`
        );
      }
    }

    // 2. Baseline immutability: once established, baseline fields cannot be altered via save()
    if (this.isModified('baselineSequence') || this.isModified('baselineBalance')) {
      throw new Error(
        'Wallet baseline fields (baselineBalance, baselineSequence) are immutable once established.'
      );
    }
  }
});

// Replacement updates prevention
const rejectReplacement = function () {
  throw new Error('Wallet replacement updates (replaceOne/findOneAndReplace) are forbidden.');
};

walletSchema.pre('replaceOne', rejectReplacement);
walletSchema.pre('findOneAndReplace', rejectReplacement);

// Query-level update validation
walletSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate'], function () {
  const update = this.getUpdate();
  if (!update) return;

  // Case A: Aggregation update pipeline: [ { $set: ... }, ... ]
  if (Array.isArray(update)) {
    for (const stage of update) {
      if (!stage || typeof stage !== 'object') {
        throw new Error('Invalid pipeline update stage: stage must be an object.');
      }
    }
    return;
  }

  // Case B: Document update object
  if (typeof update === 'object') {
    // Detect accidental replacement updates or mixed top-level field updates passed without atomic operators
    const topLevelKeys = Object.keys(update);
    const nonAtomicKeys = topLevelKeys.filter((k) => !k.startsWith('$'));
    if (nonAtomicKeys.length > 0) {
      throw new Error(
        `Direct replacement updates are forbidden: [${nonAtomicKeys.join(', ')}]. Updates must use atomic operators ($set, $inc, etc.) or update pipelines.`
      );
    }

    // Validate $set fields if present
    if (update.$set) {
      if (update.$set.sequence !== undefined) {
        const s = update.$set.sequence;
        if (
          s !== null &&
          (typeof s !== 'number' || !Number.isInteger(s) || s < 0 || !Number.isSafeInteger(s))
        ) {
          throw new Error(`Invalid sequence in update: ${s}. Must be a non-negative safe integer.`);
        }
      }
      if (update.$set.balance !== undefined) {
        const b = update.$set.balance;
        if (
          typeof b !== 'number' ||
          !Number.isInteger(b) ||
          b < 0 ||
          !Number.isSafeInteger(b)
        ) {
          throw new Error(`Invalid balance in update: ${b}. Must be a non-negative safe integer.`);
        }
      }
    }

    // Validate $inc fields if present
    if (update.$inc) {
      if (update.$inc.sequence !== undefined) {
        const incSeq = update.$inc.sequence;
        if (typeof incSeq !== 'number' || !Number.isInteger(incSeq) || incSeq < 0) {
          throw new Error(
            `Sequence decrement via $inc is forbidden: ${incSeq}. Sequence must be strictly monotonic.`
          );
        }
      }
    }
  }
});


const Wallet = mongoose.models.Wallet || mongoose.model('Wallet', walletSchema);

export default Wallet;
