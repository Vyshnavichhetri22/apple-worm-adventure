/**
 * server/src/controllers/walletController.js
 * Authoritative controller for VELoop Coin Wallet inquiries, transaction history,
 * and server-authoritative item purchases with durable inventory fulfillment.
 * 
 * - GET /api/wallet: Authoritative balance and wallet status.
 * - GET /api/wallet/transactions: Paginated, filterable transaction ledger.
 * - POST /api/wallet/purchase: Server-priced item purchase with durable fulfillment and automatic refund compensation.
 */

import walletService from '../services/walletService.js';
import inventoryService from '../services/inventoryService.js';
import EconomyConfig from '../models/EconomyConfig.js';

/**
 * Item configuration mapping.
 * Strictly resolves to EconomyConfig rules and WalletTransaction enums.
 * NO hard-coded fallback prices: prices MUST be authoritatively resolved
 * from active EconomyConfig.
 */
const PURCHASE_ITEM_CONFIG = Object.freeze({
  UNDO: {
    transactionType: 'UNDO_PURCHASE',
    configKey: 'undoPurchaseCost',
    description: 'Purchased gameplay undo',
  },
  HINT: {
    transactionType: 'HINT_PURCHASE',
    configKey: 'hintPurchaseCost',
    description: 'Purchased gameplay hint',
  },
  BOOSTER: {
    transactionType: 'BOOSTER_PURCHASE',
    configKey: 'boosterPurchaseCost',
    description: 'Purchased gameplay booster',
  },
});

/**
 * @desc    Get current user's authoritative wallet balance and details
 * @route   GET /api/wallet
 * @access  Private (Authenticated User)
 */
export const getWallet = async (req, res) => {
  try {
    const userId = req.user.userId;
    const summary = await walletService.getWalletSummary(userId);

    return res.status(200).json({
      success: true,
      data: summary,
    });
  } catch (err) {
    const statusCode = err.statusCode || 500;
    const message = statusCode === 500
      ? 'An unexpected error occurred while retrieving wallet summary'
      : err.message || 'Error retrieving wallet summary';

    return res.status(statusCode).json({
      success: false,
      message,
    });
  }
};

/**
 * @desc    Get current user's paginated wallet transaction history
 * @route   GET /api/wallet/transactions
 * @access  Private (Authenticated User)
 */
export const getTransactions = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { page, limit, type, direction } = req.query;

    const rawType = typeof type === 'string' ? type.trim().toUpperCase() : undefined;
    const rawDirection = typeof direction === 'string' ? direction.trim().toUpperCase() : undefined;
    const sanitizedType = rawType && rawType !== 'ALL' ? rawType : undefined;
    const sanitizedDirection = rawDirection && rawDirection !== 'ALL' ? rawDirection : undefined;

    const result = await walletService.getTransactionHistory(userId, {
      page,
      limit,
      type: sanitizedType,
      direction: sanitizedDirection,
    });

    return res.status(200).json({
      success: true,
      data: result.transactions,
      pagination: result.pagination,
    });
  } catch (err) {
    const statusCode = err.statusCode || 500;
    const message = statusCode === 500
      ? 'An unexpected error occurred while retrieving transaction history'
      : err.message || 'Error retrieving transaction history';

    return res.status(statusCode).json({
      success: false,
      message,
    });
  }
};

/**
 * @desc    Purchase gameplay items with VELoop Coins (UNDO, HINT, BOOSTER)
 * @route   POST /api/wallet/purchase
 * @access  Private (Authenticated User)
 * 
 * Safety & Recovery Workflow:
 *   1. Resolve price server-side strictly from active EconomyConfig.
 *   2. Deduct coins via idempotent walletService.debit().
 *   3. Grant item via inventoryService.grantPurchasedItem().
 *   4. If grant fails, execute verified 3-state refund via inventoryService.refundFailedPurchase().
 */
export const purchaseItem = async (req, res) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required to process wallet purchase',
      });
    }

    const { itemType, idempotencyKey } = req.body || {};

    // 1. Validate itemType
    if (!itemType || typeof itemType !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Field "itemType" is required and must be a string (UNDO, HINT, BOOSTER)',
      });
    }

    const normalizedItemType = itemType.trim().toUpperCase();
    const itemConfig = PURCHASE_ITEM_CONFIG[normalizedItemType];

    if (!itemConfig) {
      return res.status(400).json({
        success: false,
        message: `Invalid itemType "${itemType}". Allowed values are: UNDO, HINT, BOOSTER`,
      });
    }

    // 2. Validate idempotencyKey (string between 1 and 255 characters)
    if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Field "idempotencyKey" is required and must be a non-empty string',
      });
    }

    const trimmedKey = idempotencyKey.trim();

    if (trimmedKey.length > 255) {
      return res.status(400).json({
        success: false,
        message: 'Field "idempotencyKey" cannot exceed 255 characters',
      });
    }

    // 3. Resolve price server-side strictly from active EconomyConfig (NO fallback pricing)
    const economy = await EconomyConfig.getActiveConfig();

    if (!economy || !economy.rules) {
      return res.status(500).json({
        success: false,
        message: 'Active economy configuration is unavailable. Purchase aborted without charge.',
      });
    }

    const configuredCost = economy.rules[itemConfig.configKey];

    if (
      typeof configuredCost !== 'number' ||
      !Number.isInteger(configuredCost) ||
      configuredCost <= 0
    ) {
      return res.status(500).json({
        success: false,
        message: `Economy rule "${itemConfig.configKey}" for "${normalizedItemType}" is invalid or non-positive. Purchase aborted without charge.`,
      });
    }

    const amount = configuredCost;

    // 4. Delegate to authoritative walletService.debit
    const debitResult = await walletService.debit(userId, amount, {
      type: itemConfig.transactionType,
      idempotencyKey: trimmedKey,
      description: itemConfig.description,
      metadata: {
        itemType: normalizedItemType,
        costConfigured: amount,
        source: 'GAMEPLAY_PURCHASE',
        purchasedAt: new Date().toISOString(),
      },
    });

    const purchaseId = debitResult.transaction._id;

    // 5. Grant purchased item into durable inventory
    let grantResult;
    try {
      grantResult = await inventoryService.grantPurchasedItem({
        userId,
        purchaseId,
        itemType: normalizedItemType,
      });
    } catch (fulfillmentErr) {
      // FULFILLMENT FAILED: Execute compensating refund workflow
      console.error(`Fulfillment error for purchase ${purchaseId}:`, fulfillmentErr.message);

      const refundResult = await inventoryService.refundFailedPurchase({
        userId,
        purchaseId,
        amount,
        itemType: normalizedItemType,
      });

      if (refundResult.refunded) {
        return res.status(500).json({
          success: false,
          message: 'Purchase fulfillment failed. Your coins have been refunded.',
          data: {
            refunded: true,
            status: 'REFUNDED',
            debitTransactionId: purchaseId.toString(),
            reversalTransactionId: refundResult.reversalTransactionId?.toString() || null,
            itemType: normalizedItemType,
          },
        });
      }

      return res.status(500).json({
        success: false,
        message: `Purchase fulfillment failed and automated refund is ${refundResult.status || 'UNRESOLVED'}. Please contact support.`,
        data: {
          refunded: false,
          status: refundResult.status || 'UNRESOLVED',
          debitTransactionId: purchaseId.toString(),
          reversalTransactionId: refundResult.reversalTransactionId?.toString() || null,
          error: refundResult.error,
          itemType: normalizedItemType,
        },
      });
    }

    const updatedInventory = grantResult.inventory;
    const itemStock = updatedInventory?.items?.[normalizedItemType];

    // 6. Return updated balance, item details, inventory stock, and transaction record
    return res.status(200).json({
      success: true,
      message: debitResult.isDuplicate
        ? `Duplicate request: ${normalizedItemType} purchase was already completed`
        : `Successfully purchased ${normalizedItemType}`,
      data: {
        itemType: normalizedItemType,
        amount,
        balance: debitResult.balanceAfter,
        balanceBefore: debitResult.balanceBefore,
        balanceAfter: debitResult.balanceAfter,
        isDuplicate: Boolean(debitResult.isDuplicate),
        transaction: {
          id: debitResult.transaction._id,
          type: debitResult.transaction.type,
          direction: debitResult.transaction.direction,
          amount: debitResult.transaction.amount,
          balanceBefore: debitResult.transaction.balanceBefore,
          balanceAfter: debitResult.transaction.balanceAfter,
          idempotencyKey: debitResult.transaction.idempotencyKey,
          description: debitResult.transaction.description,
          metadata: debitResult.transaction.metadata,
          createdAt: debitResult.transaction.createdAt,
        },
        inventory: {
          itemType: normalizedItemType,
          quantity: itemStock?.quantity || 0,
          totalPurchased: itemStock?.totalPurchased || 0,
          totalConsumed: itemStock?.totalConsumed || 0,
        },
      },
    });
  } catch (err) {
    const statusCode = err.statusCode || 500;

    const message =
      statusCode === 500
        ? 'An unexpected error occurred while processing the purchase'
        : err.message || 'Error processing purchase';

    return res.status(statusCode).json({
      success: false,
      message,
    });
  }
};