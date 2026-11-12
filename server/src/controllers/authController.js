import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import User from '../models/User.js';

/**
 * Internal Helper: Validate that JWT_SECRET is available.
 * Returns the secret or throws an error if unconfigured.
 */
const getValidatedJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('CRITICAL CONFIGURATION ERROR: JWT_SECRET is not set in environment variables.');
    return null;
  }
  return secret;
};

/**
 * Internal Helper: Generate signed JWT token.
 */
const generateToken = (userId, role, secret) => {
  const expiresIn = process.env.JWT_EXPIRES_IN || '7d';
  return jwt.sign({ userId, role }, secret, { expiresIn });
};

/**
 * @desc    Register a new player account
 * @route   POST /api/auth/register
 * @access  Public
 */
export const registerUser = async (req, res) => {
  try {
    // 1. Pre-flight check: Ensure JWT_SECRET is configured before database operations
    const jwtSecret = getValidatedJwtSecret();
    if (!jwtSecret) {
      return res.status(500).json({
        success: false,
        message: 'Authentication service misconfigured. Please contact support.',
      });
    }

    const { username, email, password } = req.body;

    // 2. Validate input types (must be strings to prevent TypeErrors on trim/toLowerCase)
    if (
      typeof username !== 'string' ||
      typeof email !== 'string' ||
      typeof password !== 'string'
    ) {
      return res.status(400).json({
        success: false,
        message: 'Username, email, and password must be valid strings',
      });
    }

    // 3. Sanitize inputs
    const trimmedUsername = username.trim();
    const normalizedEmail = email.trim().toLowerCase();

    // 4. Validate presence and length requirements
    if (!trimmedUsername || !normalizedEmail || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide username, email, and password',
      });
    }

    if (trimmedUsername.length < 3) {
      return res.status(400).json({
        success: false,
        message: 'Username must be at least 3 characters long',
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long',
      });
    }

    // 5. Pre-check for duplicate accounts
    const existingUser = await User.findOne({
      $or: [{ email: normalizedEmail }, { username: trimmedUsername }],
    });

    if (existingUser) {
      const isEmailConflict = existingUser.email === normalizedEmail;
      return res.status(409).json({
        success: false,
        message: isEmailConflict
          ? 'An account with this email already exists'
          : 'Username is already taken',
      });
    }

    // 6. Create user with strictly enforced 'player' role
    // Password hashing is performed automatically by User model pre-save hook
    const user = await User.create({
      username: trimmedUsername,
      email: normalizedEmail,
      password,
      role: 'player',
    });

    // 7. Generate session token
    const token = generateToken(user._id, user.role, jwtSecret);

    // 8. Return response (password is omitted via User schema toJSON transform)
    return res.status(201).json({
      success: true,
      message: 'User registered successfully',
      token,
      user,
    });
  } catch (error) {
    // Handle MongoDB unique constraint violations (race conditions on duplicate registration)
    if (error.code === 11000) {
      const duplicateField = error.keyPattern
        ? Object.keys(error.keyPattern)[0]
        : error.keyValue
        ? Object.keys(error.keyValue)[0]
        : '';

      const message =
        duplicateField === 'email'
          ? 'An account with this email already exists'
          : duplicateField === 'username'
          ? 'Username is already taken'
          : 'An account with these details already exists';

      return res.status(409).json({
        success: false,
        message,
      });
    }

    console.error('Registration error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Server error during registration. Please try again.',
    });
  }
};

/**
 * @desc    Authenticate player & return token
 * @route   POST /api/auth/login
 * @access  Public
 */
export const loginUser = async (req, res) => {
  try {
    // 1. Pre-flight check: Ensure JWT_SECRET is configured before database operations
    const jwtSecret = getValidatedJwtSecret();
    if (!jwtSecret) {
      return res.status(500).json({
        success: false,
        message: 'Authentication service misconfigured. Please contact support.',
      });
    }

    const { email, password } = req.body;

    // 2. Validate input types
    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Email and password must be valid strings',
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // 3. Validate presence of credentials
    if (!normalizedEmail || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password',
      });
    }

    // 4. Find user by normalized email
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      // Generic error message to prevent user enumeration
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    // 5. Verify account is active
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Account is deactivated. Please contact support.',
      });
    }

    // 6. Verify password using comparePassword method
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    // 7. Generate session token
    const token = generateToken(user._id, user.role, jwtSecret);

    // 8. Return response
    return res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      user,
    });
  } catch (error) {
    console.error('Login error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Server error during login. Please try again.',
    });
  }
};

/**
 * @desc    Get authenticated user profile
 * @route   GET /api/auth/me
 * @access  Private (Populated by JWT middleware)
 */
export const getMe = async (req, res) => {
  try {
    const userId = req.user?.userId;

    // 1. Validate presence of userId
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized, invalid session',
      });
    }

    // 2. Validate MongoDB ObjectId format to prevent CastErrors
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user identifier format',
      });
    }

    // 3. Query user
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Account is deactivated',
      });
    }

    return res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    // Guard against potential malformed query errors
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid user identifier format',
      });
    }

    console.error('Get profile error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Server error retrieving user profile',
    });
  }
};