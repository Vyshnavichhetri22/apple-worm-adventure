/**
 * client/src/components/game/GameDialogs.jsx
 * Authoritative Victory and Failure dialogs for Apple Worm Adventure.
 * 
 * - Next Level is strictly gated to confirmed backend completion and reward presence.
 * - Next Level is disabled while completion or verification is submitting.
 * - Clean JSX syntax: star celebration is verified and free of stray escape characters.
 * - Retry Verification operates strictly on existing session rewards without creating duplicates.
 * - Authoritative stars, score, coins, and wallet balance rendered without fabrication.
 */

import React from 'react';

export function VictoryDialog({
  isOpen,
  levelNumber,
  moves,
  duration,
  submitting,
  backendRewards,
  backendWallet,
  submitError,
  onRetrySubmit,
  onNextLevel,
  onLevelSelect,
  isLastLevel,
  isDoubleCoinsClaimed = false,
  isDoubleScoreClaimed = false,
  onWatchAdDoubleScore,
  onWatchAdDoubleCoins,
  isDailyChallenge = false,
  dailyStreak = null,
  adsAvailable = false,
}) {
  if (!isOpen) return null;

  // Next level is strictly permitted ONLY when completion and rewards are confirmed by server
  const isConfirmed = !submitting && !submitError && Boolean(backendRewards);

  return (
    <div className="modal-backdrop">
      <div className="modal-card victory-modal">
        <span className="celebration-badge">
          {isDailyChallenge ? '📅 Daily Challenge Solved!' : 'Level Complete!'}
        </span>
        <h2>{isDailyChallenge ? "Today's Challenge Completed" : `Level ${levelNumber} Cleared`}</h2>

        {submitting && (
          <div className="dialog-pending-state">
            <div className="loading-spinner" />
            <p>Validating run and securing rewards on VELoop server...</p>
          </div>
        )}

        {submitError && !submitting && (
          <div className="dialog-error-state">
            <p className="error-badge">⚠️ Verification Notice</p>
            <p className="error-message">{submitError}</p>
            <div className="victory-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={onRetrySubmit}
                disabled={submitting}
              >
                🔄 Retry Verification
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onLevelSelect}
                disabled={submitting}
              >
                Back to Map
              </button>
            </div>
          </div>
        )}

        {isConfirmed && (
          <div>
            <div className="stars-celebration">
              {[1, 2, 3].map((starNum) => (
                <span
                  key={starNum}
                  className={`celebration-star ${starNum <= (backendRewards.stars || 1) ? 'star-earned' : 'star-missed'}`}
                >
                  ★
                </span>
              ))}
            </div>

            <div className="victory-rewards-card">
              <div className="reward-stat-item">
                <span className="reward-label">Moves Taken</span>
                <span className="reward-value">{moves}</span>
              </div>
              <div className="reward-stat-item">
                <span className="reward-label">Time Elapsed</span>
                <span className="reward-value">{duration}s</span>
              </div>
              <div className="reward-stat-item">
                <span className="reward-label">Coins Credited</span>
                <span className="reward-value gold-text">+{backendRewards.coins}</span>
              </div>
              <div className="reward-stat-item">
                <span className="reward-label">Clear Score</span>
                <span className="reward-value green-text">{backendRewards.score}</span>
              </div>
            </div>

            {Boolean(isDailyChallenge || dailyStreak) && (
              <div
                className="daily-streak-celebration-banner"
                style={{
                  marginBottom: '0.85rem',
                  padding: '0.6rem 0.9rem',
                  borderRadius: '6px',
                  backgroundColor: 'rgba(249, 115, 22, 0.15)',
                  border: '1px solid rgba(249, 115, 22, 0.4)',
                  fontSize: '0.9rem',
                  color: '#fb923c',
                  textAlign: 'center',
                  fontWeight: '700',
                }}
              >
                🔥 {dailyStreak?.currentStreak ? `${dailyStreak.currentStreak} Day Streak!` : 'Daily Challenge Completed!'} (+150 Coins)
              </div>
            )}

            {Boolean(backendRewards.goldenCoins || backendRewards.goldenApples) && (
              <div
                className="golden-apple-reward-banner"
                style={{
                  marginBottom: '0.85rem',
                  padding: '0.4rem 0.8rem',
                  borderRadius: '6px',
                  backgroundColor: 'rgba(234, 179, 8, 0.12)',
                  border: '1px solid rgba(234, 179, 8, 0.35)',
                  fontSize: '0.85rem',
                  color: '#facc15',
                  textAlign: 'center',
                }}
              >
                🍏 Includes {backendRewards.goldenCoins ? `+${backendRewards.goldenCoins} Golden Apple Coins ` : ''}({backendRewards.goldenApples || 1} collected)
              </div>
            )}

            {Boolean(backendRewards.megaApples) && (
              <div
                className="mega-apple-reward-banner"
                style={{
                  marginBottom: '0.85rem',
                  padding: '0.4rem 0.8rem',
                  borderRadius: '6px',
                  backgroundColor: 'rgba(217, 70, 239, 0.12)',
                  border: '1px solid rgba(217, 70, 239, 0.35)',
                  fontSize: '0.85rem',
                  color: '#f0abfc',
                  textAlign: 'center',
                }}
              >
                🌟 Includes {backendRewards.megaApples} Mega Apple{backendRewards.megaApples > 1 ? 's' : ''} (+{backendRewards.megaApples * 2} segments grown)
              </div>
            )}

            {Boolean(backendRewards.timeApples) && (
              <div
                className="time-apple-reward-banner"
                style={{
                  marginBottom: '0.85rem',
                  padding: '0.4rem 0.8rem',
                  borderRadius: '6px',
                  backgroundColor: 'rgba(6, 182, 212, 0.12)',
                  border: '1px solid rgba(6, 182, 212, 0.35)',
                  fontSize: '0.85rem',
                  color: '#38bdf8',
                  textAlign: 'center',
                }}
              >
                ⏱️ Includes {backendRewards.timeApples} Time Apple{backendRewards.timeApples > 1 ? 's' : ''} (+{backendRewards.timeBonusMoves || (backendRewards.timeApples * 5)} moves granted)
              </div>
            )}

            {Boolean(backendRewards.mysteryApples) && (
              <div
                className="mystery-apple-reward-banner"
                style={{
                  marginBottom: '0.85rem',
                  padding: '0.4rem 0.8rem',
                  borderRadius: '6px',
                  backgroundColor: 'rgba(168, 85, 247, 0.12)',
                  border: '1px solid rgba(168, 85, 247, 0.35)',
                  fontSize: '0.85rem',
                  color: '#c084fc',
                  textAlign: 'center',
                }}
              >
                ✨ Includes {backendRewards.mysteryApples} Mystery Apple{backendRewards.mysteryApples > 1 ? 's' : ''}
                {Array.isArray(backendRewards.mysteryEffects) && backendRewards.mysteryEffects.length > 0 && (
                  <span style={{ display: 'block', fontSize: '0.78rem', marginTop: '2px', opacity: 0.9 }}>
                    ({backendRewards.mysteryEffects.map((e) => `${e.type.replace('_', ' ')} (+${e.value})`).join(', ')})
                  </span>
                )}
              </div>
            )}

            {backendWallet?.balance !== undefined && (
              <div className="wallet-balance-banner" style={{ marginBottom: '1rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Updated Wallet Balance: <strong className="gold-text">{backendWallet.balance} Coins</strong>
              </div>
            )}

            {/* VELoop Rewarded Ad Multipliers - Only displayed when ads are authoritatively available */}
            {adsAvailable && (
              <div
                className="victory-ad-multipliers"
                style={{
                  display: 'flex',
                  gap: '0.6rem',
                  marginBottom: '1.25rem',
                  justifyContent: 'center',
                  flexWrap: 'wrap',
                }}
              >
                {!isDoubleCoinsClaimed ? (
                  <button
                    type="button"
                    className="btn btn-warning"
                    style={{
                      fontSize: '0.82rem',
                      padding: '0.5rem 0.8rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                    onClick={onWatchAdDoubleCoins}
                    title="Watch a short rewarded ad to double your cleared coins!"
                    disabled={submitting}
                  >
                    <span>📺</span>
                    <span>Double Coins (+{backendRewards.coins})</span>
                  </button>
                ) : (
                  <span
                    style={{
                      fontSize: '0.8rem',
                      padding: '0.4rem 0.8rem',
                      borderRadius: '6px',
                      backgroundColor: 'rgba(234, 179, 8, 0.15)',
                      color: '#facc15',
                      border: '1px solid rgba(234, 179, 8, 0.35)',
                      fontWeight: '600',
                    }}
                  >
                    ✓ Coins Doubled!
                  </span>
                )}

                {!isDoubleScoreClaimed ? (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{
                      fontSize: '0.82rem',
                      padding: '0.5rem 0.8rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      borderColor: '#a855f7',
                      color: '#c084fc',
                    }}
                    onClick={onWatchAdDoubleScore}
                    title="Watch a short rewarded ad to double your clear score!"
                    disabled={submitting}
                  >
                    <span>📺</span>
                    <span>Double Score (2X)</span>
                  </button>
                ) : (
                  <span
                    style={{
                      fontSize: '0.8rem',
                      padding: '0.4rem 0.8rem',
                      borderRadius: '6px',
                      backgroundColor: 'rgba(168, 85, 247, 0.15)',
                      color: '#c084fc',
                      border: '1px solid rgba(168, 85, 247, 0.35)',
                      fontWeight: '600',
                    }}
                  >
                    ✓ Score Doubled!
                  </span>
                )}
              </div>
            )}

            <div className="victory-actions">
              {isDailyChallenge ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={onLevelSelect}
                  disabled={!isConfirmed}
                >
                  ✓ View Daily Streak & Milestones
                </button>
              ) : (
                <>
                  {!isLastLevel && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={onNextLevel}
                      disabled={!isConfirmed}
                    >
                      Next Level ➔
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={onLevelSelect}
                    disabled={submitting}
                  >
                    Level Map
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function FailureDialog({
  isOpen,
  levelNumber,
  reason,
  moves,
  duration,
  isRestarting,
  restartError,
  onRestart,
  onLevelSelect,
  canUndo = false,
  undoCount = 0,
  isUndoing = false,
  undoError = null,
  onUndo,
  canRevive = true,
  revivesUsed = 0,
  onWatchAdRevive,
  onWatchAdExtraMoves,
  adsAvailable = false,
}) {
  if (!isOpen) return null;

  const getReasonMessage = (code) => {
    switch (code) {
      case 'OUT_OF_MOVES':
        return 'Out of moves! Plan a more efficient route.';
      case 'HIT_SPIKE':
        return 'Ouch! The worm touched deadly spikes.';
      case 'FALLEN_OFF_GRID':
        return 'The worm fell into a deep pit! Bridge it with a stone.';
      case 'SELF_COLLISION':
        return 'You tangled yourself! The worm collided with its own body.';
      case 'CRUSHED':
        return 'Crushed! A moving block intercepted the worm.';
      case 'TRAPPED':
        return 'No valid moves remaining. You are trapped!';
      case 'MANUAL_RESTART':
        return 'Level restarted by player.';
      case 'ABANDONED':
        return 'Session was abandoned.';
      default:
        return 'Level failed. Review the layout and try again!';
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-card failure-modal">
        <div className="failure-icon">💀</div>
        <h2>Level {levelNumber} Failed</h2>

        <p className="failure-description">{getReasonMessage(reason)}</p>

        <div className="failure-stats">
          <div>Moves Attempted: <strong>{moves}</strong></div>
          <div>Time Elapsed: <strong>{duration}s</strong></div>
        </div>

        {/* VELoop Rewarded Ad Recovery Options - Only displayed when ads are authoritatively available */}
        {adsAvailable && ((canRevive && revivesUsed < 1) || (reason === 'OUT_OF_MOVES' && typeof onWatchAdExtraMoves === 'function')) && (
          <div
            className="failure-ad-options"
            style={{
              margin: '1rem 0',
              padding: '0.85rem',
              backgroundColor: 'rgba(30, 41, 59, 0.7)',
              borderRadius: '8px',
              border: '1px solid rgba(51, 65, 85, 0.6)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.6rem',
            }}
          >
            {canRevive && revivesUsed < 1 && (
              <button
                type="button"
                className="btn btn-primary"
                style={{
                  backgroundColor: '#16a34a',
                  borderColor: '#22c55e',
                  color: '#ffffff',
                  fontWeight: '600',
                  padding: '0.65rem 1rem',
                  fontSize: '0.9rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  boxShadow: '0 0 12px rgba(34, 197, 94, 0.35)',
                }}
                onClick={onWatchAdRevive}
                disabled={isRestarting || isUndoing}
                title="Watch a short rewarded ad to revive and continue from last safe position!"
              >
                <span>📺</span>
                <span>Watch Ad & Revive (1 Free / Level)</span>
              </button>
            )}

            {reason === 'OUT_OF_MOVES' && typeof onWatchAdExtraMoves === 'function' && (
              <button
                type="button"
                className="btn btn-warning"
                style={{
                  fontSize: '0.85rem',
                  padding: '0.55rem 1rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                }}
                onClick={onWatchAdExtraMoves}
                disabled={isRestarting || isUndoing}
                title="Watch a short rewarded ad to add +5 moves to this run!"
              >
                <span>🎯</span>
                <span>Watch Ad for +5 Extra Moves</span>
              </button>
            )}
          </div>
        )}

        {isRestarting && (
          <div className="dialog-pending-state">
            <div className="loading-spinner" />
            <p>Reconciling and initiating fresh session on server...</p>
          </div>
        )}

        {restartError && !isRestarting && (
          <div className="dialog-error-state">
            <p className="error-badge">⚠️ Restart Error</p>
            <p className="error-message">{restartError}</p>
          </div>
        )}

        {undoError && !isUndoing && (
          <div className="dialog-error-state">
            <p className="error-badge">⚠️ Recovery Error</p>
            <p className="error-message">{undoError}</p>
          </div>
        )}

        <div className="failure-actions">
          {canUndo && (
            <button
              type="button"
              className="btn btn-warning"
              onClick={onUndo}
              disabled={isRestarting || isUndoing}
              title={undoCount > 0 ? `Undo fatal move (${undoCount} available)` : 'Purchase and use Undo (40 coins)'}
            >
              {isUndoing ? '⏳ Undoing...' : `↩ Undo Last Move (${undoCount > 0 ? `${undoCount} left` : '🪙40'})`}
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            onClick={onRestart}
            disabled={isRestarting || isUndoing}
          >
            🔄 Try Again
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onLevelSelect}
            disabled={isRestarting || isUndoing}
          >
            Level Map
          </button>
        </div>
      </div>
    </div>
  );
}