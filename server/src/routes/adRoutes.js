import { Router } from 'express';
import rewardedAdController from '../controllers/rewardedAdController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = Router();

// 1. Authenticated Player Endpoints
router.post('/opportunity', protect, rewardedAdController.requestOpportunity);
router.post('/start', protect, rewardedAdController.startAd);
router.get('/status/:opportunityId', protect, rewardedAdController.getStatus);

// 2. Public Provider Webhooks
router.get('/callback/admob', rewardedAdController.handleAdMobCallback);
router.post('/callback/mock', rewardedAdController.handleMockCallback);

export default router;