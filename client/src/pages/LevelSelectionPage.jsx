import { useState, useEffect, useMemo } from 'react';
import { GAME_NAME } from '../config/gameConfig.js';
import levelService from '../services/levelService.js';
import LevelCard from '../components/levels/LevelCard.jsx';

/**
 * Derives a human-readable objective string from authoritative backend fields.
 */
function formatObjective(objective, targetValue) {
  if (!objective) return 'Reach the Exit Portal';

  switch (objective) {
    case 'eat_all_apples':
      return 'Eat All Apples & Reach Portal';
    case 'reach_portal':
      return 'Reach the Exit Portal';
    case 'collect_keys':
      return 'Collect Keys to Open Gate';
    case 'collect_apple_count':
      return targetValue ? `Collect at least ${targetValue} Apples` : 'Collect Target Apples';
    case 'reach_length':
      return targetValue ? `Grow Worm to Length ${targetValue}` : 'Grow to Target Length';
    case 'limited_moves':
      return targetValue ? `Reach Portal in ≤ ${targetValue} Moves` : 'Complete in Limited Moves';
    case 'perfect_route':
      return 'Reach Portal via Optimal Route';
    default:
      return String(objective)
        .split('_')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
  }
}

export function LevelSelectionPage({ onNavigate, onStartGame }) {
  const [levels, setLevels] = useState([]);
  const [progress, setProgress] = useState(null);
  const [selectedDifficulty, setSelectedDifficulty] = useState('ALL');

  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');

  // Selected level details modal state
  const [inspectedLevel, setInspectedLevel] = useState(null);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [startError, setStartError] = useState('');

  // Fetch levels and player progress concurrently
  const loadData = async () => {
    setIsLoading(true);
    setFetchError('');
    try {
      const [levelsRes, progressRes] = await Promise.all([
        levelService.getPublishedLevels(),
        levelService.getPlayerProgress(),
      ]);

      if (levelsRes && levelsRes.success && Array.isArray(levelsRes.data)) {
        setLevels(levelsRes.data);
      } else {
        throw new Error('Failed to retrieve level manifest from backend.');
      }

      if (progressRes && progressRes.success && progressRes.data) {
        setProgress(progressRes.data);
      }
    } catch (err) {
      setFetchError(err.message || 'Unable to connect to the game server.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Map completed level records using authoritative PlayerProgress field names
  const completedMap = useMemo(() => {
    const map = new Map();
    if (progress && Array.isArray(progress.completedLevels)) {
      progress.completedLevels.forEach((rec) => {
        map.set(rec.levelNumber, rec);
      });
    }
    return map;
  }, [progress]);

  // Determine unlock state using backend progression logic
  const checkIsUnlocked = (levelNum) => {
    if (levelNum === 1) return true;
    if (progress?.highestUnlockedLevel && levelNum <= progress.highestUnlockedLevel) {
      return true;
    }
    return completedMap.has(levelNum - 1);
  };

  // Filter levels by difficulty category
  const filteredLevels = useMemo(() => {
    if (selectedDifficulty === 'ALL') {
      return levels;
    }
    return levels.filter((lvl) => lvl.difficulty === selectedDifficulty);
  }, [levels, selectedDifficulty]);

  // Handle card click with accessible locked feedback
  const handleSelectCard = (level, isUnlocked) => {
    if (!isUnlocked) {
      setStartError(`Level ${level.levelNumber} is locked. Complete Level ${level.levelNumber - 1} first.`);
      return;
    }
    setStartError('');
    setInspectedLevel(level);
  };

  // Handle initiating a session via POST /api/games/start
  const handleStartSession = async (level) => {
    if (isStartingSession) return;
    setIsStartingSession(true);
    setStartError('');

    try {
      const response = await levelService.startLevelSession(level.levelNumber);
      if (response && response.success && response.data) {
        setInspectedLevel(null);
        onStartGame(response.data, level);
      } else {
        throw new Error(response.message || 'Failed to start game session.');
      }
    } catch (err) {
      setStartError(err.message || 'Error initiating game session.');
    } finally {
      setIsStartingSession(false);
    }
  };

  const totalLevelsCount = levels.length;
  const completedCount = completedMap.size;
  const totalStarsEarned = progress?.totalStars || 0;
  const highestUnlocked = progress?.highestUnlockedLevel || 1;

  // Star threshold values from backend (supports threeStar/threeStars schema)
  const threeStarGoal =
    inspectedLevel?.starThresholds?.threeStar ?? inspectedLevel?.starThresholds?.threeStars;
  const twoStarGoal =
    inspectedLevel?.starThresholds?.twoStar ?? inspectedLevel?.starThresholds?.twoStars;
  const oneStarGoal =
    inspectedLevel?.starThresholds?.oneStar ?? inspectedLevel?.starThresholds?.oneStars;

  return (
    <div className="levels-container">
      {/* Top Header & Navigation */}
      <div className="levels-header">
        <div>
          <button type="button" className="btn btn-secondary back-btn" onClick={() => onNavigate('HOME')}>
            ← Back to Dashboard
          </button>
          <h1 className="levels-title">Level Selection</h1>
          <p className="levels-subtitle">
            Explore 50 hand-crafted puzzles across 5 distinct difficulty tiers.
          </p>
        </div>

        {/* Real-time Progression Summary */}
        <div className="levels-progression-card">
          <div className="prog-stat">
            <span className="prog-val">
              {isLoading ? '...' : `${completedCount} / ${totalLevelsCount}`}
            </span>
            <span className="prog-lbl">Completed</span>
          </div>
          <div className="prog-divider"></div>
          <div className="prog-stat">
            <span className="prog-val gold-text">★ {totalStarsEarned}</span>
            <span className="prog-lbl">Stars</span>
          </div>
          <div className="prog-divider"></div>
          <div className="prog-stat">
            <span className="prog-val green-text">Lvl {highestUnlocked}</span>
            <span className="prog-lbl">Unlocked</span>
          </div>
        </div>
      </div>

      {/* Global alert for locked level attempt or connection issue */}
      {startError && !inspectedLevel && (
        <div className="alert alert-error" role="alert">
          <span>⚠️ {startError}</span>
        </div>
      )}

      {/* Difficulty Category Filter Bar */}
      <div className="difficulty-filter-bar" role="tablist" aria-label="Difficulty Filter">
        {[
          { key: 'ALL', label: `All (${levels.length})` },
          { key: 'tutorial', label: 'Tutorial' },
          { key: 'easy', label: 'Easy' },
          { key: 'medium', label: 'Medium' },
          { key: 'hard', label: 'Hard' },
          { key: 'expert', label: 'Expert' },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`filter-chip ${selectedDifficulty === tab.key ? 'active' : ''}`}
            onClick={() => setSelectedDifficulty(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="levels-loading-state" role="status">
          <div className="spinner-dot large"></div>
          <p>Loading published puzzles from {GAME_NAME} server...</p>
        </div>
      )}

      {/* Error State with Retry Button */}
      {fetchError && !isLoading && (
        <div className="levels-error-state" role="alert">
          <span className="error-icon">⚠️</span>
          <h3>Failed to Load Levels</h3>
          <p>{fetchError}</p>
          <button type="button" className="btn btn-primary" onClick={loadData}>
            Retry Connection
          </button>
        </div>
      )}

      {/* Level Grid */}
      {!isLoading && !fetchError && (
        <div className="levels-grid">
          {filteredLevels.map((lvl) => {
            const isUnlocked = checkIsUnlocked(lvl.levelNumber);
            const isCompleted = completedMap.has(lvl.levelNumber);
            const record = completedMap.get(lvl.levelNumber);

            return (
              <LevelCard
                key={lvl.levelNumber}
                level={lvl}
                isUnlocked={isUnlocked}
                isCompleted={isCompleted}
                completionRecord={record}
                onSelect={handleSelectCard}
              />
            );
          })}
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !fetchError && filteredLevels.length === 0 && (
        <div className="levels-empty-state">
          <p>No levels found matching category "{selectedDifficulty}".</p>
        </div>
      )}

      {/* Level Details & Launch Modal */}
      {inspectedLevel && (
        <div className="modal-backdrop" onClick={() => !isStartingSession && setInspectedLevel(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <span className={`diff-badge diff-${inspectedLevel.difficulty}`}>
                  {inspectedLevel.difficulty?.toUpperCase()}
                </span>
                <h2>{inspectedLevel.title || `Level ${inspectedLevel.levelNumber}`}</h2>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setInspectedLevel(null)}
                disabled={isStartingSession}
                title="Close level preview"
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              {startError && (
                <div className="alert alert-error">
                  <span>{startError}</span>
                </div>
              )}

              <div className="level-spec-grid">
                <div className="spec-item">
                  <span className="spec-label">Grid Dimensions</span>
                  <span className="spec-val">
                    {inspectedLevel.grid?.cols !== undefined && inspectedLevel.grid?.rows !== undefined
                      ? `${inspectedLevel.grid.cols} × ${inspectedLevel.grid.rows}`
                      : 'Not configured'}
                  </span>
                </div>
                <div className="spec-item">
                  <span className="spec-label">Move Limit</span>
                  <span className="spec-val">
                    {inspectedLevel.moveLimit !== undefined && inspectedLevel.moveLimit !== null
                      ? `${inspectedLevel.moveLimit} moves`
                      : 'Not configured'}
                  </span>
                </div>
                <div className="spec-item">
                  <span className="spec-label">Apples</span>
                  <span className="spec-val">
                    {Array.isArray(inspectedLevel.apples)
                      ? `${inspectedLevel.apples.length} apples`
                      : 'Not configured'}
                  </span>
                </div>
                <div className="spec-item spec-item-wide">
                  <span className="spec-label">Objective</span>
                  <span className="spec-val">
                    {formatObjective(inspectedLevel.objective, inspectedLevel.targetValue)}
                  </span>
                </div>
              </div>

              {/* Star Threshold Goals */}
              <div className="star-threshold-box">
                <h4>Star Thresholds:</h4>
                <div className="star-goal-row">
                  <span>
                    ★★★ 3 Stars:{' '}
                    {threeStarGoal !== undefined ? `≤ ${threeStarGoal} moves` : 'Not configured'}
                  </span>
                  <span>
                    ★★☆ 2 Stars:{' '}
                    {twoStarGoal !== undefined ? `≤ ${twoStarGoal} moves` : 'Not configured'}
                  </span>
                  <span>
                    ★☆☆ 1 Star:{' '}
                    {oneStarGoal !== undefined ? `≤ ${oneStarGoal} moves` : 'Complete the level'}
                  </span>
                </div>
              </div>

              {/* Personal Record from PlayerProgress */}
              {completedMap.has(inspectedLevel.levelNumber) && (
                <div className="personal-record-box">
                  <h4>Your Best Performance:</h4>
                  <p>
                    Stars: <strong>{completedMap.get(inspectedLevel.levelNumber).stars} ★</strong> | Fewest Moves:{' '}
                    <strong>{completedMap.get(inspectedLevel.levelNumber).leastMoves ?? 'N/A'}</strong> | High Score:{' '}
                    <strong>
                      {completedMap.get(inspectedLevel.levelNumber).highScore !== undefined
                        ? completedMap.get(inspectedLevel.levelNumber).highScore.toLocaleString()
                        : 'N/A'}
                    </strong>
                  </p>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setInspectedLevel(null)}
                disabled={isStartingSession}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary btn-play-modal"
                onClick={() => handleStartSession(inspectedLevel)}
                disabled={isStartingSession}
              >
                {isStartingSession ? 'Initiating Session...' : 'Play Level ▶'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default LevelSelectionPage;