/**
 * client/src/App.jsx
 * Screen routing and session orchestration root for Apple Worm Adventure.
 * 
 * - Bridges LevelSelectionPage to GamePlayPage upon level start.
 * - Sequential startup in handleNextLevel (validates level before starting session).
 * - Implements handleRestartSession returning authoritative fresh session to GamePlayPage.
 * - Intercepts Navbar navigation during active gameplay via pendingNavigation.
 * - Cleans up active session state on confirmed exit.
 * - Milestone 5: Mounts real authoritative VELoop Coin WalletPage when currentScreen === 'WALLET'.
 */

import { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { WalletProvider } from './context/WalletContext.jsx';
import Navbar from './components/common/Navbar.jsx';
import AuthPage from './pages/AuthPage.jsx';
import HomePage from './pages/HomePage.jsx';
import LevelSelectionPage from './pages/LevelSelectionPage.jsx';
import GamePlayPage from './pages/GamePlayPage.jsx';
import WalletPage from './pages/WalletPage.jsx';
import RewardCenterPage from './pages/RewardCenterPage.jsx';
import LeaderboardPage from './pages/LeaderboardPage.jsx';
import AchievementsPage from './pages/AchievementsPage.jsx';
import DailyChallengePage from './pages/DailyChallengePage.jsx';
import dailyChallengeService from './services/dailyChallengeService.js';
import levelService from './services/levelService.js';
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
function LevelReadyScreen({ sessionData, onStartGame, onBack, onReturnHome }) {
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
            <strong>Interactive Gameplay Ready:</strong>
            <p>
              Session initialized on server. Canvas simulation, physics engine, and controls are connected.
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
          <button type="button" className="btn btn-primary" onClick={onStartGame}>
            Play Level ▶
          </button>
          <button type="button" className="btn btn-secondary" onClick={onBack}>
            ← Back to Level Map
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
  const [pendingNavigation, setPendingNavigation] = useState(null);
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

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

  // Intercept navigation while in GAME to trigger safe abandonment / terminal verification
  const handleNavigate = (targetScreen) => {
    if (currentScreen === 'GAME') {
      setPendingNavigation(targetScreen);
    } else {
      setCurrentScreen(targetScreen);
    }
  };

  // Called when GamePlayPage confirms terminal exit has been recorded
  const handleConfirmExit = (destination = null) => {
    const dest = destination || (activeGameSession?.isDailyChallenge ? 'DAILY' : 'LEVELS');
    setActiveGameSession(null);
    setPendingNavigation(null);
    setCurrentScreen(dest);
  };

  // Called from LevelSelectionPage modal
  const handleStartGame = (sessionData, levelData) => {
    setActiveGameSession({ session: sessionData, level: levelData });
    setCurrentScreen('GAME');
  };

  // Initiates fresh session for same level on restart and updates parent state
  const handleRestartSession = async (levelNumber) => {
    const res = await levelService.startLevelSession(levelNumber);
    if (res && res.success && res.data) {
      setActiveGameSession(prev => ({
        ...prev,
        session: res.data
      }));
      return res.data;
    }
    throw new Error(res?.message || 'Failed to start a new game session.');
  };

  // Sequential Next-Level Transition (validates level configuration before starting session)
  const handleNextLevel = async (nextLevelNumber) => {
    if (activeGameSession?.isDailyChallenge) {
      setCurrentScreen('DAILY');
      return;
    }

    try {
      const levelRes = await levelService.getLevelByNumber(nextLevelNumber);
      if (!levelRes || !levelRes.success || !levelRes.data) {
        throw new Error('Failed to load level configuration.');
      }

      const sessionRes = await levelService.startLevelSession(nextLevelNumber);
      if (!sessionRes || !sessionRes.success || !sessionRes.data?._id) {
        throw new Error('Failed to initiate session for next level.');
      }

      setActiveGameSession({ session: sessionRes.data, level: levelRes.data });
      setPendingNavigation(null);
      setCurrentScreen('GAME');
    } catch (err) {
      console.error('Failed to transition to next level:', err);
      setCurrentScreen('LEVELS');
    }
  };

  // Dedicated Daily Challenge Launcher
  const handleStartDailyChallenge = async (date) => {
    try {
      const res = await dailyChallengeService.startDailyChallenge(date);
      if (res && res.success && res.session) {
        const levelRes = await levelService.getLevelByNumber(res.levelNumber);
        setActiveGameSession({
          session: res.session,
          level: levelRes?.data || { levelNumber: res.levelNumber, title: `Daily Challenge - Level ${res.levelNumber}` },
          isDailyChallenge: true,
          challengeDate: res.date,
        });
        setPendingNavigation(null);
        setCurrentScreen('GAME');
      }
    } catch (err) {
      console.error('Failed to start daily challenge:', err);
      alert(err.message || 'Unable to start today\'s daily challenge.');
    }
  };

  return (
    <div className="app-shell">
      <Navbar currentScreen={currentScreen} onNavigate={handleNavigate} isOnline={isOnline} />
      {!isOnline && (
        <div className="offline-banner" role="alert">
          <span className="offline-icon">📡</span>
          <div className="offline-content">
            <strong>Offline Mode:</strong> Internet connection unavailable. Static shell and local puzzle gameplay are active, but syncing rewards, streaks, and wallet balance requires an active network.
          </div>
        </div>
      )}
      <main className="main-viewport">
        {currentScreen === 'HOME' && <HomePage onNavigate={handleNavigate} />}

        {currentScreen === 'LEVELS' && (
          <LevelSelectionPage
            onNavigate={handleNavigate}
            onStartGame={handleStartGame}
          />
        )}

        {currentScreen === 'GAME_READY' && (
          <LevelReadyScreen
            sessionData={activeGameSession}
            onStartGame={() => setCurrentScreen('GAME')}
            onBack={() => setCurrentScreen('LEVELS')}
            onReturnHome={() => setCurrentScreen('HOME')}
          />
        )}

        {currentScreen === 'GAME' && activeGameSession && (
          <GamePlayPage
            sessionData={activeGameSession.session}
            levelData={activeGameSession.level}
            isDailyChallenge={Boolean(activeGameSession.isDailyChallenge || activeGameSession.session?.isDailyChallenge)}
            challengeDate={activeGameSession.challengeDate || activeGameSession.session?.challengeDate}
            pendingNavigation={pendingNavigation}
            onConfirmExit={handleConfirmExit}
            onNextLevel={handleNextLevel}
            onRestartSession={handleRestartSession}
          />
        )}

        {currentScreen === 'WALLET' && (
          <WalletPage onNavigate={handleNavigate} />
        )}

        {currentScreen === 'REWARDS' && (
          <RewardCenterPage onNavigate={handleNavigate} />
        )}

        {currentScreen === 'LEADERBOARD' && (
          <LeaderboardPage onNavigate={handleNavigate} />
        )}

        {currentScreen === 'ACHIEVEMENTS' && (
          <AchievementsPage onNavigate={handleNavigate} />
        )}

        {currentScreen === 'DAILY' && (
          <DailyChallengePage
            onNavigate={handleNavigate}
            onStartDailyChallenge={handleStartDailyChallenge}
          />
        )}

        {currentScreen === 'ADMIN' && (
          <PlaceholderScreen
            title="Administrator Level Editor"
            milestone="Frontend Milestone 6"
            description="Level draft authoring, obstacle layout validation, and publishing dashboard."
            onBack={() => handleNavigate('HOME')}
          />
        )}
      </main>
    </div>
  );
}

export function App() {
  return (
    <AuthProvider>
      <WalletProvider>
        <GameApp />
      </WalletProvider>
    </AuthProvider>
  );
}

export default App;