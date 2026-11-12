/**
 * @file levelController.js
 * @description Controller handling public level browsing and administrator draft/publish operations.
 */

import Level from '../models/Level.js';
import { validateLevelPlayability } from '../services/levelValidationService.js';

/**
 * Whitelist of level fields permitted in draft update payloads.
 */
const EDITABLE_FIELDS = [
  'difficulty',
  'grid',
  'wormStart',
  'apples',
  'stones',
  'keys',
  'obstacles',
  'portal',
  'moveLimit',
  'starThresholds',
  'objective',
  'targetValue',
];

/**
 * Restricted fields that must never be modified via update payload.
 */
const RESTRICTED_FIELDS = ['_id', 'isActive', 'createdAt', 'updatedAt', '__v'];

/**
 * Helper: Parses and validates a levelNumber URL parameter as a positive integer.
 * @param {string} param - Raw string from req.params.levelNumber
 * @returns {number|null} - Parsed positive integer or null if invalid
 */
const parsePositiveInteger = (param) => {
  const num = Number(param);
  return Number.isInteger(num) && num > 0 ? num : null;
};

// ============================================================================
// PUBLIC ENDPOINTS
// ============================================================================

/**
 * @desc    Get all active, published levels
 * @route   GET /api/levels
 * @access  Public
 */
export const getPublishedLevels = async (req, res) => {
  try {
    const levels = await Level.find({ isActive: true })
      .select('-__v')
      .sort({ levelNumber: 1 })
      .lean();

    return res.status(200).json({
      success: true,
      count: levels.length,
      data: levels,
    });
  } catch (error) {
    console.error('Error fetching published levels:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Internal server error while fetching levels',
    });
  }
};

/**
 * @desc    Get a single active published level by level number
 * @route   GET /api/levels/:levelNumber
 * @access  Public
 */
export const getPublishedLevelByNumber = async (req, res) => {
  try {
    const levelNumber = parsePositiveInteger(req.params.levelNumber);
    if (levelNumber === null) {
      return res.status(400).json({
        success: false,
        message: 'Invalid level number. Must be a positive integer.',
      });
    }

    const level = await Level.findOne({ levelNumber, isActive: true })
      .select('-__v')
      .lean();

    if (!level) {
      return res.status(404).json({
        success: false,
        message: `Level ${levelNumber} not found or is currently unpublished.`,
      });
    }

    return res.status(200).json({
      success: true,
      data: level,
    });
  } catch (error) {
    console.error('Error fetching level by number:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Internal server error while retrieving level',
    });
  }
};

// ============================================================================
// ADMINISTRATOR ENDPOINTS
// ============================================================================

/**
 * @desc    Create a new level as an unpublished draft
 * @route   POST /api/levels
 * @access  Private (Admin only)
 */
export const createLevelDraft = async (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({
        success: false,
        message: 'Request body must be a valid JSON object.',
      });
    }

    const payload = { ...req.body };

    // Validate levelNumber presence and format
    const levelNumber = parsePositiveInteger(payload.levelNumber);
    if (levelNumber === null) {
      return res.status(400).json({
        success: false,
        message: 'Field levelNumber must be a positive integer.',
      });
    }
    payload.levelNumber = levelNumber;

    // Check for duplicate level number upfront
    const existing = await Level.findOne({ levelNumber });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: `Level number ${levelNumber} already exists.`,
      });
    }

    // Force newly created levels to be drafts
    payload.isActive = false;

    const newLevel = new Level(payload);
    await newLevel.save();

    const responseData = newLevel.toObject();
    delete responseData.__v;

    return res.status(201).json({
      success: true,
      message: `Level draft ${levelNumber} created successfully.`,
      data: responseData,
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({
        success: false,
        message: 'Level validation failed',
        errors: messages,
      });
    }

    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Level number already exists in the database.',
      });
    }

    console.error('Error creating level draft:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Internal server error while creating level draft',
    });
  }
};

/**
 * @desc    Update an existing unpublished level draft
 * @route   PUT /api/levels/:levelNumber
 * @access  Private (Admin only)
 */
export const updateLevelDraft = async (req, res) => {
  try {
    const levelNumber = parsePositiveInteger(req.params.levelNumber);
    if (levelNumber === null) {
      return res.status(400).json({
        success: false,
        message: 'Invalid level number. Must be a positive integer.',
      });
    }

    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({
        success: false,
        message: 'Request body must be a valid JSON object.',
      });
    }

    const level = await Level.findOne({ levelNumber });
    if (!level) {
      return res.status(404).json({
        success: false,
        message: `Level ${levelNumber} does not exist.`,
      });
    }

    // Guard: Prevent direct modification of published levels without unpublishing first
    if (level.isActive) {
      return res.status(400).json({
        success: false,
        message: `Level ${levelNumber} is currently published and cannot be modified. Unpublish the level before editing.`,
      });
    }

    const incomingKeys = Object.keys(req.body);

    // Guard: Explicitly reject attempts to change levelNumber
    if (req.body.levelNumber !== undefined && req.body.levelNumber !== levelNumber) {
      return res.status(400).json({
        success: false,
        message: 'Modifying levelNumber of an existing level is not permitted.',
      });
    }

    // Guard: Check for restricted non-editable fields
    const foundRestricted = incomingKeys.filter((k) => RESTRICTED_FIELDS.includes(k));
    if (foundRestricted.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Modification of restricted field(s) [${foundRestricted.join(', ')}] is not permitted.`,
      });
    }

    // Guard: Whitelist validation
    const invalidFields = incomingKeys.filter(
      (k) => !EDITABLE_FIELDS.includes(k) && k !== 'levelNumber'
    );
    if (invalidFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Unknown or uneditable field(s) provided: [${invalidFields.join(', ')}].`,
      });
    }

    // Apply whitelisted updates onto the document
    for (const field of EDITABLE_FIELDS) {
      if (req.body[field] !== undefined) {
        level[field] = req.body[field];
      }
    }

    // Save triggers Mongoose schema and pre-validation hooks
    await level.save();

    const responseData = level.toObject();
    delete responseData.__v;

    return res.status(200).json({
      success: true,
      message: `Level draft ${levelNumber} updated successfully.`,
      data: responseData,
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({
        success: false,
        message: 'Level update validation failed',
        errors: messages,
      });
    }

    console.error('Error updating level draft:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Internal server error while updating level draft',
    });
  }
};

/**
 * @desc    Validate and publish a level draft
 * @route   POST /api/levels/:levelNumber/publish
 * @access  Private (Admin only)
 */
export const publishLevel = async (req, res) => {
  try {
    const levelNumber = parsePositiveInteger(req.params.levelNumber);
    if (levelNumber === null) {
      return res.status(400).json({
        success: false,
        message: 'Invalid level number. Must be a positive integer.',
      });
    }

    const level = await Level.findOne({ levelNumber });
    if (!level) {
      return res.status(404).json({
        success: false,
        message: `Level ${levelNumber} does not exist.`,
      });
    }

    if (level.isActive) {
      return res.status(400).json({
        success: false,
        message: `Level ${levelNumber} is already published.`,
      });
    }

    // Step 1: Run Mongoose schema validation
    try {
      await level.validate();
    } catch (schemaErr) {
      const messages = Object.values(schemaErr.errors || {}).map((e) => e.message);
      return res.status(422).json({
        success: false,
        message: 'Level failed schema validation and cannot be published',
        errors: messages,
      });
    }

    // Step 2: Run static reachability and game-rule playability validation
    const playabilityResult = validateLevelPlayability(level.toObject());

    // Explicitly reject if validation failed or if state exploration was inconclusive
    if (!playabilityResult.isValid || playabilityResult.details.isInconclusive === true) {
      return res.status(422).json({
        success: false,
        message: 'Level failed playability verification and cannot be published',
        errors: playabilityResult.errors,
        warnings: playabilityResult.warnings,
        details: playabilityResult.details,
      });
    }

    // Step 3: Activate and save
    level.isActive = true;
    await level.save();

    const responseData = level.toObject();
    delete responseData.__v;

    return res.status(200).json({
      success: true,
      message: `Level ${levelNumber} successfully verified and published.`,
      data: responseData,
      warnings: playabilityResult.warnings,
      details: playabilityResult.details,
    });
  } catch (error) {
    console.error('Error publishing level:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Internal server error while publishing level',
    });
  }
};

/**
 * @desc    Unpublish an active level back to draft state
 * @route   POST /api/levels/:levelNumber/unpublish
 * @access  Private (Admin only)
 */
export const unpublishLevel = async (req, res) => {
  try {
    const levelNumber = parsePositiveInteger(req.params.levelNumber);
    if (levelNumber === null) {
      return res.status(400).json({
        success: false,
        message: 'Invalid level number. Must be a positive integer.',
      });
    }

    const level = await Level.findOne({ levelNumber });
    if (!level) {
      return res.status(404).json({
        success: false,
        message: `Level ${levelNumber} does not exist.`,
      });
    }

    if (!level.isActive) {
      return res.status(400).json({
        success: false,
        message: `Level ${levelNumber} is already in unpublished (draft) state.`,
      });
    }

    level.isActive = false;
    await level.save();

    const responseData = level.toObject();
    delete responseData.__v;

    return res.status(200).json({
      success: true,
      message: `Level ${levelNumber} unpublished successfully.`,
      data: responseData,
    });
  } catch (error) {
    console.error('Error unpublishing level:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Internal server error while unpublishing level',
    });
  }
};