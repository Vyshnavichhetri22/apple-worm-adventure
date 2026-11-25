import express from 'express';
import dailyChallengeController from '../controllers/dailyChallengeController.js';
import { protect, optionalProtect } from '../middleware/authMiddleware.js';

const router = express.Router();

// GET /api/daily-challenge/today - Today's challenge, preview, completion status & streak
router.get('/today', optionalProtect, dailyChallengeController.getTodayChallenge);

// POST /api/daily-challenge/start - Start game session for today's daily challenge
router.post('/start', protect, dailyChallengeController.startDailyChallenge);

// POST /api/daily-challenge/complete - Complete daily challenge & award streak / daily coins
router.post('/complete', protect, dailyChallengeController.completeDailyChallenge);

// POST /api/daily-challenge/claim-milestone/:days - Claim streak milestone reward
router.post('/claim-milestone/:days', protect, dailyChallengeController.claimMilestone);

export default router;
