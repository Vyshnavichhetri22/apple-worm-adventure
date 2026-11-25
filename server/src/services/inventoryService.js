import mongoose from 'mongoose';
import Inventory from '../models/Inventory.js';
import WalletTransaction from '../models/WalletTransaction.js';
import walletService from './walletService.js';

const VALID_ITEM_TYPES = ['UNDO', 'HINT', 'BOOSTER'];

class InventoryService {
  /**
   * Ensures an inventory document exists for the user and returns it.
   */
  async getOrCreateInventory(userId) {
    if (!userId) {
      throw new Error('User ID is required to get or create inventory.');
    }

    const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;

    const inventory = await Inventory.findOneAndUpdate(
      { userId: userObjectId },
      {
        $setOnInsert: {
          userId: userObjectId,
          items: {
            UNDO: { quantity: 0, totalPurchased: 0, totalConsumed: 0 },
            HINT: { quantity: 0, totalPurchased: 0, totalConsumed: 0 },
            BOOSTER: { quantity: 0, totalPurchased: 0, totalConsumed: 0 },
          },
          fulfillments: [],
          consumptions: [],
        },
      },
      {
        returnDocument: 'after',
        upsert: true,
        setDefaultsOnInsert: true,
      }
    );

    return inventory;
  }

  /**
   * Retrieves user inventory stocks.
   */
  async getInventory(userId) {
    return this.getOrCreateInventory(userId);
  }

  /**
   * Atomically grants a purchased item to the user's inventory.
   * Guarantees mutual exclusion against refunds and prevents duplicate grants.
   */
  async grantPurchasedItem({ userId, purchaseId, itemType }) {
    if (!userId || !purchaseId || !itemType) {
      const err = new Error('userId, purchaseId, and itemType are required to grant an item.');
      err.statusCode = 400;
      throw err;
    }

    if (typeof itemType !== 'string' || itemType.trim() === '') {
      const err = new Error('itemType must be a non-empty string.');
      err.statusCode = 400;
      throw err;
    }

    const normalizedItemType = itemType.toUpperCase().trim();
    if (!VALID_ITEM_TYPES.includes(normalizedItemType)) {
      const err = new Error(`Invalid itemType: ${itemType}. Must be one of: ${VALID_ITEM_TYPES.join(', ')}`);
      err.statusCode = 400;
      throw err;
    }

    const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
    const purchaseObjectId = typeof purchaseId === 'string' ? new mongoose.Types.ObjectId(purchaseId) : purchaseId;

    await this.getOrCreateInventory(userObjectId);

    // Atomic update: succeeds ONLY if this purchaseId is NOT already recorded in fulfillments
    const updatedInventory = await Inventory.findOneAndUpdate(
      {
        userId: userObjectId,
        'fulfillments.purchaseId': { $ne: purchaseObjectId },
      },
      {
        $inc: {
          [`items.${normalizedItemType}.quantity`]: 1,
          [`items.${normalizedItemType}.totalPurchased`]: 1,
        },
        $push: {
          fulfillments: {
            purchaseId: purchaseObjectId,
            itemType: normalizedItemType,
            status: 'FULFILLED',
            reversalTransactionId: null,
            updatedAt: new Date(),
          },
        },
      },
      { returnDocument: 'after' }
    );

    if (updatedInventory) {
      return {
        success: true,
        granted: true,
        alreadyFulfilled: false,
        inventory: updatedInventory,
      };
    }

    // Purchase was already recorded in fulfillments; check current status
    const currentInventory = await Inventory.findOne({ userId: userObjectId });
    const existing = currentInventory?.fulfillments?.find(
      (f) => f.purchaseId.toString() === purchaseObjectId.toString()
    );

    if (existing) {
      // Item type consistency check before processing existing status
      if (existing.itemType !== normalizedItemType) {
        const err = new Error(
          `Purchase ${purchaseObjectId} was originally associated with itemType "${existing.itemType}", conflicting with requested itemType "${normalizedItemType}".`
        );
        err.statusCode = 409;
        throw err;
      }

      if (existing.status === 'FULFILLED') {
        return {
          success: true,
          granted: false,
          alreadyFulfilled: true,
          inventory: currentInventory,
        };
      }

      if (existing.status === 'REFUND_PENDING') {
        const err = new Error(`Purchase ${purchaseObjectId} is pending refund and cannot be fulfilled.`);
        err.statusCode = 409;
        throw err;
      }

      if (existing.status === 'REFUNDED') {
        const err = new Error(`Purchase ${purchaseObjectId} has already been refunded and cannot be fulfilled.`);
        err.statusCode = 409;
        throw err;
      }
    }

    throw new Error(`Failed to grant purchase ${purchaseObjectId} due to state conflict.`);
  }

  /**
   * Atomically reserves a purchase for refund, transitioning it to REFUND_PENDING.
   * Validates itemType before creating or modifying any fulfillment record.
   */
  async reservePurchaseRefund({ userId, purchaseId, itemType }) {
    if (!userId || !purchaseId || !itemType) {
      const err = new Error('userId, purchaseId, and itemType are required to reserve refund.');
      err.statusCode = 400;
      throw err;
    }

    if (typeof itemType !== 'string' || itemType.trim() === '') {
      const err = new Error('itemType must be a non-empty string.');
      err.statusCode = 400;
      throw err;
    }

    const normalizedItemType = itemType.toUpperCase().trim();
    if (!VALID_ITEM_TYPES.includes(normalizedItemType)) {
      const err = new Error(`Invalid itemType: ${itemType}. Must be one of: ${VALID_ITEM_TYPES.join(', ')}`);
      err.statusCode = 400;
      throw err;
    }

    const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
    const purchaseObjectId = typeof purchaseId === 'string' ? new mongoose.Types.ObjectId(purchaseId) : purchaseId;

    await this.getOrCreateInventory(userObjectId);

    // Atomic update: claim purchaseId as REFUND_PENDING if not present
    const updatedInventory = await Inventory.findOneAndUpdate(
      {
        userId: userObjectId,
        'fulfillments.purchaseId': { $ne: purchaseObjectId },
      },
      {
        $push: {
          fulfillments: {
            purchaseId: purchaseObjectId,
            itemType: normalizedItemType,
            status: 'REFUND_PENDING',
            reversalTransactionId: null,
            updatedAt: new Date(),
          },
        },
      },
      { returnDocument: 'after' }
    );

    if (updatedInventory) {
      return {
        reserved: true,
        alreadyReserved: false,
        alreadyRefunded: false,
        inventory: updatedInventory,
      };
    }

    // Purchase was already in fulfillments; check status
    const currentInventory = await Inventory.findOne({ userId: userObjectId });
    const existing = currentInventory?.fulfillments?.find(
      (f) => f.purchaseId.toString() === purchaseObjectId.toString()
    );

    if (existing) {
      // Item type consistency check before processing existing status
      if (existing.itemType !== normalizedItemType) {
        const err = new Error(
          `Purchase ${purchaseObjectId} was originally associated with itemType "${existing.itemType}", conflicting with refund itemType "${normalizedItemType}".`
        );
        err.statusCode = 409;
        throw err;
      }

      if (existing.status === 'REFUND_PENDING') {
        return {
          reserved: true,
          alreadyReserved: true,
          alreadyRefunded: false,
          reversalTransactionId: existing.reversalTransactionId,
          inventory: currentInventory,
        };
      }

      if (existing.status === 'REFUNDED') {
        return {
          reserved: false,
          alreadyReserved: false,
          alreadyRefunded: true,
          reversalTransactionId: existing.reversalTransactionId,
          inventory: currentInventory,
        };
      }

      if (existing.status === 'FULFILLED') {
        const err = new Error(`Cannot refund purchase ${purchaseObjectId}: item has already been fulfilled.`);
        err.statusCode = 409;
        throw err;
      }
    }

    throw new Error(`Conflict reserving refund for purchase ${purchaseObjectId}.`);
  }

  /**
   * Marks a pending refund as completed (REFUNDED) after credit is confirmed.
   * Atomically transitions only REFUND_PENDING records and prevents overwriting
   * an existing reversalTransactionId.
   */
  async completePurchaseRefund({ userId, purchaseId, reversalTransactionId }) {
    if (!userId || !purchaseId || !reversalTransactionId) {
      throw new Error('userId, purchaseId, and reversalTransactionId are required to complete refund.');
    }

    const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
    const purchaseObjectId = typeof purchaseId === 'string' ? new mongoose.Types.ObjectId(purchaseId) : purchaseId;
    const reversalObjectId = typeof reversalTransactionId === 'string'
      ? new mongoose.Types.ObjectId(reversalTransactionId)
      : reversalTransactionId;

    // Step 1: Atomic update targeting STRICTLY a matching REFUND_PENDING fulfillment
    const updatedInventory = await Inventory.findOneAndUpdate(
      {
        userId: userObjectId,
        fulfillments: {
          $elemMatch: {
            purchaseId: purchaseObjectId,
            status: 'REFUND_PENDING',
          },
        },
      },
      {
        $set: {
          'fulfillments.$.status': 'REFUNDED',
          'fulfillments.$.reversalTransactionId': reversalObjectId,
          'fulfillments.$.updatedAt': new Date(),
        },
      },
      { returnDocument: 'after' }
    );

    if (updatedInventory) {
      return updatedInventory;
    }

    // Step 2: Differentiate idempotent retry, conflict, or non-existent record
    const currentInventory = await Inventory.findOne({ userId: userObjectId });
    const existing = currentInventory?.fulfillments?.find(
      (f) => f.purchaseId.toString() === purchaseObjectId.toString()
    );

    if (!existing) {
      const err = new Error(`Fulfillment record for purchase ${purchaseObjectId} does not exist.`);
      err.statusCode = 404;
      throw err;
    }

    if (existing.status === 'REFUNDED') {
      const existingRevId = existing.reversalTransactionId?.toString();
      const targetRevId = reversalObjectId.toString();

      if (existingRevId === targetRevId) {
        // Idempotent retry with identical reversal ID: success
        return currentInventory;
      } else {
        // Conflicting reversal ID attempt on an already refunded purchase
        const err = new Error(
          `Cannot overwrite existing reversal ID ${existingRevId} with different reversal ID ${targetRevId} for purchase ${purchaseObjectId}.`
        );
        err.statusCode = 409;
        throw err;
      }
    }

    if (existing.status === 'FULFILLED') {
      const err = new Error(`Cannot complete refund for purchase ${purchaseObjectId}: item has already been fulfilled.`);
      err.statusCode = 409;
      throw err;
    }

    const err = new Error(`Cannot complete refund for purchase ${purchaseObjectId}: invalid status "${existing.status}".`);
    err.statusCode = 409;
    throw err;
  }

  /**
   * Orchestrates the verified 3-state refund recovery workflow.
   * Requires matching referenceId and never claims refund succeeded unless state is fully verified.
   */
  async refundFailedPurchase({ userId, purchaseId, amount, itemType }) {
    const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
    const purchaseObjectId = typeof purchaseId === 'string' ? new mongoose.Types.ObjectId(purchaseId) : purchaseId;
    const normalizedItemType = itemType.toUpperCase().trim();

    // 1. Atomically reserve purchase for refund
    const reservation = await this.reservePurchaseRefund({
      userId: userObjectId,
      purchaseId: purchaseObjectId,
      itemType: normalizedItemType,
    });

    if (reservation.alreadyRefunded) {
      const storedReversalId = reservation.reversalTransactionId;

      if (!storedReversalId) {
        return {
          refunded: false,
          status: 'REFUND_VERIFICATION_FAILED',
          reversalTransactionId: null,
          error: `Purchase ${purchaseObjectId} marked REFUNDED but has missing reversalTransactionId`,
        };
      }

      // Verify the corresponding WalletTransaction exists and matches all ledger invariants
      const expectedRefundKey = `refund_${purchaseObjectId.toString()}`;
      const reversalTx = await WalletTransaction.findById(storedReversalId);

      if (!reversalTx) {
        return {
          refunded: false,
          status: 'REFUND_VERIFICATION_FAILED',
          reversalTransactionId: storedReversalId,
          error: `Reversal transaction ${storedReversalId} not found in ledger`,
        };
      }

      const isSameUser = reversalTx.userId.toString() === userObjectId.toString();
      const isReversalType = reversalTx.type === 'REVERSAL';
      const isCreditDirection = reversalTx.direction === 'CREDIT';
      const isSameAmount = reversalTx.amount === amount;
      const isExpectedKey = reversalTx.idempotencyKey === expectedRefundKey;
      const isMatchingReference = reversalTx.referenceId === purchaseObjectId.toString();

      if (!isSameUser || !isReversalType || !isCreditDirection || !isSameAmount || !isExpectedKey || !isMatchingReference) {
        return {
          refunded: false,
          status: 'REFUND_VERIFICATION_FAILED',
          reversalTransactionId: storedReversalId,
          error: `Reversal transaction ${storedReversalId} failed ledger reconciliation invariants`,
        };
      }

      return {
        refunded: true,
        status: 'REFUNDED',
        alreadyRefunded: true,
        reversalTransaction: reversalTx,
        reversalTransactionId: storedReversalId,
      };
    }

    // 2. Execute idempotent credit using WalletTransaction REVERSAL enum
    const refundKey = `refund_${purchaseObjectId.toString()}`;
    let creditResult;
    try {
      creditResult = await walletService.credit(userObjectId, amount, {
        type: 'REVERSAL',
        referenceId: purchaseObjectId.toString(),
        idempotencyKey: refundKey,
        description: `Refund for failed ${normalizedItemType} purchase`,
        metadata: {
          originalDebitId: purchaseObjectId.toString(),
          itemType: normalizedItemType,
          reason: 'PURCHASE_FULFILLMENT_FAILED',
        },
      });
    } catch (creditErr) {
      // Credit failed: purchase remains REFUND_PENDING for subsequent retry
      return {
        refunded: false,
        status: 'REFUND_PENDING',
        reversalTransactionId: null,
        error: creditErr.message || 'Credit operation failed',
      };
    }

    // Verify transaction reference from walletService.credit() return contract
    const reversalTxId = creditResult?.transaction?._id;
    if (!reversalTxId) {
      return {
        refunded: false,
        status: 'REFUND_PENDING',
        reversalTransactionId: null,
        error: 'Wallet credit succeeded but transaction reference was missing from response',
      };
    }

    // 3. Mark refund completed after credit confirmation
    let completedInventory;
    try {
      completedInventory = await this.completePurchaseRefund({
        userId: userObjectId,
        purchaseId: purchaseObjectId,
        reversalTransactionId: reversalTxId,
      });
    } catch (completeErr) {
      return {
        refunded: false,
        status: 'REFUND_PENDING',
        reversalTransactionId: reversalTxId,
        isDuplicate: Boolean(creditResult.isDuplicate),
        error: completeErr.message || 'Error updating inventory to REFUNDED state',
      };
    }

    // Explicit state verification:
    // Verify that the matching fulfillment record exists, has status === 'REFUNDED',
    // and reversalTransactionId matches the actual reversal transaction ID
    const matchingFulfillment = completedInventory?.fulfillments?.find(
      (f) => f.purchaseId.toString() === purchaseObjectId.toString()
    );

    const isVerifiedRefunded =
      matchingFulfillment &&
      matchingFulfillment.status === 'REFUNDED' &&
      matchingFulfillment.reversalTransactionId &&
      matchingFulfillment.reversalTransactionId.toString() === reversalTxId.toString();

    if (!isVerifiedRefunded) {
      return {
        refunded: false,
        status: 'REFUND_PENDING',
        reversalTransactionId: reversalTxId,
        isDuplicate: Boolean(creditResult.isDuplicate),
        error: 'Wallet was credited but inventory fulfillment completion could not be verified',
      };
    }

    return {
      refunded: true,
      status: 'REFUNDED',
      reversalTransaction: creditResult.transaction,
      reversalTransactionId: reversalTxId,
      isDuplicate: Boolean(creditResult.isDuplicate),
    };
  }

  /**
   * Atomically consumes one item from user inventory.
   * Decrements stock, increments totalConsumed, updates parent timestamp, and stores
   * consumption record with snapshot values in ONE atomic aggregation update pipeline.
   *
   * Bypasses Mongoose castUpdate via native driver collection to prevent schema CastError
   * while preserving single-document atomic mutual exclusion and snapshot replay.
   */
  async consumeItem({ userId, itemType, idempotencyKey, sessionId = null }) {
    if (!userId || !itemType || !idempotencyKey) {
      const err = new Error('userId, itemType, and idempotencyKey are required to consume an item.');
      err.statusCode = 400;
      throw err;
    }

    const trimmedKey = idempotencyKey.toString().trim();
    if (!trimmedKey) {
      const err = new Error('idempotencyKey cannot be empty.');
      err.statusCode = 400;
      throw err;
    }

    const normalizedItemType = itemType.toUpperCase().trim();
    if (!VALID_ITEM_TYPES.includes(normalizedItemType)) {
      const err = new Error(`Invalid itemType: ${itemType}. Must be one of: ${VALID_ITEM_TYPES.join(', ')}`);
      err.statusCode = 400;
      throw err;
    }

    const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
    const cleanSessionId = sessionId ? sessionId.toString().trim() : null;

    await this.getOrCreateInventory(userObjectId);

    // 1. Idempotency pre-check: inspect if this key was already consumed
    const currentInventory = await Inventory.findOne({ userId: userObjectId });
    const existingConsumption = currentInventory?.consumptions?.find(
      (c) => c.idempotencyKey === trimmedKey
    );

    if (existingConsumption) {
      const storedSession = existingConsumption.sessionId || null;
      const requestSession = cleanSessionId || null;

      if (
        existingConsumption.itemType !== normalizedItemType ||
        storedSession !== requestSession
      ) {
        const err = new Error(
          `Idempotency key "${trimmedKey}" was previously used with different parameters (itemType: ${existingConsumption.itemType}, sessionId: ${storedSession}).`
        );
        err.statusCode = 409;
        throw err;
      }

      // Replay original recorded snapshot outcome (NOT current stock values)
      return {
        success: true,
        isDuplicate: true,
        itemType: existingConsumption.itemType,
        remainingQuantity: existingConsumption.remainingQuantity,
        totalConsumed: existingConsumption.totalConsumed,
        idempotencyKey: existingConsumption.idempotencyKey,
        sessionId: existingConsumption.sessionId,
        consumedAt: existingConsumption.consumedAt,
      };
    }

    // 2. Pre-check available stock before running database update
    const currentStock = currentInventory?.items?.[normalizedItemType]?.quantity || 0;
    if (currentStock < 1) {
      const err = new Error(`Insufficient ${normalizedItemType} quantity. Current balance: ${currentStock}`);
      err.statusCode = 400;
      throw err;
    }

    // 3. Native MongoDB atomic aggregation update pipeline:
    // Uses Inventory.collection to bypass Mongoose's castUpdate on pipeline expressions,
    // guaranteeing single-document atomicity and concurrency mutual exclusion.
    const rawResult = await Inventory.collection.findOneAndUpdate(
      {
        userId: userObjectId,
        [`items.${normalizedItemType}.quantity`]: { $gte: 1 },
        'consumptions.idempotencyKey': { $ne: trimmedKey },
      },
      [
        {
          $set: {
            [`items.${normalizedItemType}.quantity`]: {
              $subtract: [`$items.${normalizedItemType}.quantity`, 1],
            },
            [`items.${normalizedItemType}.totalConsumed`]: {
              $add: [`$items.${normalizedItemType}.totalConsumed`, 1],
            },
            consumptions: {
              $concatArrays: [
                { $ifNull: ['$consumptions', []] },
                [
                  {
                    idempotencyKey: trimmedKey,
                    itemType: normalizedItemType,
                    sessionId: cleanSessionId,
                    remainingQuantity: {
                      $subtract: [`$items.${normalizedItemType}.quantity`, 1],
                    },
                    totalConsumed: {
                      $add: [`$items.${normalizedItemType}.totalConsumed`, 1],
                    },
                    consumedAt: '$$NOW',
                  },
                ],
              ],
            },
            updatedAt: '$$NOW',
          },
        },
      ],
      { returnDocument: 'after' }
    );

    // Support both Node MongoDB Driver v6 (returns doc directly) and v4/v5 (returns { value: doc })
    const updatedDoc = rawResult && rawResult.value !== undefined ? rawResult.value : rawResult;

    if (updatedDoc) {
      const record = updatedDoc.consumptions?.find((c) => c.idempotencyKey === trimmedKey);
      return {
        success: true,
        isDuplicate: false,
        itemType: normalizedItemType,
        remainingQuantity: record.remainingQuantity,
        totalConsumed: record.totalConsumed,
        idempotencyKey: trimmedKey,
        sessionId: cleanSessionId,
        consumedAt: record.consumedAt,
      };
    }

    // 4. Atomic update did not match: Re-check to distinguish concurrent duplicate from race depletion
    const freshInventory = await Inventory.findOne({ userId: userObjectId });
    const raceConsumption = freshInventory?.consumptions?.find(
      (c) => c.idempotencyKey === trimmedKey
    );

    if (raceConsumption) {
      const storedSession = raceConsumption.sessionId || null;
      const requestSession = cleanSessionId || null;

      if (
        raceConsumption.itemType !== normalizedItemType ||
        storedSession !== requestSession
      ) {
        const err = new Error(
          `Idempotency key "${trimmedKey}" was previously used with different parameters (itemType: ${raceConsumption.itemType}, sessionId: ${storedSession}).`
        );
        err.statusCode = 409;
        throw err;
      }

      return {
        success: true,
        isDuplicate: true,
        itemType: raceConsumption.itemType,
        remainingQuantity: raceConsumption.remainingQuantity,
        totalConsumed: raceConsumption.totalConsumed,
        idempotencyKey: raceConsumption.idempotencyKey,
        sessionId: raceConsumption.sessionId,
        consumedAt: raceConsumption.consumedAt,
      };
    }

    // Stock was depleted during concurrent race
    const finalStock = freshInventory?.items?.[normalizedItemType]?.quantity || 0;
    const err = new Error(`Insufficient ${normalizedItemType} quantity. Current balance: ${finalStock}`);
    err.statusCode = 400;
    throw err;
  }
}

export default new InventoryService();