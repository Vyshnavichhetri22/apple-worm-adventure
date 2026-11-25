import api from './api.js';

export const levelService = {
  async getPublishedLevels() {
    return api.get('/levels');
  },

  async getLevels() {
    return api.get('/levels');
  },

  async getLevelByNumber(levelNumber) {
    return api.get(`/levels/${levelNumber}`);
  },

  async getLevel(levelNumber) {
    return api.get(`/levels/${levelNumber}`);
  },

  async getPlayerProgress() {
    return api.get('/games/progress');
  },

  async startLevelSession(levelNumber) {
    return api.post('/games/start', {
      levelNumber: Number(levelNumber),
    });
  },

  async startSession(levelNumber, clientTelemetry = null) {
    return api.post('/games/start', {
      levelNumber: Number(levelNumber),
      clientTelemetry,
    });
  },

  async getGameSession(sessionId) {
    return api.get(`/games/${sessionId}`);
  },

  async saveCheckpoint(sessionId, checkpointData) {
    return api.put(`/games/${sessionId}/checkpoint`, checkpointData);
  },

  async applyUndo(sessionId, idempotencyKey) {
    return api.post(`/games/${sessionId}/undo`, { idempotencyKey });
  },

  async applyBooster(sessionId, boosterType, idempotencyKey) {
    return api.post(`/games/${sessionId}/booster`, { boosterType, idempotencyKey });
  },

  async requestHint(sessionId, idempotencyKey) {
    return api.post(`/games/${sessionId}/hint`, { idempotencyKey });
  },

  async completeSession(sessionId, completionData) {
    return api.post(`/games/${sessionId}/complete`, completionData);
  },

  async failSession(sessionId, failureData) {
    return api.post(`/games/${sessionId}/fail`, failureData);
  },

  async abandonSession(sessionId) {
    return api.post(`/games/${sessionId}/abandon`);
  },

  async getActiveSession(levelNumber) {
    const url = levelNumber ? `/games/active/${levelNumber}` : '/games/active';
    return api.get(url);
  },
};

export default levelService;