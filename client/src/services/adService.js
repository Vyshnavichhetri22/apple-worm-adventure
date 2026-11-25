/**
 * @file adService.js
 * @description Centralized Rewarded Ad client service for Apple Worm Adventure.
 * Communicates with /api/ads to request opportunities, monitor status,
 * simulate verified completions, and retrieve reward transaction history.
 */

import api from './api.js';

export const adService = {
  /**
   * Fetch current active economy configuration and ad limits.
   */
  async getEconomyConfig() {
    const res = await api.get('/ads/config');
    return res?.data || res;
  },

  /**
   * Fetch player's current ad opportunities, quota usage, and cooldown status.
   * @param {string} [sessionId] - Optional active game session ID to evaluate session limits.
   */
  async getOpportunitySummary(sessionId = null) {
    const query = sessionId ? `?sessionId=${sessionId}` : '';
    const res = await api.get(`/ads/opportunities${query}`);
    return res?.data || res;
  },

  /**
   * Fetch player's reward history ledger.
   * @param {Object} [options]
   * @param {number} [options.limit=20]
   * @param {string} [options.status='GRANTED']
   */
  async getRewardHistory(options = {}) {
    const params = new URLSearchParams();
    if (options.limit) params.append('limit', options.limit);
    if (options.status) params.append('status', options.status);
    const query = params.toString() ? `?${params.toString()}` : '';
    const res = await api.get(`/ads/history${query}`);
    return res?.data || res;
  },

  /**
   * Request a new ad opportunity and reserve quota atomically on server.
   * @param {Object} params
   * @param {string} params.placement - e.g. 'GAME_OVER_REVIVE', 'POST_WIN_DOUBLE_COIN', 'STORE_FREE_COINS'
   * @param {string} [params.sessionId] - Active game session ID if applicable
   * @param {string} [params.boosterType] - Optional booster identifier
   */
  async requestOpportunity({ placement, sessionId = null, boosterType = 'APPLE_MAGNET' }) {
    const res = await api.post('/ads/opportunity', {
      placement,
      sessionId,
      boosterType,
    });
    return res?.data || res;
  },

  /**
   * Signal to server that the ad player has started.
   * @param {string} opportunityId
   */
  async startAd(opportunityId) {
    const res = await api.post('/ads/start', { opportunityId });
    return res?.data || res;
  },

  /**
   * Poll status of an ad opportunity.
   * @param {string} opportunityId
   */
  async getStatus(opportunityId) {
    const res = await api.get(`/ads/status/${opportunityId}`);
    return res?.data || res;
  },

  /**
   * Complete ad playback and trigger server-side SSV callback verification.
   * Grants reward and updates game session / wallet atomically on server.
   * @param {string} opportunityId
   */
  async simulateWatch(opportunityId) {
    const res = await api.post('/ads/simulate-watch', { opportunityId });
    return res?.data || res;
  },
};

export default adService;
