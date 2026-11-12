import React from 'react';

/**
 * Accessible Level Card component.
 * Implemented as a semantic button to provide native keyboard interaction (Enter / Space).
 * Contains no nested interactive elements.
 */
export function LevelCard({
  level,
  isUnlocked,
  isCompleted,
  completionRecord,
  onSelect,
}) {
  const levelTitle = level.title || `Level ${level.levelNumber}`;
  const difficulty = level.difficulty || 'easy';
  const difficultyClass = `diff-${difficulty.toLowerCase()}`;

  // Real backend fields from PlayerProgress completedLevels record
  const starsEarned = completionRecord?.stars || 0;
  const leastMoves = completionRecord?.leastMoves;
  const highScore = completionRecord?.highScore;

  // Real backend grid dimensions
  const gridText =
    level.grid?.cols !== undefined && level.grid?.rows !== undefined
      ? `${level.grid.cols}×${level.grid.rows}`
      : 'Not configured';

  const moveLimitText =
    level.moveLimit !== undefined && level.moveLimit !== null
      ? `${level.moveLimit} moves`
      : 'Not configured';

  const handleClick = () => {
    if (onSelect) {
      onSelect(level, isUnlocked);
    }
  };

  const accessibleLabel = `${levelTitle}, Difficulty: ${difficulty}. ${
    isCompleted
      ? `Completed with ${starsEarned} stars. Fewest moves: ${leastMoves ?? 'N/A'}.`
      : isUnlocked
      ? `Unlocked. Move limit: ${moveLimitText}.`
      : 'Locked.'
  }`;

  return (
    <button
      type="button"
      className={`level-card ${isUnlocked ? 'unlocked' : 'locked'} ${
        isCompleted ? 'completed' : ''
      }`}
      onClick={handleClick}
      aria-disabled={!isUnlocked}
      aria-label={accessibleLabel}
    >
      {/* Top Header: Level identifier & difficulty badge */}
      <div className="level-card-header">
        <span className="level-num">#{level.levelNumber}</span>
        <span className={`diff-badge ${difficultyClass}`}>
          {difficulty.toUpperCase()}
        </span>
      </div>

      {/* Middle Body: Status Icon or Stars */}
      <div className="level-card-body">
        {isCompleted ? (
          <div className="completion-star-row" aria-hidden="true">
            {[1, 2, 3].map((starIndex) => (
              <span
                key={starIndex}
                className={`star-icon ${starIndex <= starsEarned ? 'filled' : 'empty'}`}
              >
                ★
              </span>
            ))}
          </div>
        ) : isUnlocked ? (
          <div className="unlocked-icon-wrapper" aria-hidden="true">
            ▶
          </div>
        ) : (
          <div className="locked-icon-wrapper" aria-hidden="true">
            🔒
          </div>
        )}
      </div>

      {/* Footer Info: Grid, move limits, and action indicator */}
      <div className="level-card-footer">
        <span className="move-limit-pill">{gridText}</span>

        {isCompleted ? (
          <span className="score-pill">
            {highScore !== undefined && highScore !== null ? highScore.toLocaleString() : 'Done'}
          </span>
        ) : isUnlocked ? (
          <span className="card-action-tag">Play</span>
        ) : (
          <span className="status-label">Locked</span>
        )}
      </div>
    </button>
  );
}

export default LevelCard;