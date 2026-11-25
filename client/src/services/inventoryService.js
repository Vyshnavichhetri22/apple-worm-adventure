/**
 * @file inventoryService.js
 * @description Frontend API service for Consumable Inventory stocks and atomic item consumption.
 * Connects to authoritative backend endpoints:
 *   - GET  /api/inventory (Authoritative inventory summary & quantities)
 *   - POST /api/inventory/consume (Atomic item consumption with client idempotency)
 *
 * All operations use the centralized, fetch-based api client (client/src/services/api.js)
 * which automatically attaches JWT Bearer tokens and handles error parsing.
 */

import api from './api.js';

export const VALID_ITEM_TYPES = ['UNDO', 'HINT', 'BOOSTER'];

export const inventoryService = {
  /**
   * Fetches the authenticated player's authoritative inventory records and item stocks.
   * Endpoint: GET /api/inventory
   *
   * @returns {Promise<{ success: boolean, data: { userId: string, items: Object, fulfillments: Array, consumptions: Array } }>}
   */
  async getInventory() {
    const res = await api.get('/inventory');

    if (!res || !res.success || !res.data || typeof res.data.items !== 'object') {
      throw new Error(res?.message || 'Invalid or malformed inventory data received from server.');
    }

    return {
      success: true,
      data: res.data,
    };
  },

  /**
   * Atomically consumes one unit of a consumable item with idempotency.
   * Endpoint: POST /api/inventory/consume
   *
   * @param {Object} options
   * @param {'UNDO' | 'HINT' | 'BOOSTER'} options.itemType - The type of consumable item
   * @param {string} options.idempotencyKey - Unique client-generated transaction/action key
   * @param {string} [options.sessionId=null] - Optional gameplay session ID
   * @returns {Promise<{
   *   success: boolean,
   *   message: string,
   *   data: {
   *     itemType: string,
   *     remainingQuantity: number,
   *     totalConsumed: number,
   *     idempotencyKey: string,
   *     sessionId: string|null,
   *     consumedAt: string,
   *     isDuplicate: boolean
   *   }
   * }>}
   */
  async consumeItem({ itemType, idempotencyKey, sessionId = null }) {
    if (!itemType || typeof itemType !== 'string') {
      throw new Error('Item type is required and must be a valid string.');
    }

    const normalizedItemType = itemType.trim().toUpperCase();
    if (!VALID_ITEM_TYPES.includes(normalizedItemType)) {
      throw new Error(`Invalid item type "${itemType}". Allowed: ${VALID_ITEM_TYPES.join(', ')}`);
    }

    if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
      throw new Error('Idempotency key is required to safely consume inventory items.');
    }

    const trimmedKey = idempotencyKey.trim();
    if (trimmedKey.length > 255) {
      throw new Error('Idempotency key cannot exceed 255 characters.');
    }

    const payload = {
      itemType: normalizedItemType,
      idempotencyKey: trimmedKey,
      ...(sessionId ? { sessionId: String(sessionId).trim() } : {}),
    };

    const res = await api.post('/inventory/consume', payload);

    if (!res || !res.success || !res.data) {
      throw new Error(res?.message || 'Invalid or malformed response during item consumption.');
    }

    return {
      success: true,
      message: res.message || `Successfully consumed 1 ${normalizedItemType}`,
      data: res.data,
    };
  },
};

export default inventoryService;