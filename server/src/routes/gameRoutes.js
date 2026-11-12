import express from 'express';
import {
  startGameSession,
  getGameSession,
  saveCheckpoint,
  completeGameSession,
  failGameSession,
  getPlayerHistory,
  getPlayerProgress,
} from '../controllers/gameSessionController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Apply JWT authentication protection to all game session endpoints
router.use(protect);

// Specific named endpoints (MUST precede /:sessionId to avoid route parameter collision)
router.post('/start', startGameSession);
router.get('/history', getPlayerHistory);
router.get('/progress', getPlayerProgress);

// Dynamic session ID endpoints
router.get('/:sessionId', getGameSession);
router.put('/:sessionId/checkpoint', saveCheckpoint);
router.post('/:sessionId/complete', completeGameSession);
router.post('/:sessionId/fail', failGameSession);

export default router;