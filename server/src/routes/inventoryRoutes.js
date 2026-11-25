/**
 * server/src/routes/inventoryRoutes.js
 * Express router for Player Consumable Inventory endpoints.
 */

import express from 'express';
import { getInventory, consumeItem } from '../controllers/inventoryController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Apply JWT Bearer authentication to all inventory endpoints
router.use(protect);

// GET /api/inventory - Retrieve authenticated player's inventory stocks
router.get('/', getInventory);

// POST /api/inventory/consume - Consume 1 item with client idempotency
router.post('/consume', consumeItem);

export default router;