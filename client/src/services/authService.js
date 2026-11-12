/**
 * @file authService.js
 * @description API service handling user registration, authentication,
 * and current session profile verification against backend routes.
 */

import api from './api.js';

export const authService = {
  /**
   * Registers a new player account.
   * @param {Object} credentials - { username, email, password }
   * @returns {Promise<{ success: boolean, message: string, token: string, user: Object }>}
   */
  async register({ username, email, password }) {
    return api.post('/auth/register', { username, email, password });
  },

  /**
   * Authenticates an existing player.
   * @param {Object} credentials - { email, password }
   * @returns {Promise<{ success: boolean, message: string, token: string, user: Object }>}
   */
  async login({ email, password }) {
    return api.post('/auth/login', { email, password });
  },

  /**
   * Retrieves the profile of the currently authenticated player.
   * @returns {Promise<{ success: boolean, user: Object }>}
   */
  async getMe() {
    return api.get('/auth/me');
  },

  /**
   * Retrieves authoritative player progress metrics.
   * @returns {Promise<{ success: boolean, data: Object }>}
   */
  async getPlayerProgress() {
    return api.get('/games/progress');
  }
};

export default authService;