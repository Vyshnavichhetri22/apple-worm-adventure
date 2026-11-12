import { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import Navbar from './components/common/Navbar.jsx';
import AuthPage from './pages/AuthPage.jsx';
import HomePage from './pages/HomePage.jsx';
import LevelSelectionPage from './pages/LevelSelectionPage.jsx';
import { GAME_NAME } from './config/gameConfig.js';
import './App.css';

/**
 * Reusable placeholder view for milestones scheduled next in development.
 */
function PlaceholderScreen({ title, milestone, description, onBack }) {
  return (
    <div className="placeholder-wrapper">
      <div className="placeholder-card">
        <div className="placeholder-icon">🚧</div>
        <h2>{title}</h2>
        <span className="milestone-badge">{milestone}</span>
        <p>{description}</p>
        <button type="button" className="btn btn-primary" onClick={onBack}>
          ← Back to Dashboard
        </button>
      </div>
    </div>
  );
}

/**
 * Level Ready Screen - Confirms active backend game session creation.
 * Displays authoritative session ID and level specs.
 */
function LevelReadyScreen({ sessionData, onBack, onReturnHome }) {
  if (!sessionData) {
    return (
      <div className="placeholder-wrapper">
        <div className="placeholder-card">
          <h2>No Active Session</h2>
          <p>Please select a level to initiate a game session.</p>
          <button type="button" className="btn btn-primary" onClick={onBack}>
            ← Back to Levels
          </button>
        </div>
      </div>
    );
  }

  const { session, level } = sessionData;
  const levelNumber = session.levelNumber || level?.levelNumber || 1;
  const levelTitle = level?.title || `Level ${levelNumber}`;

  // Read grid from session.initialState or level definition
  const gridCols = session.initialState?.grid?.cols ?? level?.grid?.cols;
  const gridRows = session.initialState?.grid?.rows ?? level?.grid?.rows;
  const gridText =
    gridCols !== undefined && gridRows !== undefined ? `${gridCols} × ${gridRows}` : 'Not configured';

  const moveLimitText =
    level?.moveLimit !== undefined && level?.moveLimit !== null
      ? `${level.moveLimit} moves`
      : 'Not configured';

  const applesCount =
    session.initialState?.apples !== undefined
      ? session.initialState.apples.length
      : Array.isArray(level?.apples)
      ? level.apples.length
      : 'Not configured';

  return (
    <div className="level-ready-wrapper">
      <div className="level-ready-card">
        <span className="ready-badge">Session Active</span>
        <h2>{levelTitle}</h2>

        <div className="milestone-notice">
          <span className="notice-icon">🎮</span>
          <div>
            <strong>Frontend Milestone 3 Gameplay Bridge:</strong>
            <p>
              Backend game session initiated successfully. HTML5 Canvas rendering, physics simulation,
              and keyboard controls will be attached in Milestone 3.
            </p>
          </div>
        </div>

        <div className="session-spec-box">
          <h3>Authoritative Session Details</h3>
          <div className="session-details-list">
            <div>
              <span>Game Session ID:</span>
              <code>{session._id || session.id || 'N/A'}</code>
            </div>
            <div>
              <span>Status:</span>
              <strong className="status-active">{session.status || 'ACTIVE'}</strong>
            </div>
            <div>
              <span>Difficulty:</span>
              <strong>{level?.difficulty?.toUpperCase() || 'Not configured'}</strong>
            </div>
            <div>
              <span>Grid Dimensions:</span>
              <strong>{gridText}</strong>
            </div>
            <div>
              <span>Move Limit:</span>
              <strong>{moveLimitText}</strong>
            </div>
            <div>
              <span>Apples on Board:</span>
              <strong>{applesCount}</strong>
            </div>
          </div>
        </div>

        <div className="level-ready-actions">
          <button type="button" className="btn btn-primary" onClick={onBack}>
            ← Back to Level Map
          </button>
          <button type="button" className="btn btn-secondary" onClick={onReturnHome}>
            Return to Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Screen manager controlling current visible view.
 */
function GameApp() {
  const { isAuthenticated, isLoading } = useAuth();
  const [currentScreen, setCurrentScreen] = useState('HOME');
  const [activeGameSession, setActiveGameSession] = useState(null);

  // Loading Splash Screen while checking JWT session
  if (isLoading) {
    return (
      <div className="splash-screen" role="status" aria-live="polite">
        <div className="splash-card">
          <div className="splash-worm-animation">🐛</div>
          <h1 className="splash-title">{GAME_NAME}</h1>
          <p className="splash-subtitle">Connecting to VELoop Rewards...</p>
          <div className="loading-bar">
            <div className="loading-fill"></div>
          </div>
        </div>
      </div>
    );
  }

  // Unauthenticated players see the Auth Portal
  if (!isAuthenticated) {
    return <AuthPage />;
  }

  const handleStartGame = (sessionData, levelData) => {
    setActiveGameSession({ session: sessionData, level: levelData });
    setCurrentScreen('GAME_READY');
  };

  // Authenticated Screen Router
  return (
    <div className="app-shell">
      <Navbar currentScreen={currentScreen} onNavigate={setCurrentScreen} />
      <main className="main-viewport">
        {currentScreen === 'HOME' && <HomePage onNavigate={setCurrentScreen} />}

        {currentScreen === 'LEVELS' && (
          <LevelSelectionPage
            onNavigate={setCurrentScreen}
            onStartGame={handleStartGame}
          />
        )}

        {currentScreen === 'GAME_READY' && (
          <LevelReadyScreen
            sessionData={activeGameSession}
            onBack={() => setCurrentScreen('LEVELS')}
            onReturnHome={() => setCurrentScreen('HOME')}
          />
        )}

        {currentScreen === 'WALLET' && (
          <PlaceholderScreen
            title="VELoop Coin Wallet"
            milestone="Frontend Milestone 5 & 6"
            description="Authoritative append-only transaction ledger, daily free coin claims, and ad rewards."
            onBack={() => setCurrentScreen('HOME')}
          />
        )}

        {currentScreen === 'LEADERBOARD' && (
          <PlaceholderScreen
            title="Global Rankings"
            milestone="Frontend Milestone 6"
            description="Leaderboard rankings based on stars, scores, and fastest level completions."
            onBack={() => setCurrentScreen('HOME')}
          />
        )}

        {currentScreen === 'ACHIEVEMENTS' && (
          <PlaceholderScreen
            title="Player Achievements"
            milestone="Frontend Milestone 6"
            description="Badge showcase tracking apples eaten, streaks, and flawless clears."
            onBack={() => setCurrentScreen('HOME')}
          />
        )}

        {currentScreen === 'ADMIN' && (
          <PlaceholderScreen
            title="Administrator Level Editor"
            milestone="Frontend Milestone 6"
            description="Level draft authoring, obstacle layout validation, and publishing dashboard."
            onBack={() => setCurrentScreen('HOME')}
          />
        )}
      </main>
    </div>
  );
}

export function App() {
  return (
    <AuthProvider>
      <GameApp />
    </AuthProvider>
  );
}

export default App;