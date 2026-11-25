# Apple Worm Adventure (VELoop Rewards Edition)

> A production-grade, full-stack puzzle platformer featuring server-authoritative physics, anti-cheat validation, an idempotent transactional coin economy, daily challenges, global rankings, achievements, rewarded ads, mobile touch gestures, and offline Progressive Web App (PWA) capabilities.

---

## 1. Project Overview

**Apple Worm Adventure** is an interactive, browser-based grid puzzle game inspired by classic turn-based worm mechanics. Players navigate a segmented worm across floating puzzle grids, eating apples to grow, pushing heavy boulders to bridge perilous pits, finding keys to unlock security gates, and slithering into swirling dimensional exit portals within strict move allowances.

Integrated into the **VELoop Rewards** ecosystem, every level clear, achievement milestone, daily challenge, and rewarded ad view awards server-authoritative **VELoop Coins**. Coins can be spent inside the game to purchase strategic consumable abilities: **Undo**, **Path Hints**, and **+5 Extra Moves Boosters**.

---

## 2. Key Features

- **🎮 Grid Puzzle Mechanics**: Turn-based movement, worm segment physics, gravity drops, obstacle collisions, and portal vortex transitions.
- **🍎 Special Apple Types**:
  - `Normal Apple` (+100 score, +1 segment growth)
  - `Golden Apple` (+50 bonus score, +10 bonus coins)
  - `Mega Apple` (+2 segment growth, +200 score)
  - `Time Apple` (+5 moves added immediately)
  - `Mystery Apple` (random positive bonus with real-time HUD notification)
- **🧱 Hazards, Obstacles & Puzzles**:
  - `Stone Boulders`: Pushable rocks that can be slid across flat ground.
  - `Pits`: Perilous abysses that destroy the worm unless bridged by pushing a stone boulder into them.
  - `Spikes`: Hazardous perimeter traps causing instant level failure.
  - `Keys & Gates`: Security gates locked until the player collects the matching golden key.
  - `Patrolling Moving Blocks`: Oscillating mechanical hazards that require timed movement.
- **🛡️ Server-Authoritative Anti-Cheat**: Move verification, head-to-portal reachability validation, key collection verification, and FIFO state checkpoint tracking preventing client-side score or coin fabrication.
- **💰 VELoop Coin Economy**: Real double-entry transactional wallet with optimistic concurrency control, replay protection, and transactional rollback.
- **🎒 In-Game Shop & Inventory**: Purchase and consume Undo, Hint, and Booster items.
- **📺 Rewarded Ad Integration**: Placements for Game-Over Revive, Post-Win Double Coins, Post-Win Double Score, Out-of-Moves Extra Moves, Free Daily Coins, and Session Boosters with Server-Side Verification (SSV) simulation and anti-skip timers.
- **🏆 Global Leaderboards**: Server-backed player rankings sorted by stars and score with tie-breaking and authenticated player rank tracking.
- **🎖️ 10 Badges & Achievements**: Server-tracked milestones (First Slither, Apple Glutton, Boulder Pusher, Gatekeeper, Streak Master, etc.) with one-click atomic coin reward claims.
- **📅 Daily Challenge & Streak System**: Deterministic daily puzzle generated consistently across all players worldwide with UTC reset, continuous daily streaks, and tiered milestone rewards (3, 7, 14, 30 days).
- **📱 Mobile Responsive & PWA**: Touch swipe controls on canvas, tactile virtual D-pad, adaptive layout down to 320px viewports, Web App Manifest, maskable app icons, and offline Service Worker caching.

---

## 3. Technology Stack

### Backend
- **Runtime**: Node.js (v18+ / v20+ / v24+) ES Modules
- **Framework**: Express.js 5
- **Database**: MongoDB with Mongoose ODM (v9)
- **Security & Validation**: Helmet, CORS, Express Rate Limit (tiered), JSON Web Tokens (JWT), BCrypt.js
- **Testing**: Native Node.js Test Runner (`node --test`)

### Frontend
- **Framework**: React 19 with Vite 8
- **State Management**: React Context (`AuthContext`, `WalletContext`) & custom hooks
- **Renderer**: High-performance HTML5 Canvas with Retina DPI scaling, procedural particle bursts, and floating feedback text
- **Styling**: Vanilla CSS3 with responsive design (Flexbox, CSS Grid, media queries down to 320px)
- **PWA**: Service Worker API, Cache Storage API, Web App Manifest

---

## 4. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                       Browser / PWA                         │
│  React 19 Frontend + HTML5 Canvas + Service Worker Cache   │
│  (AuthContext, WalletContext, GameCanvas, Touch Gestures)   │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTPS / JSON REST API
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                      Express.js Server                      │
│  - Tiered Rate Limiters (50 req/15m Auth, 3000 req/15m API) │
│  - Helmet Security Headers & CORS Enforcement               │
│  - JWT Bearer Authentication Middleware                     │
└───────┬──────────────┬──────────────┬──────────────┬────────┘
        │              │              │              │
        ▼              ▼              ▼              ▼
┌──────────────┐┌──────────────┐┌──────────────┐┌──────────────┐
│ Game Session ││ Wallet Engine││ Daily Streak ││ Leaderboard  │
│  Controller  ││  Controller  ││  Controller  ││ & Achievement│
└───────┬──────┘└──────┬───────┘└──────┬───────┘└──────┬───────┘
        │              │              │              │
        ▼              ▼              ▼              ▼
┌─────────────────────────────────────────────────────────────┐
│                 MongoDB Data Tier (Mongoose)                │
│  User | Wallet | WalletTransaction | GameSession | Level    │
│  Inventory | DailyChallengeCompletion | PlayerDailyStreak    │
│  PlayerAchievement | PlayerProgress | AdOpportunity         │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. Directory Structure

```
APPLE WORM ADVENTURE/
├── client/                      # Frontend Single Page Application
│   ├── public/                  # Static assets, PWA icons, manifest
│   │   ├── favicon.svg          # High-resolution vector favicon
│   │   ├── icons/               # 192px, 512px, and maskable PWA icons
│   │   ├── manifest.webmanifest # PWA Web App Manifest
│   │   ├── manifest.json        # Manifest compatibility copy
│   │   └── sw.js                # Offline Service Worker (Cache static shell, network-only API)
│   ├── src/
│   │   ├── components/          # Reusable UI & Game components
│   │   │   ├── common/          # Navbar, Footer
│   │   │   └── game/            # GameCanvas, GameControls, GameDialogs, RewardedAdModal
│   │   ├── context/             # AuthContext, WalletContext
│   │   ├── pages/               # Views: Home, Levels, GamePlay, Wallet, Leaderboard, etc.
│   │   ├── services/            # Axios/Fetch API wrappers (auth, level, wallet, ads, streak)
│   │   ├── utils/               # Audio manager, mystery apple helpers
│   │   ├── App.jsx              # Main routing & offline banner coordinator
│   │   ├── App.css              # Universal responsive design stylesheet
│   │   └── main.jsx             # React DOM root & Service Worker registration
│   ├── index.html               # Viewport meta tags, theme colors, manifest link
│   ├── package.json             # Client dependencies & Vite build scripts
│   └── vite.config.js           # Vite dev server and proxy configuration
│
├── server/                      # Backend REST API Server
│   ├── scripts/                 # Migration scripts (wallet baseline, idempotency index)
│   ├── seed-levels.js           # Authoritative 50-level seed data script
│   ├── src/
│   │   ├── config/              # MongoDB connection & environment configuration
│   │   ├── controllers/         # Request handlers for auth, games, wallet, ads, daily, etc.
│   │   ├── middleware/          # JWT auth protect, admin guards, rate limiters
│   │   ├── models/              # Mongoose database models
│   │   ├── routes/              # Express route declarations
│   │   ├── services/            # Business logic: anti-cheat, wallet transactions, recovery
│   │   ├── utils/               # Helpers, token generators, index migrators
│   │   ├── app.js               # Express application initialization & middleware pipeline
│   │   └── server.js            # HTTP listener, DNS resolvers & graceful shutdown handler
│   ├── test/                    # Unit & regression test suites (Node.js test runner)
│   └── package.json             # Server dependencies & operational scripts
│
├── docs/                        # Architecture, API & operational runbooks
│   ├── ARCHITECTURE.md          # Full system architecture documentation
│   ├── API.md                   # Complete REST API reference
│   ├── FINAL_DEMO_GUIDE.md      # 19-step evaluator presentation guide
│   ├── FINAL_PROJECT_CHECKLIST.md # Rubric and features evaluation checklist
│   ├── PROJECT_COMPLETION_REPORT.md # Comprehensive internship completion report
│   └── PRODUCTION_MIGRATION_RUNBOOK.md # Production deployment runbook
├── .env.example                 # Root environment template
├── .gitignore                   # Version control ignore rules
└── README.md                    # Project documentation (this file)
```

---

## 6. Installation & Local Development Setup

### Prerequisites
- **Node.js**: v18.0.0 or higher (v20+ recommended)
- **MongoDB**: Local MongoDB Community instance running on `mongodb://127.0.0.1:27017` or MongoDB Atlas cluster URI
- **Git**: For version control

### 1. Clone & Install Dependencies

```bash
# Clone the repository
git clone <repository-url>
cd "APPLE WORM ADVENTURE"

# Install backend dependencies
cd server
npm install

# Install frontend dependencies
cd ../client
npm install
```

### 2. Configure Environment Variables

Create `.env` inside `server/` using `.env.example` as a template:

```env
PORT=5000
NODE_ENV=development
MONGODB_URI=mongodb://127.0.0.1:27017/apple_worm_dev
JWT_SECRET=super_secure_jwt_secret_key_change_me_in_production_min_32_chars
CLIENT_URL=http://localhost:5173
GAME_NAME=Apple Worm Adventure
```

Create `.env` inside `client/`:

```env
VITE_API_URL=http://localhost:5000/api
VITE_GAME_NAME="Apple Worm Adventure"
```

### 3. Seed Database Levels (Initial Setup)

To seed the initial 50 authoritative game levels into your local database:

```bash
cd server
node seed-levels.js
```

### 4. Run the Application

In terminal 1 (start backend server):
```bash
cd server
npm run dev
# Server starts on http://localhost:5000
```

In terminal 2 (start frontend development client):
```bash
cd client
npm run dev
# Frontend starts on http://localhost:5173
```

Open `http://localhost:5173` in your browser.

---

## 7. API Overview

All protected endpoints require the HTTP header:
`Authorization: Bearer <jwt_token>`

| Group | Method | Endpoint | Protection | Description |
| :--- | :--- | :--- | :--- | :--- |
| **Auth** | `POST` | `/api/auth/register` | Public | Register new player with initial baseline wallet (100 coins) |
| **Auth** | `POST` | `/api/auth/login` | Public | Authenticate player and receive JWT token |
| **Auth** | `GET` | `/api/auth/me` | Protected | Get authenticated player profile and live coin balance |
| **Levels** | `GET` | `/api/levels` | Public | Get list of all published levels and grid metadata |
| **Levels** | `GET` | `/api/levels/:levelNumber` | Public | Get level configuration (grid, apples, obstacles, portal) |
| **Games** | `POST` | `/api/games/start` | Protected | Start an authoritative game session |
| **Games** | `POST` | `/api/games/checkpoint` | Protected | Submit move checkpoint for anti-cheat verification |
| **Games** | `POST` | `/api/games/complete` | Protected | Verify portal reachability and award coins/stars |
| **Games** | `POST` | `/api/games/fail` | Protected | Mark session failed (hazard hit or moves exhausted) |
| **Games** | `POST` | `/api/games/abandon` | Protected | Abandon active game session |
| **Games** | `POST` | `/api/games/undo` | Protected | Execute server-side undo using inventory or coins |
| **Games** | `POST` | `/api/games/hint` | Protected | Request BFS pathfinding hint using inventory or coins |
| **Games** | `POST` | `/api/games/booster` | Protected | Add +5 extra moves using inventory or coins |
| **Wallet** | `GET` | `/api/wallet` | Protected | Get wallet balance and lifetime stats |
| **Wallet** | `GET` | `/api/wallet/transactions` | Protected | Get paginated transactional ledger history |
| **Wallet** | `POST` | `/api/wallet/purchase` | Protected | Purchase consumable items (`UNDO`, `HINT`, `BOOSTER`) |
| **Inventory**| `GET` | `/api/inventory` | Protected | Get player's consumable inventory quantities |
| **Inventory**| `POST` | `/api/inventory/consume` | Protected | Consume 1 inventory item with client idempotency |
| **Ads** | `GET` | `/api/ads/opportunities` | Protected | Get placement availability, cooldowns, and quotas |
| **Ads** | `POST` | `/api/ads/opportunity` | Protected | Reserve ad quota for Revive, 2X Coins, etc. |
| **Ads** | `POST` | `/api/ads/simulate-watch` | Protected | Complete simulated ad watch and grant reward |
| **Rankings**| `GET` | `/api/leaderboard` | Optional Auth | Top player rankings and authenticated player rank |
| **Badges** | `GET` | `/api/achievements` | Protected | Retrieve 10 achievements with progress tracking |
| **Badges** | `POST` | `/api/achievements/:id/claim`| Protected | Claim atomic coin reward for unlocked achievement |
| **Daily** | `GET` | `/api/daily-challenge/today` | Optional Auth | Today's daily challenge puzzle and streak overview |
| **Daily** | `POST` | `/api/daily-challenge/start` | Protected | Start daily challenge game session |
| **Daily** | `POST` | `/api/daily-challenge/complete`| Protected | Verify completion and increment daily streak |
| **Daily** | `POST` | `/api/daily-challenge/claim-milestone/:days`| Protected | Claim 3, 7, 14, or 30-day streak milestone reward |

*For complete request/response schemas, error codes, and query parameters, see [docs/API.md](file:///C:/Users/dell/OneDrive/Documents/VELoop%20Rewards/APPLE%20WORM%20ADVENTURE/docs/API.md).*

---

## 8. Economy & Transactional Safety

The VELoop Coin economy uses a strict **double-entry ledger**:
- Every balance mutation generates a permanent document in `WalletTransaction` with `balanceBefore` and `balanceAfter`.
- **Concurrency Protection**: Mongoose optimistic concurrency locking via document versions (`version` field) prevents lost updates from concurrent clicks.
- **Idempotency Protection**: Client-provided or system-generated unique `idempotencyKey` prevents double charging or duplicate reward claims.
- **Transactional Recovery Worker**: A background recovery scheduler continuously scans for orphaned `PENDING` transactions and rolls back failed operations.

---

## 9. Mobile Responsiveness & PWA Capabilities

- **Fluid Grid Scaling**: HTML5 canvas scales automatically to fit any device viewport from 320px smartphones to 4K displays.
- **Canvas Swipe Gestures**: Touch gesture engine with cardinal direction detection (`UP`, `DOWN`, `LEFT`, `RIGHT`) and `touch-action: none` to stop accidental page scrolling.
- **Touch-Friendly UI**: Minimum $44\text{--}48$px virtual D-pad buttons and action chips conforming to mobile accessibility standards.
- **Progressive Web App**:
  - Offline Service Worker (`sw.js`) caches the application shell, icons, and static assets.
  - Web App Manifest supports full-screen standalone installation on Android, iOS, Windows, and macOS.
  - **Offline Safety**: All `/api/*` endpoints strictly bypass the cache (network-only) so coins and progression cannot be forged offline.
  - **Live Connectivity Banner**: Warns the player when internet connection is lost.

---

## 10. Testing Instructions

All backend functionality is verified using the native Node.js test runner against an isolated local database:

```bash
cd server

# 1. Run Daily Challenge & Streak tests (16 tests)
node --test test/daily_challenge_streak.test.js

# 2. Run Global Leaderboards & Achievements tests (18 tests)
node --test test/leaderboard_achievements.test.js

# 3. Run Rewarded Ad Economy tests (11 tests)
node --test test/rewarded_ad_economy.test.js

# 4. Run Gameplay Mechanics & Anti-Cheat tests (15 tests)
node --test test/gameplay_mechanics_validation.test.js

# 5. Run Client Production Build
cd ../client
npm run build
```

---

## 11. Troubleshooting

| Issue | Cause | Solution |
| :--- | :--- | :--- |
| `MongoDB connection failed` | Local MongoDB daemon not running | Ensure `mongod` is started or update `MONGODB_URI` in `server/.env`. |
| `SRV query error` on Atlas | DNS resolver issue on Windows | `server.js` automatically uses Google (`8.8.8.8`) and Cloudflare (`1.1.1.1`) DNS servers. |
| `Canvas controls scrolling page` | Missing touch-action rule | Ensure `touch-action: none;` is applied on `.game-canvas-wrapper` (included in `App.css`). |
| `401 Unauthorized` in API | Missing or expired JWT token | Log in via `/login` to obtain a fresh Bearer token. |
| `Idempotency conflict on purchase` | Re-used transaction key | Ensure each purchase sends a unique `idempotencyKey` (handled automatically by client). |

---

## 12. Documentation Index

- 📘 [Full Architecture Guide](docs/ARCHITECTURE.md)
- 🔌 [Complete REST API Reference](docs/API.md)
- 🎬 [Evaluator Demo Presentation Guide](docs/FINAL_DEMO_GUIDE.md)
- ✅ [Final Project Evaluation Checklist](docs/FINAL_PROJECT_CHECKLIST.md)
- 📄 [Internship Project Completion Report](docs/PROJECT_COMPLETION_REPORT.md)
- 🚀 [Production Migration Runbook](docs/PRODUCTION_MIGRATION_RUNBOOK.md)