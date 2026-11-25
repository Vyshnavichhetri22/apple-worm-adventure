/**
 * @file walletService.js
 * @description Frontend API service for VELoop Coin Wallet, transaction ledger, and item purchases.
 * Connects to authoritative backend endpoints:
 *   - GET  /api/wallet (Authoritative balance & summary)
 *   - GET  /api/wallet/transactions (Paginated append-only ledger)
 *   - POST /api/wallet/purchase (Authoritative item purchase with ledger debit and inventory grant)
 *
 * All operations use the centralized, fetch-based api client (client/src/services/api.js)
 * which automatically attaches the JWT Bearer token and returns parsed JSON.
 */

import api from './api.js';

export const VALID_PURCHASE_ITEM_TYPES = ['UNDO', 'HINT', 'BOOSTER'];

export const walletService = {
  /**
   * Fetches the authenticated player's authoritative wallet summary and balance.
   * Endpoint: GET /api/wallet
   *
   * @returns {Promise<{ success: boolean, data: Object }>} Authoritative wallet summary
   */
  async getWallet() {
    const res = await api.get('/wallet');

    if (!res || !res.success || !res.data || res.data.balance === undefined) {
      throw new Error(res?.message || 'Invalid or malformed wallet summary received from server.');
    }

    return {
      success: true,
      data: res.data,
    };
  },

  /**
   * Fetches the authenticated player's paginated transaction ledger.
   * Endpoint: GET /api/wallet/transactions
   *
   * @param {Object} [params={}] - Filter and pagination options
   * @returns {Promise<{ success: boolean, data: Array, pagination: Object }>} Paginated transactions
   */
  async getTransactions(params = {}) {
    const query = new URLSearchParams();

    if (params.page !== undefined && params.page !== null) {
      query.set('page', String(params.page));
    }
    if (params.limit !== undefined && params.limit !== null) {
      query.set('limit', String(params.limit));
    }
    if (params.direction && String(params.direction).trim() !== '' && String(params.direction).toUpperCase() !== 'ALL') {
      query.set('direction', String(params.direction).trim().toUpperCase());
    }
    if (params.type && String(params.type).trim() !== '' && String(params.type).toUpperCase() !== 'ALL') {
      query.set('type', String(params.type).trim().toUpperCase());
    }

    const queryString = query.toString();
    const endpoint = queryString ? `/wallet/transactions?${queryString}` : '/wallet/transactions';

    const res = await api.get(endpoint);

    if (!res || !res.success || !Array.isArray(res.data)) {
      throw new Error(res?.message || 'Invalid or malformed transaction history received from server.');
    }

    return {
      success: true,
      data: res.data,
      pagination: res.pagination || {
        page: Number(params.page) || 1,
        limit: Number(params.limit) || 10,
        total: res.data.length,
        totalPages: 1,
      },
    };
  },

  /**
   * Purchases a gameplay consumable item using wallet coins with authoritative debit and durable grant.
   * Endpoint: POST /api/wallet/purchase
   *
   * @param {'UNDO' | 'HINT' | 'BOOSTER'} itemType - Item to purchase
   * @param {string} idempotencyKey - Unique client-generated transaction key
   * @returns {Promise<{
   *   success: boolean,
   *   message: string,
   *   data: {
   *     itemType: string,
   *     amount: number,
   *     balance: number,
   *     balanceBefore: number,
   *     balanceAfter: number,
   *     isDuplicate: boolean,
   *     transaction: Object,
   *     inventory: { itemType: string, quantity: number, totalPurchased: number, totalConsumed: number }
   *   }
   * }>}
   */
  async purchaseItem(itemType, idempotencyKey) {
    if (!itemType || typeof itemType !== 'string') {
      throw new Error('Item type is required and must be a valid string.');
    }

    const normalizedItemType = itemType.trim().toUpperCase();
    if (!VALID_PURCHASE_ITEM_TYPES.includes(normalizedItemType)) {
      throw new Error(`Invalid item type "${itemType}". Allowed: ${VALID_PURCHASE_ITEM_TYPES.join(', ')}`);
    }

    if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
      throw new Error('Idempotency key is required to purchase items.');
    }

    const trimmedKey = idempotencyKey.trim();
    if (trimmedKey.length > 255) {
      throw new Error('Idempotency key cannot exceed 255 characters.');
    }

    const res = await api.post('/wallet/purchase', {
      itemType: normalizedItemType,
      idempotencyKey: trimmedKey,
    });

    if (!res || !res.success || !res.data) {
      throw new Error(res?.message || 'Invalid or malformed response during item purchase.');
    }

    return {
      success: true,
      message: res.message || `Successfully purchased ${normalizedItemType}`,
      data: res.data,
    };
  },
};

export default walletService;