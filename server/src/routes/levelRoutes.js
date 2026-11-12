/**
 * @file levelRoutes.js
 * @description Express router defining public and administrative endpoints for Level management.
 */

import express from 'express';
import {
  getPublishedLevels,
  getPublishedLevelByNumber,
  createLevelDraft,
  updateLevelDraft,
  publishLevel,
  unpublishLevel,
} from '../controllers/levelController.js';
import { protect } from '../middleware/authMiddleware.js';
import { requireAdmin } from '../middleware/adminMiddleware.js';

const router = express.Router();

// ---------------------------------------------------------------------------
// Public Routes (Accessible by all players, unauthenticated)
// ---------------------------------------------------------------------------
router.get('/', getPublishedLevels);
router.get('/:levelNumber', getPublishedLevelByNumber);

// ---------------------------------------------------------------------------
// Administrator Routes (Protected by protect and requireAdmin)
// ---------------------------------------------------------------------------
router.post('/', protect, requireAdmin, createLevelDraft);
router.put('/:levelNumber', protect, requireAdmin, updateLevelDraft);
router.post('/:levelNumber/publish', protect, requireAdmin, publishLevel);
router.post('/:levelNumber/unpublish', protect, requireAdmin, unpublishLevel);

export default router;