import api from './api.js';

export const leaderboardService = {
  /**
   * Fetches the global leaderboard with pagination and sorting metric.
   * @param {Object} params - { page: 1, limit: 20, metric: 'totalScore' | 'totalStars' }
   * @returns {Promise<any>}
   */
  async getLeaderboard(params = {}) {
    const query = new URLSearchParams();
    if (params.page) query.set('page', params.page);
    if (params.limit) query.set('limit', params.limit);
    if (params.metric) query.set('metric', params.metric);

    const queryString = query.toString() ? `?${query.toString()}` : '';
    return api.get(`/leaderboard${queryString}`);
  },
};

export default leaderboardService;
