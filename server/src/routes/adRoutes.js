import { Router } from 'express';
import rewardedAdController from '../controllers/rewardedAdController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = Router();

// 1. Authenticated Player Endpoints
router.get('/config', rewardedAdController.getConfig);
router.get('/opportunities', protect, rewardedAdController.getOpportunities);
router.get('/history', protect, rewardedAdController.getHistory);
router.post('/opportunity', protect, rewardedAdController.requestOpportunity);
router.post('/start', protect, rewardedAdController.startAd);
router.post('/simulate-watch', protect, rewardedAdController.simulateWatch);
router.get('/status/:opportunityId', protect, rewardedAdController.getStatus);

// 2. Public Provider Webhooks
router.get('/callback/admob', rewardedAdController.handleAdMobCallback);
router.post('/callback/mock', rewardedAdController.handleMockCallback);

export default router;