import express from 'express';
import {
  registerUser,
  loginUser,
  getMe,
} from '../controllers/authController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Public routes (no authentication required)
router.post('/register', registerUser);
router.post('/login', loginUser);

// Protected routes (requires valid JWT Bearer token)
router.get('/me', protect, getMe);

export default router;