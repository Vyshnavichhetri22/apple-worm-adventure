/**
 * @file levelService.js
 * @description Frontend service interacting with backend Level and Game Session endpoints.
 * Fully compatible with the centralized fetch-based client (api.js).
 */

import api from './api.js';

export const levelService = {
  /**
   * Retrieves all active, published levels from GET /api/levels.
   * @returns {Promise<{ success: boolean, count: number, data: Array<Object> }>}
   */
  async getPublishedLevels() {
    return api.get('/levels');
  },

  /**
   * Retrieves a specific level by its number from GET /api/levels/:levelNumber.
   * @param {number} levelNumber
   * @returns {Promise<{ success: boolean, data: Object }>}
   */
  async getLevelByNumber(levelNumber) {
    return api.get(`/levels/${levelNumber}`);
  },

  /**
   * Retrieves the current authenticated player's authoritative progress from GET /api/games/progress.
   * @returns {Promise<{ success: boolean, data: Object }>}
   */
  async getPlayerProgress() {
    return api.get('/games/progress');
  },

  /**
   * Starts a new authoritative game session for an unlocked level via POST /api/games/start.
   * @param {number} levelNumber
   * @returns {Promise<{ success: boolean, message: string, data: Object }>}
   */
  async startLevelSession(levelNumber) {
    return api.post('/games/start', {
      levelNumber: Number(levelNumber)
    });
  }
};

export default levelService;