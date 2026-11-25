import { connectDB, sanitizeErrorMessage } from '../config/database.js';

/**
 * Express middleware to ensure an active MongoDB connection before
 * executing database-dependent API route handlers.
 *
 * Designed for serverless environments (e.g. Vercel Functions):
 *  - Calls connectDB(), which reuses established connections instantly.
 *  - Guards against unhandled promise rejections or container crashes.
 *  - If connection fails, returns HTTP 503 Service Unavailable without
 *    leaking credentials, database hosts, or internal connection strings.
 */
export const databaseMiddleware = async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    const sanitizedMsg = sanitizeErrorMessage(error.message);
    console.error(`[DATABASE MIDDLEWARE] Rejecting ${req.method} ${req.originalUrl}:`, sanitizedMsg);

    return res.status(503).json({
      success: false,
      message: 'Database service temporarily unavailable. Please try again shortly.',
    });
  }
};

export default databaseMiddleware;
