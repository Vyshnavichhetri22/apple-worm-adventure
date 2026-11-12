import dns from 'node:dns';

// DNS workaround: Force Google and Cloudflare DNS to resolve Atlas SRV records
dns.setServers(['8.8.8.8', '1.1.1.1']);

// ESM-compatible dotenv initialization: loads variables before downstream module execution
import 'dotenv/config';

import app from './app.js';
import databaseConnection from './config/database.js';

const PORT = process.env.PORT || 5000;
const GAME_NAME = process.env.GAME_NAME || 'APPLE WORM ADVENTURE';

/**
 * Connect to MongoDB first, then start listening for HTTP requests
 */
const startServer = async () => {
  try {
    // Accommodates default export function or named connectDB function
    if (typeof databaseConnection === 'function') {
      await databaseConnection();
    } else if (databaseConnection && typeof databaseConnection.connectDB === 'function') {
      await databaseConnection.connectDB();
    }

    app.listen(PORT, () => {
      console.log(`[${GAME_NAME}] Server listening on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
};

startServer();

export default app;





// import dns from 'node:dns';

// // DNS workaround: Force Google and Cloudflare DNS to resolve Atlas SRV records
// dns.setServers(['8.8.8.8', '1.1.1.1']);


// import express from 'express';
// import cors from 'cors';
// import helmet from 'helmet';
// import rateLimit from 'express-rate-limit';
// import dotenv from 'dotenv';
// import databaseConnection from './config/database.js';
// import authRoutes from './routes/authRoutes.js';

// // Load environment variables from server/.env
// dotenv.config();

// const app = express();
// const PORT = process.env.PORT || 5000;
// const GAME_NAME = process.env.GAME_NAME || 'APPLE WORM ADVENTURE';

// // 1. Security & request processing middleware
// app.use(helmet());
// app.use(
//   cors({
//     origin: process.env.CLIENT_URL || '*',
//     credentials: true,
//   })
// );
// app.use(express.json({ limit: '10kb' }));

// // 2. Global rate limiter for API endpoints (prevents brute-force & spam)
// const apiLimiter = rateLimit({
//   windowMs: 15 * 60 * 1000, // 15 minutes
//   max: 100, // Max 100 requests per IP per window
//   standardHeaders: true,
//   legacyHeaders: false,
//   message: {
//     success: false,
//     message: 'Too many requests from this IP, please try again after 15 minutes.',
//   },
// });
// app.use('/api', apiLimiter);

// // 3. Base routes
// app.get('/', (req, res) => {
//   res.status(200).json({
//     name: GAME_NAME,
//     status: 'online',
//     message: `Welcome to the ${GAME_NAME} API`,
//   });
// });

// app.get('/api/health', (req, res) => {
//   res.status(200).json({
//     status: 'healthy',
//     timestamp: new Date().toISOString(),
//   });
// });

// // 4. Mount authentication routes
// app.use('/api/auth', authRoutes);

// // 5. 404 Catch-All Handler (must be registered after all valid routes)
// app.use((req, res) => {
//   res.status(404).json({
//     success: false,
//     message: `Cannot ${req.method} ${req.originalUrl} - Endpoint not found`,
//   });
// });

// // 6. Global error-handling middleware
// app.use((err, req, res, next) => {
//   console.error('Unhandled Server Error:', err.message);
//   res.status(500).json({
//     success: false,
//     message: 'Internal server error',
//   });
// });

// // 7. Connect to database and start server
// const startServer = async () => {
//   try {
//     // Accommodates default export function or named connectDB function
//     if (typeof databaseConnection === 'function') {
//       await databaseConnection();
//     } else if (databaseConnection && typeof databaseConnection.connectDB === 'function') {
//       await databaseConnection.connectDB();
//     }

//     app.listen(PORT, () => {
//       console.log(`[${GAME_NAME}] Server listening on port ${PORT}`);
//     });
//   } catch (error) {
//     console.error('Failed to start server:', error.message);
//     process.exit(1);
//   }
// };

// startServer();

// export default app;