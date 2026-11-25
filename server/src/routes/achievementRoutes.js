import express from 'express';
import achievementController from '../controllers/achievementController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// GET /api/achievements - Retrieve player's 10 achievements and current progress
router.get('/', protect, achievementController.getAchievements);

// POST /api/achievements/:id/claim - Claim reward for an unlocked achievement
router.post('/:id/claim', protect, achievementController.claimAchievement);

export default router;
