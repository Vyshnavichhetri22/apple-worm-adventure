import React from 'react';
import PropTypes from 'prop-types';

export function GameControls({
  onMove,
  onUndo,
  onHint,
  onBooster,
  onRestart,
  canUndo = false,
  disabled = false,
  inventory = { UNDO: 0, HINT: 0, BOOSTER: 0 },
  walletBalance = 0,
  prices = { UNDO: 40, HINT: 50, BOOSTER: 100 },
  isUndoLoading = false,
  isHintLoading = false,
  isBoosterLoading = false,
  movesRemaining = 0,
  movesLimit = 0,
  isMuted = false,
  onToggleMute = null,
  totalKeys = 0,
  collectedKeysCount = 0,
  totalApples = 0,
  collectedApplesCount = 0,
  applesEaten = 0,
}) {
  const currentApplesEaten = collectedApplesCount || applesEaten || 0;
  const undoCount = inventory.UNDO || 0;
  const hintCount = inventory.HINT || 0;
  const boosterCount = inventory.BOOSTER || 0;

  return (
    <div className="game-controls-container">
      {/* Top Status Bar: Balance, Apples, Keys, and Move Allowance */}
      <div className="controls-status-bar">
        <div className="controls-status-chip chip-wallet" title="Current Wallet Balance">
          <span className="chip-icon">🪙</span>
          <span className="chip-value">{walletBalance}</span>
          <span className="chip-unit">Coins</span>
        </div>
        {totalApples > 0 && (
          <div className="controls-status-chip chip-apples" title="Apples Collected / Total">
            <span className="chip-icon">🍎</span>
            <span className="chip-value">{currentApplesEaten}/{totalApples}</span>
            <span className="chip-unit">Apples</span>
          </div>
        )}
        {totalKeys > 0 && (
          <div className="controls-status-chip chip-keys" title="Keys Collected">
            <span className="chip-icon">🔑</span>
            <span className="chip-value">{collectedKeysCount}/{totalKeys}</span>
            <span className="chip-unit">Keys</span>
          </div>
        )}
        <div
          className={`controls-status-chip chip-moves ${
            movesRemaining <= 3 ? 'chip-danger' : movesRemaining <= 6 ? 'chip-warning' : ''
          }`}
          title="Moves remaining before out of moves"
        >
          <span className="chip-icon">🎯</span>
          <span className="chip-value">{movesRemaining}</span>
          <span className="chip-unit">/ {movesLimit} Moves</span>
        </div>
        {onToggleMute && (
          <button
            type="button"
            className="controls-status-chip chip-audio"
            onClick={onToggleMute}
            title={isMuted ? 'Sound Muted — Click to unmute' : 'Sound Active — Click to mute'}
            aria-label={isMuted ? 'Unmute Sound Effects' : 'Mute Sound Effects'}
            style={{ cursor: 'pointer', background: isMuted ? 'rgba(239, 68, 68, 0.15)' : 'rgba(34, 197, 94, 0.15)', border: 'none' }}
          >
            <span className="chip-icon">{isMuted ? '🔇' : '🔊'}</span>
            <span className="chip-unit">{isMuted ? 'Off' : 'On'}</span>
          </button>
        )}
      </div>

      {/* Action Buttons Bar */}
      <div className="game-action-bar">
        <button
          type="button"
          className="btn-game-action btn-action-undo"
          onClick={onUndo}
          disabled={disabled || isUndoLoading || !canUndo || (undoCount === 0 && walletBalance < prices.UNDO)}
          title="Undo last move (Z)"
          aria-label="Undo last move"
        >
          <div className="action-btn-main">
            <span className="action-icon">↩</span>
            <span className="action-title">{isUndoLoading ? 'Undoing...' : 'Undo'}</span>
          </div>
          <span className={`action-cost-badge ${undoCount > 0 ? 'badge-qty' : 'badge-buy'}`}>
            {undoCount > 0 ? `${undoCount} left` : `🪙 ${prices.UNDO}`}
          </span>
        </button>

        <button
          type="button"
          className="btn-game-action btn-action-hint"
          onClick={onHint}
          disabled={disabled || isHintLoading || (hintCount === 0 && walletBalance < prices.HINT)}
          title="Show optimal path hint"
          aria-label="Show hint"
        >
          <div className="action-btn-main">
            <span className="action-icon">💡</span>
            <span className="action-title">{isHintLoading ? 'Loading...' : 'Hint'}</span>
          </div>
          <span className={`action-cost-badge ${hintCount > 0 ? 'badge-qty' : 'badge-buy'}`}>
            {hintCount > 0 ? `${hintCount} left` : `🪙 ${prices.HINT}`}
          </span>
        </button>

        <button
          type="button"
          className="btn-game-action btn-action-booster"
          onClick={onBooster}
          disabled={disabled || isBoosterLoading || (boosterCount === 0 && walletBalance < prices.BOOSTER)}
          title="Add +5 extra moves"
          aria-label="Add 5 moves"
        >
          <div className="action-btn-main">
            <span className="action-icon">⚡</span>
            <span className="action-title">{isBoosterLoading ? 'Adding...' : '+5 Moves'}</span>
          </div>
          <span className={`action-cost-badge ${boosterCount > 0 ? 'badge-qty' : 'badge-buy'}`}>
            {boosterCount > 0 ? `${boosterCount} left` : `🪙 ${prices.BOOSTER}`}
          </span>
        </button>

        <button
          type="button"
          className="btn-game-action btn-action-restart"
          onClick={onRestart}
          disabled={disabled}
          title="Restart Level (R)"
          aria-label="Restart Level"
        >
          <div className="action-btn-main">
            <span className="action-icon">🔄</span>
            <span className="action-title">Restart</span>
          </div>
          <span className="action-cost-badge badge-free">Reset</span>
        </button>
      </div>

      {/* Tactile Virtual Directional Pad */}
      <div className="dpad-wrapper" role="group" aria-label="Virtual directional controls">
        <div className="dpad-row">
          <button
            type="button"
            className="dpad-btn dpad-up"
            onClick={() => onMove('UP')}
            disabled={disabled}
            aria-label="Move Up"
            title="Move Up (W / ↑)"
          >
            ▲
          </button>
        </div>
        <div className="dpad-row dpad-middle">
          <button
            type="button"
            className="dpad-btn dpad-left"
            onClick={() => onMove('LEFT')}
            disabled={disabled}
            aria-label="Move Left"
            title="Move Left (A / ←)"
          >
            ◀
          </button>
          <div className="dpad-center" aria-hidden="true">
            <span className="dpad-center-icon">🐛</span>
          </div>
          <button
            type="button"
            className="dpad-btn dpad-right"
            onClick={() => onMove('RIGHT')}
            disabled={disabled}
            aria-label="Move Right"
            title="Move Right (D / →)"
          >
            ▶
          </button>
        </div>
        <div className="dpad-row">
          <button
            type="button"
            className="dpad-btn dpad-down"
            onClick={() => onMove('DOWN')}
            disabled={disabled}
            aria-label="Move Down"
            title="Move Down (S / ↓)"
          >
            ▼
          </button>
        </div>
      </div>

      {/* Desktop Keyboard Controls Guide */}
      <div className="keyboard-shortcuts-guide" aria-label="Keyboard controls">
        <span className="kbd-item"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / <kbd>Arrows</kbd> Move</span>
        <span className="kbd-sep">•</span>
        <span className="kbd-item"><kbd>Z</kbd> Undo</span>
      </div>
    </div>
  );
}

GameControls.propTypes = {
  onMove: PropTypes.func.isRequired,
  onUndo: PropTypes.func.isRequired,
  onHint: PropTypes.func,
  onBooster: PropTypes.func,
  onRestart: PropTypes.func.isRequired,
  canUndo: PropTypes.bool,
  disabled: PropTypes.bool,
  inventory: PropTypes.shape({
    UNDO: PropTypes.number,
    HINT: PropTypes.number,
    BOOSTER: PropTypes.number,
  }),
  walletBalance: PropTypes.number,
  prices: PropTypes.shape({
    UNDO: PropTypes.number,
    HINT: PropTypes.number,
    BOOSTER: PropTypes.number,
  }),
  isUndoLoading: PropTypes.bool,
  isHintLoading: PropTypes.bool,
  isBoosterLoading: PropTypes.bool,
  movesRemaining: PropTypes.number,
  movesLimit: PropTypes.number,
  totalKeys: PropTypes.number,
  collectedKeysCount: PropTypes.number,
  totalApples: PropTypes.number,
  collectedApplesCount: PropTypes.number,
  applesEaten: PropTypes.number,
};

export default GameControls;
