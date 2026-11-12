/**
 * @file adminMiddleware.js
 * @description Role-based authorization middleware enforcing administrator privileges.
 * Must be executed after protect middleware in authMiddleware.js.
 */

/**
 * Authorizes requests exclusively for users with role: 'admin'.
 * Rejects unauthenticated requests or normal player roles with 403 Forbidden.
 */
export const requireAdmin = (req, res, next) => {
  // 1. Verify that protect middleware has already validated the JWT and attached req.user
  if (!req.user || !req.user.role) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required. Please sign in.',
    });
  }

  // 2. Strictly verify admin role from verified token payload
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Access denied: Administrator privileges required',
    });
  }

  // 3. Proceed to authorized route handler
  next();
};

export default {
  requireAdmin,
};