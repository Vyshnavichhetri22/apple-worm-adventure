import express from 'express';
import { getWallet, getTransactions } from '../controllers/walletController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Apply JWT Bearer authentication to all wallet endpoints
router.use(protect);

// GET /api/wallet - Retrieve authenticated user's wallet summary & balance
router.get('/', getWallet);

// GET /api/wallet/transactions - Retrieve authenticated user's paginated transaction history
router.get('/transactions', getTransactions);

export default router;