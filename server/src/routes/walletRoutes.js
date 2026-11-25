/**
 * server/src/routes/walletRoutes.js
 * Express router for VELoop Coin Wallet and transaction ledger endpoints.
 */

import express from 'express';
import {
  getWallet,
  getTransactions,
  purchaseItem,
} from '../controllers/walletController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Apply JWT Bearer authentication to all wallet endpoints
router.use(protect);

// GET /api/wallet - Retrieve authenticated user's wallet summary & balance
router.get('/', getWallet);

// GET /api/wallet/transactions - Retrieve authenticated user's paginated transaction history
router.get('/transactions', getTransactions);

// POST /api/wallet/purchase - Purchase gameplay items (UNDO, HINT, BOOSTER)
router.post('/purchase', purchaseItem);

export default router;