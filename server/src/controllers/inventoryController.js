/**
 * server/src/controllers/inventoryController.js
 * Authoritative controller for Consumable Inventory queries and item consumption.
 *
 * - GET /api/inventory: Retrieves authenticated user's current inventory stocks.
 * - POST /api/inventory/consume: Atomically consumes 1 item with client idempotency.
 */

import inventoryService from '../services/inventoryService.js';

const VALID_ITEM_TYPES = ['UNDO', 'HINT', 'BOOSTER'];

/**
 * @desc    Get authenticated player's inventory stocks
 * @route   GET /api/inventory
 * @access  Private (Authenticated User)
 */
export const getInventory = async (req, res) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required to retrieve inventory',
      });
    }

    const inventory = await inventoryService.getInventory(userId);

    return res.status(200).json({
      success: true,
      data: inventory,
    });
  } catch (err) {
    const statusCode = err.statusCode || err.status || 500;
    const message =
      statusCode === 500
        ? 'An unexpected error occurred while retrieving inventory'
        : err.message || 'Error retrieving inventory';

    return res.status(statusCode).json({
      success: false,
      message,
    });
  }
};

/**
 * @desc    Atomically consume one consumable item with idempotency
 * @route   POST /api/inventory/consume
 * @access  Private (Authenticated User)
 *
 * Request Body:
 *   - itemType: 'UNDO' | 'HINT' | 'BOOSTER' (required)
 *   - idempotencyKey: string (required, 1-255 characters)
 *   - sessionId: string (optional)
 */
export const consumeItem = async (req, res) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required to consume inventory items',
      });
    }

    const { itemType, idempotencyKey, sessionId } = req.body || {};

    // 1. Validate itemType
    if (!itemType || typeof itemType !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Field "itemType" is required and must be a string (UNDO, HINT, BOOSTER)',
      });
    }

    const normalizedItemType = itemType.trim().toUpperCase();
    if (!VALID_ITEM_TYPES.includes(normalizedItemType)) {
      return res.status(400).json({
        success: false,
        message: `Invalid itemType "${itemType}". Allowed values are: ${VALID_ITEM_TYPES.join(', ')}`,
      });
    }

    // 2. Validate idempotencyKey
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

    // 3. Delegate to atomic inventory consumption service
    const result = await inventoryService.consumeItem({
      userId,
      itemType: normalizedItemType,
      idempotencyKey: trimmedKey,
      sessionId: sessionId || null,
    });

    return res.status(200).json({
      success: true,
      message: result.isDuplicate
        ? `Duplicate request: ${result.itemType} was already consumed`
        : `Successfully consumed 1 ${result.itemType}`,
      data: {
        itemType: result.itemType,
        remainingQuantity: result.remainingQuantity,
        totalConsumed: result.totalConsumed,
        idempotencyKey: result.idempotencyKey,
        sessionId: result.sessionId,
        consumedAt: result.consumedAt,
        isDuplicate: Boolean(result.isDuplicate),
      },
    });
  } catch (err) {
    const statusCode = err.statusCode || err.status || 500;
    const message =
      statusCode === 500
        ? 'An unexpected error occurred while consuming the item'
        : err.message || 'Error consuming item';

    return res.status(statusCode).json({
      success: false,
      message,
    });
  }
};