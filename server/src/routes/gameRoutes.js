import express from 'express';
import {
  startGameSession,
  getGameSession,
  saveCheckpoint,
  completeGameSession,
  failGameSession,
  abandonGameSession,
  applyUndo,
  applyBooster,
  requestHint,
  getActiveSession,
  getPlayerHistory,
  getPlayerProgress,
} from '../controllers/gameSessionController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(protect);

router.post('/start', startGameSession);
router.post('/checkpoint', saveCheckpoint);
router.post('/undo', applyUndo);
router.post('/booster', applyBooster);
router.post('/hint', requestHint);
router.post('/complete', completeGameSession);
router.post('/fail', failGameSession);
router.post('/abandon', abandonGameSession);
router.get('/history', getPlayerHistory);
router.get('/progress', getPlayerProgress);
router.get('/active', getActiveSession);
router.get('/active/:levelNumber', getActiveSession);

router.get('/:sessionId', getGameSession);
router.put('/:sessionId/checkpoint', saveCheckpoint);
router.post('/:sessionId/checkpoint', saveCheckpoint);
router.post('/:sessionId/undo', applyUndo);
router.post('/:sessionId/booster', applyBooster);
router.post('/:sessionId/hint', requestHint);
router.post('/:sessionId/complete', completeGameSession);
router.post('/:sessionId/fail', failGameSession);
router.post('/:sessionId/abandon', abandonGameSession);

export default router;