import express from 'express';
import leaderboardController from '../controllers/leaderboardController.js';
import { optionalProtect } from '../middleware/authMiddleware.js';

const router = express.Router();

// GET /api/leaderboard - Paginated rankings with optional authenticated player rank
router.get('/', optionalProtect, leaderboardController.getLeaderboard);

export default router;
