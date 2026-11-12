import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';

// Whitelist of valid roles recognized by the system
const VALID_ROLES = ['player', 'admin'];

/**
 * Authentication Middleware: Protects private routes
 * Validates the JWT Bearer token and attaches verified credentials to req.user.
 */
export const protect = async (req, res, next) => {
  try {
    // 1. Verify server configuration before inspecting request
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      console.error('CRITICAL CONFIGURATION ERROR: JWT_SECRET is not set in environment variables.');
      return res.status(500).json({
        success: false,
        message: 'Authentication service misconfigured. Please contact support.',
      });
    }

    // 2. Read and validate Authorization header format
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized, token missing or malformed',
      });
    }

    // 3. Extract the token string
    const token = authHeader.split(' ')[1]?.trim();

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized, token missing',
      });
    }

    // 4. Verify token signature and expiration
    let decoded;
    try {
      decoded = jwt.verify(token, secret);
    } catch (jwtError) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized, token invalid or expired',
      });
    }

    // 5. Strictly validate payload fields and role integrity
    const isValidUserId =
      Boolean(decoded?.userId) && mongoose.Types.ObjectId.isValid(decoded.userId);
    const isValidRole =
      Boolean(decoded?.role) && VALID_ROLES.includes(decoded.role);

    if (!isValidUserId || !isValidRole) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized, invalid token payload',
      });
    }

    // 6. Attach strictly validated credentials to the request
    req.user = {
      userId: decoded.userId,
      role: decoded.role,
    };

    // 7. Proceed to next middleware or route handler
    next();
  } catch (error) {
    console.error('Auth middleware error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Server error during authentication',
    });
  }
};