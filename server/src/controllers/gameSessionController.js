import gameSessionService from '../services/gameSessionService.js';

export const startGameSession = async (req, res) => {
  try {
    const { levelNumber } = req.body;
    const userId = req.user.userId;

    if (!levelNumber || typeof levelNumber !== 'number' || levelNumber < 1) {
      return res.status(400).json({
        success: false,
        message: 'A valid numeric levelNumber (>= 1) is required to start a game session.',
      });
    }

    const session = await gameSessionService.startSession(userId, levelNumber);

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
    const { sessionId } = req.params;
    const userId = req.user.userId;

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
    const { sessionId } = req.params;
    const userId = req.user.userId;
    const checkpointData = req.body;

    if (!checkpointData || typeof checkpointData !== 'object') {
      return res.status(400).json({
        success: false,
        message: 'Checkpoint payload object is required.',
      });
    }

    const updatedSession = await gameSessionService.saveCheckpoint(
      sessionId,
      userId,
      checkpointData
    );

    return res.status(200).json({
      success: true,
      message: 'Checkpoint saved successfully.',
      data: updatedSession.checkpoint,
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Internal server error while saving checkpoint.',
    });
  }
};

export const completeGameSession = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user.userId;
    const completionData = req.body;

    if (!completionData || typeof completionData !== 'object') {
      return res.status(400).json({
        success: false,
        message: 'Completion payload is required.',
      });
    }

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
    const { sessionId } = req.params;
    const userId = req.user.userId;
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

export const getPlayerHistory = async (req, res) => {
  try {
    const userId = req.user.userId;
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
    const userId = req.user.userId;
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