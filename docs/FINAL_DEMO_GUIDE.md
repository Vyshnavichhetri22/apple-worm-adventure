# Apple Worm Adventure — Final Evaluator Demo Presentation Guide

> A structured, step-by-step walkthrough designed for presenting Apple Worm Adventure to an evaluator.
> This guide covers all core game mechanics, transactional economy, rewarded ads, social/retention features, mobile touch, and PWA capabilities in ~10 minutes.

---

## Pre-Demo Quick Setup

1. **Start the Backend Server**:
   ```bash
   cd server
   npm run dev
   # Verify: http://localhost:5000/api/health returns { "status": "healthy" }
   ```
2. **Start the Frontend Client**:
   ```bash
   cd client
   npm run dev
   # Open browser at: http://localhost:5173
   ```
3. **Login or Register**:
   - Register a fresh player account (e.g., `evaluator_demo` / `password123`) or log in with an existing account.
   - Notice the initial **100 VELoop Coins** granted upon registration.

---

## 19-Step Ordered Demonstration Flow

---

### Step 1: Home Screen & Project Overview
- **What to open**: Browser at `http://localhost:5173` (Home view).
- **Action**: Show the hero banner, game title, live coin badge (`🪙 100`), quick action cards, and responsive navigation header.
- **Visually seen**: Modern dark-themed dashboard, animated worm mascot, live online status badge (`🟢 Online`), and game mode buttons.
- **Rubric / Category**: Full-Stack Architecture, UI/UX Polish & Branding.

---

### Step 2: Level Selection & Progression Map
- **What to open**: Click **"🗺️ Levels"** in the navigation bar.
- **Action**: Scroll through the 50-level grid; inspect unlocked vs locked levels and star badges.
- **Visually seen**: Level cards displaying level number, title, difficulty badge (`Easy`, `Medium`, `Hard`), and star rating ($0\text{--}3$ stars). Locked levels are clearly disabled.
- **Rubric / Category**: Progression System, Database Seeding & Level Configuration.

---

### Step 3: Start & Play a Level
- **What to open**: Click on **Level 1** (`First Bite`) and click **"Play Level ▶"**.
- **Action**: Launch the level into active gameplay.
- **Visually seen**: Smooth screen transition into `GamePlayPage`. The top HUD displays remaining moves (`20 / 20`), live score, current stars, and collected keys. The HTML5 canvas renders the checkered puzzle board with worm, apple, and swirling blue exit portal.
- **Rubric / Category**: Game Session Initialization & Authoritative Server Lifecycle.

---

### Step 4: Worm Movement & Gameplay Controls
- **What to open**: In active Level 1 gameplay.
- **Action**: Use keyboard arrows or `W`, `A`, `S`, `D` keys (or click the virtual D-pad buttons: `▲`, `◀`, `▼`, `▶`).
- **Visually seen**: Worm slithers smoothly across the tiles. Worm eyes turn dynamically toward the direction of travel. Sound effects play on each movement step.
- **Rubric / Category**: Game Engine, Input Handling & Audio FX.

---

### Step 5: Apples & Worm Growth
- **What to open**: In Level 1.
- **Action**: Move the worm head into the red apple.
- **Visually seen**:
  - The apple is consumed with an organic crunch audio sound.
  - An animated burst of red particles explodes outwards.
  - Floating `+100 🍎` text floats up and fades out.
  - The worm immediately grows by 1 segment, trailing realistically behind the head.
- **Rubric / Category**: Core Gameplay Mechanics & Procedural Canvas Rendering.

---

### Step 6: Special Apples (Golden, Mega, Time, Mystery)
- **What to open**: Navigate to a level featuring special apples (or inspect visual representations).
- **Action**: Observe or eat special apple variants:
  - **Golden Apple**: Shimmering golden glow with sparkling stars; awards `+50 ⭐ & 10 🪙`.
  - **Mega Apple**: Pulsing magenta aura with "+2" badge; immediately grows worm by **2 segments**.
  - **Time Apple**: Cyan glow with a clock glyph; immediately adds **+5 moves** to the move counter with floating `+5 Moves ⏱️`.
  - **Mystery Apple**: Purple pulsing aura with "?" glyph; triggers a random positive perk with live feedback.
- **Visually seen**: Unique gradients, animated glowing rings, and distinct particle colors for each collectible type.
- **Rubric / Category**: Visual Design, Collectible Diversity & Mechanical Depth.

---

### Step 7: Keys, Gates & Obstacles
- **What to open**: Level with a locked security gate (e.g. Level 2 or 3).
- **Action**:
  1. Try slithering into the red locked gate (`🔒`) before collecting the key $\rightarrow$ movement is blocked by server validation.
  2. Move worm into the floating golden key (`🔑`) $\rightarrow$ key is collected with a chime, floating text `🔑 Key Found! Gate Unlocked` appears, and the gate changes into an open neon green archway (`🔓`).
  3. Slither freely through the opened archway.
- **Visually seen**: Dynamic visual state transition of obstacle tiles and HUD key counter updating (`1/1 Keys`).
- **Rubric / Category**: Puzzle Logic, Obstacle Traversal & Anti-Cheat Validation.

---

### Step 8: Pit Hazards & Boulder (Stone) Bridging
- **What to open**: Level containing a pit abyss and a pushable stone boulder.
- **Action**:
  1. Push the circular stone boulder forward into the perilous abyss pit (`🕳️`).
  2. The pit tile converts into a solid, textured cobblestone bridge.
  3. Slither the worm directly across the bridged pit to reach the other side.
- **Visually seen**: Heavy stone sliding animation, bridging particle burst, floating feedback `🪨 Pit Bridged with Stone!`, and safe traversal.
- **Rubric / Category**: Physical Puzzle Interactions & Spatial Mechanics.

---

### Step 9: Level Completion & Stars Calculation
- **What to open**: Move the worm head directly into the exit portal tile.
- **Action**: Reach the portal within the move limit.
- **Visually seen**:
  - Portal vortex begins spinning at high velocity.
  - Worm segments smoothly spiral and shrink into the vortex center (victory suction animation).
  - Colorful confetti particle explosion.
  - Victory modal pops up: displays `Level Complete!`, earned stars ($3/3$), score breakdown, coins awarded (`+25` level clear, `+50` first-clear bonus), and buttons to proceed to the next level.
- **Rubric / Category**: Objective Completion, Anti-Cheat Verification & Star Rating Engine.

---

### Step 10: Coins & Authoritative Wallet
- **What to open**: Click **"💰 Wallet"** in the top navigation.
- **Action**: Review the wallet dashboard.
- **Visually seen**:
  - Authoritative balance card displaying updated coins (e.g., `175 Coins`).
  - Total earned and total spent statistics.
  - Real-time double-entry transaction ledger table with timestamp, transaction type (`CREDIT`), source (`LEVEL_REWARD`), amount (`+75`), and before/after balances.
- **Rubric / Category**: Idempotent Transactional Economy & Concurrency Safety.

---

### Step 11: In-Game Consumables (Undo, Hint, Booster)
- **What to open**: Return to an active level.
- **Action**:
  1. Make 2 moves, then click the **"Undo"** button $\rightarrow$ worm rewinds 1 step cleanly.
  2. Click the **"Hint"** button $\rightarrow$ optimal BFS pathfinding hint calculates and renders the next step.
  3. Click **"+5 Moves"** booster button $\rightarrow$ move limit expands immediately by 5 moves.
  4. Point out the dynamic pricing chips: if the player has 0 stock in inventory, the button automatically purchases from wallet balance at server-configured coin rates (`40`, `50`, `100` coins).
- **Visually seen**: Immediate gameplay state modification, balance updates, and inventory synchronization without leaving the board.
- **Rubric / Category**: Economy Integration, Player Agency & Consumable Inventory.

---

### Step 12: Rewarded Ads & Reward Center
- **What to open**: Click **"🎁 Rewards"** in the navigation bar.
- **Action**:
  1. View available ad opportunities: **Free Daily Coins** (`+25 Coins`), **Second Chance Revive**, **2X Level Coins**, and **2X Level Score**.
  2. Click **"Watch Ad (+25 Coins)"**.
  3. In the simulated player modal, watch the 4-second anti-skip countdown timer.
  4. When complete, click **"Claim Reward"**.
- **Visually seen**: Animated celebration modal, coin balance increases by 25, and a new transaction is recorded with source `AD_REWARD`.
- **Rubric / Category**: Rewarded Ad Economy, SSV Simulation & Anti-Skip Enforcement.

---

### Step 13: Global Leaderboards
- **What to open**: Click **"🏆 Rankings"** in the navigation bar.
- **Action**: Review the global leaderboard rankings table.
- **Visually seen**:
  - Top players ranked by total stars, total score, and levels completed with podium badges (🥇 1st, 🥈 2nd, 🥉 3rd).
  - Highlighted **"My Ranking"** banner at the top displaying the evaluator's own authenticated rank and performance stats.
- **Rubric / Category**: Social Systems, Aggregation Pipelines & Leaderboard Mechanics.

---

### Step 14: Achievements & Atomic Reward Claims
- **What to open**: Click **"🎖️ Badges"** in the navigation bar.
- **Action**:
  1. Review the 10 badges: `First Slither`, `Apple Glutton`, `Portal Master`, `Star Collector`, `Boulder Pusher`, `Gatekeeper`, `Undo Master`, `Streak Starter`, `Streak Champion`, and `Coin Tycoon`.
  2. Point out real-time progress bars ($1/1$, $5/10$, etc.).
  3. On an unlocked badge, click **"Claim 🪙 25"** $\rightarrow$ coins credit instantly to the wallet, button updates to `✓ Claimed`.
- **Visually seen**: Smooth claim animation, coin badge increment, and permanent idempotency protection preventing re-claims.
- **Rubric / Category**: Gamification, Retention Drivers & Atomic Ledger Claims.

---

### Step 15: Daily Challenge Puzzle
- **What to open**: Click **"📅 Daily"** in the navigation bar.
- **Action**:
  1. Inspect today's puzzle card showing today's date (UTC), challenge title, preview, and completion reward (`100 Coins`).
  2. Click **"Play Daily Challenge ▶"**.
  3. Clear the daily puzzle.
- **Visually seen**: Distinct Daily Challenge banner inside the game view, dedicated validation, and special victory screen rewarding daily completion coins.
- **Rubric / Category**: Daily Content, Deterministic Date-Hashing & Retention Mechanics.

---

### Step 16: Daily Streak & Milestone Rewards
- **What to open**: Return to the **"📅 Daily"** page after completing today's puzzle.
- **Action**:
  1. Observe the **Current Streak** counter incremented to `1 Day` (or higher).
  2. Review the **Streak Milestones** grid: **3 Days** (+100 coins), **7 Days** (+250 coins), **14 Days** (+600 coins), and **30 Days** (+1500 coins).
  3. Point out that milestones unlock automatically as streaks grow and allow one-click coin claims.
- **Visually seen**: Flame streak icon (`🔥`), streak calendar feedback, and progress indicators toward the next tier.
- **Rubric / Category**: Habit Formation, Long-Term Player Retention & Tiered Milestones.

---

### Step 17: Mobile Touch Controls & Responsiveness
- **What to open**: Open Chrome DevTools (`F12`), toggle **Device Toolbar** (`Ctrl+Shift+M`), and select **iPhone SE (375px)** or **Galaxy Fold (320px)**.
- **Action**:
  1. Start a level.
  2. Swipe on the canvas with your mouse/touch simulation $\rightarrow$ worm turns and moves reliably in the swipe direction.
  3. Notice that the page does not accidentally scroll or bounce.
  4. Test the touch D-pad buttons ($\ge 44$px targets).
  5. Check modal dialogs and the navbar: zero horizontal overflow, clean scrolling navigation.
- **Visually seen**: Fully responsive layout adapting down to 320px width without overlapping buttons or clipped text.
- **Rubric / Category**: Mobile UX, Touch Gestures & Responsive Engineering.

---

### Step 18: PWA Installation & Offline Behavior
- **What to open**: DevTools $\rightarrow$ **Application** tab $\rightarrow$ **Service Workers** & **Manifest**.
- **Action**:
  1. Show registered `sw.js` and valid `manifest.webmanifest` (icons 192px, 512px, maskable, `#0f172a` theme).
  2. In DevTools $\rightarrow$ **Network** tab, toggle **Offline** mode.
  3. Refresh the page $\rightarrow$ application shell loads instantly from cache.
  4. Observe the sticky top banner: `📡 Offline Mode: Internet connection unavailable...` and the red status dot (`🔴 Offline`) in the navbar.
  5. Re-enable network $\rightarrow$ banner disappears, status flips back to `🟢 Online`.
- **Visually seen**: Seamless offline shell resilience and immediate connectivity state detection.
- **Rubric / Category**: Progressive Web App (PWA) Standards & Offline Graceful Degradation.

---

### Step 19: Backend Evidence & Test Suite
- **What to open**: Terminal.
- **Action**: Run the automated test suites:
  ```bash
  cd server
  node --test test/daily_challenge_streak.test.js
  node --test test/leaderboard_achievements.test.js
  node --test test/rewarded_ad_economy.test.js
  node --test test/gameplay_mechanics_validation.test.js
  ```
- **Visually seen**: All 60 unit and integration tests passing in under 3 seconds with zero failures.
- **Rubric / Category**: Automated Testing, Code Quality & Engineering Rigor.

---

## Summary Checklist for Evaluator

| Category | Demonstrated Highlights |
| :--- | :--- |
| **Gameplay** | Turn-based grid movement, worm growth, 5 apple types, keys/gates, boulders, pits, portals |
| **Engineering** | Server-authoritative physics, FIFO checkpoints, reachability validation, 0 client-side cheating |
| **Economy** | Idempotent double-entry wallet, optimistic concurrency locking, item shop, transaction history |
| **Ads & Retention** | 4-second anti-skip rewarded ads, SSV verification, daily challenge, streak milestones, 10 badges |
| **Social** | Global leaderboard with rankings, star summaries, and authenticated player positioning |
| **Mobile & PWA** | Canvas swipe gestures, $\ge 44$px touch targets, 320px responsiveness, Service Worker offline cache |
