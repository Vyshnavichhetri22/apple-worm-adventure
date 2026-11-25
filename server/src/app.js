import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import authRoutes from './routes/authRoutes.js';
import levelRoutes from './routes/levelRoutes.js';
import gameRoutes from './routes/gameRoutes.js';
import walletRoutes from './routes/walletRoutes.js';
import inventoryRoutes from './routes/inventoryRoutes.js';
import adRoutes from './routes/adRoutes.js';
import leaderboardRoutes from './routes/leaderboardRoutes.js';
import achievementRoutes from './routes/achievementRoutes.js';
import dailyChallengeRoutes from './routes/dailyChallengeRoutes.js';
import rewardedAdController from './controllers/rewardedAdController.js';

const app = express();
const GAME_NAME = process.env.GAME_NAME || 'APPLE WORM ADVENTURE';

// 1. Security & request processing middleware
app.use(helmet());
app.use(
  cors({
    origin: process.env.CLIENT_URL || '*',
    credentials: true,
  })
);
app.use(express.json({ limit: '10kb' }));

// 2. Tiered rate limiters: strict for authentication, generous for high-frequency gameplay
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // Max 50 authentication requests per IP per 15 minutes (brute-force protection)
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: {
    success: false,
    message: 'Too many authentication attempts from this IP, please try again after 15 minutes.',
  },
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3000, // Sized for interactive puzzle gameplay: allows up to 200 requests/min for move checkpoints & multi-level runs
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again after 15 minutes.',
  },
});

app.use('/api/auth', authLimiter);
app.use('/api', apiLimiter);

// 3. Base health & root routes
app.get('/', (req, res) => {
  res.status(200).json({
    name: GAME_NAME,
    status: 'online',
    message: `Welcome to the ${GAME_NAME} API`,
  });
});

app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
  });
});

// 4. Mount feature routes
app.use('/api/auth', authRoutes);
app.use('/api/levels', levelRoutes);
app.use('/api/games', gameRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/ads', adRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/achievements', achievementRoutes);
app.use('/api/daily-challenge', dailyChallengeRoutes);
app.get('/api/economy/config', rewardedAdController.getConfig);

// 5. 404 Catch-All Handler (registered after valid routes)
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Cannot ${req.method} ${req.originalUrl} - Endpoint not found`,
  });
});

// 6. Global error-handling middleware
app.use((err, req, res, _next) => {
  console.error('Unhandled Server Error:', err.message);
  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || 'Internal server error',
  });
});

export default app;