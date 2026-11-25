/**
 * server/src/models/Inventory.js
 * Authoritative schema and model for Player Consumable Inventory.
 *
 * Enforces:
 * - Exactly one inventory document per user (unique userId index)
 * - Safe non-negative stock counts for UNDO, HINT, and BOOSTER
 * - Durable fulfillment records (FULFILLED, REFUND_PENDING, REFUNDED)
 * - Idempotent consumption history with point-in-time snapshots
 */

import mongoose from 'mongoose';

const itemStockSchema = new mongoose.Schema(
  {
    quantity: {
      type: Number,
      required: [true, 'Item quantity is required'],
      default: 0,
      min: [0, 'Item quantity cannot be negative'],
      validate: {
        validator: Number.isInteger,
        message: 'Item quantity must be an integer',
      },
    },
    totalPurchased: {
      type: Number,
      required: [true, 'totalPurchased is required'],
      default: 0,
      min: [0, 'Total purchased cannot be negative'],
      validate: {
        validator: Number.isInteger,
        message: 'Total purchased must be an integer',
      },
    },
    totalConsumed: {
      type: Number,
      required: [true, 'totalConsumed is required'],
      default: 0,
      min: [0, 'Total consumed cannot be negative'],
      validate: {
        validator: Number.isInteger,
        message: 'Total consumed must be an integer',
      },
    },
  },
  { _id: false }
);

const fulfillmentSchema = new mongoose.Schema(
  {
    purchaseId: {
      type: mongoose.Schema.Types.ObjectId,
      required: [true, 'Purchase ID reference is required'],
    },
    itemType: {
      type: String,
      enum: {
        values: ['UNDO', 'HINT', 'BOOSTER'],
        message: '{VALUE} is not a valid item type',
      },
      required: [true, 'Item type is required'],
    },
    status: {
      type: String,
      enum: {
        values: ['FULFILLED', 'REFUND_PENDING', 'REFUNDED'],
        message: '{VALUE} is not a valid fulfillment status',
      },
      required: [true, 'Fulfillment status is required'],
    },
    reversalTransactionId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const consumptionSchema = new mongoose.Schema(
  {
    idempotencyKey: {
      type: String,
      required: [true, 'Idempotency key is required for consumption'],
      trim: true,
    },
    itemType: {
      type: String,
      enum: {
        values: ['UNDO', 'HINT', 'BOOSTER'],
        message: '{VALUE} is not a valid item type',
      },
      required: [true, 'Item type is required'],
    },
    sessionId: {
      type: String,
      default: null,
      trim: true,
    },
    remainingQuantity: {
      type: Number,
      required: [true, 'remainingQuantity snapshot is required'],
      min: [0, 'Remaining quantity cannot be negative'],
      validate: {
        validator: Number.isInteger,
        message: 'Remaining quantity must be an integer',
      },
    },
    totalConsumed: {
      type: Number,
      required: [true, 'totalConsumed snapshot is required'],
      min: [0, 'Total consumed cannot be negative'],
      validate: {
        validator: Number.isInteger,
        message: 'Total consumed must be an integer',
      },
    },
    consumedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const inventorySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User reference is required for inventory'],
      unique: true,
    },
    items: {
      UNDO: {
        type: itemStockSchema,
        default: () => ({ quantity: 0, totalPurchased: 0, totalConsumed: 0 }),
      },
      HINT: {
        type: itemStockSchema,
        default: () => ({ quantity: 0, totalPurchased: 0, totalConsumed: 0 }),
      },
      BOOSTER: {
        type: itemStockSchema,
        default: () => ({ quantity: 0, totalPurchased: 0, totalConsumed: 0 }),
      },
    },
    fulfillments: {
      type: [fulfillmentSchema],
      default: [],
    },
    consumptions: {
      type: [consumptionSchema],
      default: [],
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// High-performance compound indexes for fulfillment audits and consumption idempotency
inventorySchema.index({ 'fulfillments.purchaseId': 1 });
inventorySchema.index({ 'consumptions.idempotencyKey': 1 });

const Inventory =
  mongoose.models.Inventory || mongoose.model('Inventory', inventorySchema);

export default Inventory;