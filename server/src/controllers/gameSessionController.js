import gameSessionService from '../services/gameSessionService.js';

function extractUserId(req) {
  return req.user?.userId || req.user?._id || req.user?.id;
}

export const startGameSession = async (req, res) => {
  try {
    const { levelNumber } = req.body;
    const userId = extractUserId(req);

    if (!levelNumber || typeof levelNumber !== 'number' || levelNumber < 1) {
      return res.status(400).json({
        success: false,
        message: 'A valid numeric levelNumber (>= 1) is required to start a game session.',
      });
    }

    const session = await gameSessionService.startSession(userId, levelNumber, { isDailyChallenge: false });

    return res.status(201).json({
      success: true,
      message: `Game session initiated for Level ${levelNumber}.`,
      data: session,
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Internal server error while initiating game session.',
    });
  }
};

export const getGameSession = async (req, res) => {
  try {
    const sessionId = req.params.sessionId || req.body.sessionId;
    const userId = extractUserId(req);

    const session = await gameSessionService.getSessionById(sessionId, userId);

    return res.status(200).json({
      success: true,
      data: session,
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Internal server error while retrieving session.',
    });
  }
};

export const saveCheckpoint = async (req, res) => {
  try {
    const sessionId = req.params.sessionId || req.body.sessionId;
    const userId = extractUserId(req);
    const checkpointData = req.body.checkpoint || req.body;

    if (!checkpointData || typeof checkpointData !== 'object') {
      return res.status(400).json({
        success: false,
        message: 'Checkpoint payload object is required.',
      });
    }

    const result = await gameSessionService.saveCheckpoint(sessionId, userId, checkpointData);

    return res.status(200).json({
      success: true,
      message: 'Checkpoint processed successfully.',
      data: result,
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Internal server error while saving checkpoint.',
    });
  }
};

export const applyUndo = async (req, res) => {
  try {
    const sessionId = req.params.sessionId || req.body.sessionId;
    const userId = extractUserId(req);
    const { idempotencyKey } = req.body;

    const result = await gameSessionService.applyUndo(sessionId, userId, idempotencyKey);

    return res.status(200).json({
      success: true,
      message: 'Undo applied successfully.',
      data: result,
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Internal server error while applying undo.',
    });
  }
};

export const applyBooster = async (req, res) => {
  try {
    const sessionId = req.params.sessionId || req.body.sessionId;
    const userId = extractUserId(req);
    const { boosterType, idempotencyKey } = req.body;

    const result = await gameSessionService.applyBooster(sessionId, userId, boosterType, idempotencyKey);

    return res.status(200).json({
      success: true,
      message: 'Booster applied successfully.',
      data: result,
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Internal server error while applying booster.',
    });
  }
};

export const requestHint = async (req, res) => {
  try {
    const sessionId = req.params.sessionId || req.body.sessionId;
    const userId = extractUserId(req);
    const { idempotencyKey } = req.body;

    const result = await gameSessionService.requestHint(sessionId, userId, idempotencyKey);

    return res.status(200).json({
      success: true,
      message: 'Hint generated successfully.',
      data: result,
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Internal server error while requesting hint.',
    });
  }
};

export const completeGameSession = async (req, res) => {
  try {
    const sessionId = req.params.sessionId || req.body.sessionId;
    const userId = extractUserId(req);
    const completionData = req.body;

    const result = await gameSessionService.completeSession(sessionId, userId, completionData);

    return res.status(200).json({
      success: true,
      message: 'Level completed successfully!',
      data: result,
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Internal server error while completing session.',
    });
  }
};

export const failGameSession = async (req, res) => {
  try {
    const sessionId = req.params.sessionId || req.body.sessionId;
    const userId = extractUserId(req);
    const failureData = req.body || {};

    const updatedSession = await gameSessionService.failSession(sessionId, userId, failureData);

    return res.status(200).json({
      success: true,
      message: 'Session status marked as FAILED.',
      data: updatedSession,
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Internal server error while recording failure.',
    });
  }
};

export const abandonGameSession = async (req, res) => {
  try {
    const sessionId = req.params.sessionId || req.body.sessionId;
    const userId = extractUserId(req);

    const updatedSession = await gameSessionService.abandonSession(sessionId, userId);

    return res.status(200).json({
      success: true,
      message: 'Session status marked as ABANDONED.',
      data: updatedSession,
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Internal server error while abandoning session.',
    });
  }
};

export const getActiveSession = async (req, res) => {
  try {
    const userId = extractUserId(req);
    const { levelNumber } = req.params;

    const session = await gameSessionService.getActiveSession(userId, levelNumber);

    return res.status(200).json({
      success: true,
      data: session,
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Internal server error while retrieving active session.',
    });
  }
};

export const getPlayerHistory = async (req, res) => {
  try {
    const userId = extractUserId(req);
    const { page, limit, status, levelNumber } = req.query;

    const history = await gameSessionService.getPlayerHistory(userId, {
      page,
      limit,
      status,
      levelNumber,
    });

    return res.status(200).json({
      success: true,
      data: history.sessions,
      pagination: history.pagination,
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Internal server error while fetching game history.',
    });
  }
};

export const getPlayerProgress = async (req, res) => {
  try {
    const userId = extractUserId(req);
    const progress = await gameSessionService.getPlayerProgress(userId);

    return res.status(200).json({
      success: true,
      data: progress,
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Internal server error while fetching player progress.',
    });
  }
};