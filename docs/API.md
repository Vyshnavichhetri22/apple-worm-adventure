# Apple Worm Adventure — Complete REST API Reference

> Authoritative reference for all HTTP REST API endpoints implemented in Apple Worm Adventure.
> Base URL: `http://localhost:5000` (or configured environment URL).

---

## 1. Authentication & Security Conventions

- **Headers**:
  - `Content-Type: application/json` (required for POST/PUT requests).
  - `Authorization: Bearer <JWT_TOKEN>` (required for all protected endpoints).
- **Rate Limits**:
  - `/api/auth/*`: Max 50 requests per 15 minutes per IP.
  - `/api/*`: Max 3000 requests per 15 minutes per IP.
- **Standard Response Shape**:
  ```json
  {
    "success": true,
    "message": "Optional status message",
    "data": { ... }
  }
  ```
- **Standard Error Response Shape**:
  ```json
  {
    "success": false,
    "message": "Human readable error description",
    "error": "OPTIONAL_ERROR_CODE"
  }
  ```

---

## 2. Base & Health Endpoints

### 2.1 Get API Information
- **Endpoint**: `GET /`
- **Auth**: Public
- **Response** `200 OK`:
  ```json
  {
    "name": "Apple Worm Adventure",
    "status": "online",
    "message": "Welcome to the Apple Worm Adventure API"
  }
  ```

### 2.2 Health Check
- **Endpoint**: `GET /api/health`
- **Auth**: Public
- **Response** `200 OK`:
  ```json
  {
    "status": "healthy",
    "timestamp": "2026-11-24T08:15:00.000Z"
  }
  ```

---

## 3. Authentication (`/api/auth`)

### 3.1 Register Player
- **Endpoint**: `POST /api/auth/register`
- **Auth**: Public
- **Request Body**:
  ```json
  {
    "username": "speedy_worm",
    "email": "worm@example.com",
    "password": "Password123!"
  }
  ```
- **Response** `201 Created`:
  ```json
  {
    "success": true,
    "message": "User registered successfully",
    "token": "eyJhbGciOi...",
    "user": {
      "id": "674123...",
      "username": "speedy_worm",
      "email": "worm@example.com",
      "role": "player",
      "coins": 100
    }
  }
  ```
- **Errors**: `400 Bad Request` (Validation failure or duplicate email/username).

### 3.2 Login Player
- **Endpoint**: `POST /api/auth/login`
- **Auth**: Public
- **Request Body**:
  ```json
  {
    "email": "worm@example.com",
    "password": "Password123!"
  }
  ```
- **Response** `200 OK`:
  ```json
  {
    "success": true,
    "token": "eyJhbGciOi...",
    "user": {
      "id": "674123...",
      "username": "speedy_worm",
      "email": "worm@example.com",
      "role": "player",
      "coins": 100
    }
  }
  ```
- **Errors**: `401 Unauthorized` (Invalid credentials).

### 3.3 Get Current Player Profile
- **Endpoint**: `GET /api/auth/me`
- **Auth**: Protected (`Bearer <token>`)
- **Response** `200 OK`:
  ```json
  {
    "success": true,
    "user": {
      "id": "674123...",
      "username": "speedy_worm",
      "email": "worm@example.com",
      "role": "player",
      "coins": 175
    }
  }
  ```

---

## 4. Levels (`/api/levels`)

### 4.1 Get Published Levels List
- **Endpoint**: `GET /api/levels`
- **Auth**: Public
- **Response** `200 OK`:
  ```json
  {
    "success": true,
    "count": 50,
    "data": [
      {
        "levelNumber": 1,
        "title": "First Bite",
        "difficulty": "easy",
        "grid": { "rows": 8, "cols": 10 },
        "moveLimit": 20,
        "apples": [{ "x": 5, "y": 2, "type": "normal" }],
        "portal": { "x": 8, "y": 2 }
      }
    ]
  }
  ```

### 4.2 Get Level Details by Number
- **Endpoint**: `GET /api/levels/:levelNumber`
- **Auth**: Public
- **Response** `200 OK`: Full level configuration including obstacles, stones, keys, and special apples.
- **Errors**: `404 Not Found` if level does not exist or is unpublished.

---

## 5. Game Sessions (`/api/games`)

### 5.1 Start Game Session
- **Endpoint**: `POST /api/games/start`
- **Auth**: Protected
- **Request Body**:
  ```json
  {
    "levelNumber": 1
  }
  ```
- **Response** `201 Created`:
  ```json
  {
    "success": true,
    "data": {
      "_id": "674abc...",
      "levelNumber": 1,
      "status": "ACTIVE",
      "initialState": { ... },
      "checkpoint": { "moves": 0, "worm": [...] },
      "startedAt": "2026-11-24T08:15:00.000Z"
    }
  }
  ```

### 5.2 Submit Checkpoint
- **Endpoint**: `POST /api/games/checkpoint` (or `POST /api/games/:sessionId/checkpoint`)
- **Auth**: Protected
- **Request Body**:
  ```json
  {
    "sessionId": "674abc...",
    "checkpoint": {
      "worm": [{ "x": 3, "y": 2 }, { "x": 2, "y": 2 }],
      "moves": 3,
      "applesEaten": 1,
      "collectedKeys": ["key_1"],
      "filledPits": ["4,2"]
    }
  }
  ```
- **Response** `200 OK`: Updated checkpoint record.
- **Errors**: `400 Bad Request` (Invalid move, continuity break, or collision).

### 5.3 Complete Game Session
- **Endpoint**: `POST /api/games/complete` (or `POST /api/games/:sessionId/complete`)
- **Auth**: Protected
- **Request Body**:
  ```json
  {
    "sessionId": "674abc...",
    "completionData": {
      "moves": 12,
      "durationSeconds": 24,
      "checkpoint": {
        "worm": [{ "x": 8, "y": 2 }, { "x": 7, "y": 2 }],
        "applesEaten": 1,
        "collectedKeys": []
      }
    }
  }
  ```
- **Response** `200 OK`:
  ```json
  {
    "success": true,
    "data": {
      "status": "COMPLETED",
      "stars": 3,
      "score": 1450,
      "rewards": {
        "coinsEarned": 25,
        "firstClearBonus": 50,
        "totalCoins": 75
      },
      "walletBalance": 175
    }
  }
  ```
- **Errors**: `400 Bad Request` (Worm head has not reached portal, missing keys, or moves exceeded limit).

### 5.4 Fail / Abandon Game Session
- **Endpoint**: `POST /api/games/fail`
- **Request Body**: `{ "sessionId": "...", "reason": "OUT_OF_MOVES" }`
- **Endpoint**: `POST /api/games/abandon`
- **Request Body**: `{ "sessionId": "..." }`

### 5.5 In-Game Consumable Actions (Undo / Hint / Booster)
- `POST /api/games/undo`: Consumes 1 Undo item or charges 40 coins, reverts 1 move.
- `POST /api/games/hint`: Consumes 1 Hint item or charges 50 coins, returns optimal next moves.
- `POST /api/games/booster`: Consumes 1 Booster or charges 100 coins, grants +5 extra moves.

---

## 6. Wallet & Transactions (`/api/wallet`)

### 6.1 Get Wallet Summary
- **Endpoint**: `GET /api/wallet`
- **Auth**: Protected
- **Response** `200 OK`:
  ```json
  {
    "success": true,
    "data": {
      "balance": 175,
      "lifetimeEarned": 225,
      "lifetimeSpent": 50,
      "version": 4
    }
  }
  ```

### 6.2 Get Transaction History
- **Endpoint**: `GET /api/wallet/transactions?page=1&limit=10&type=CREDIT`
- **Auth**: Protected
- **Response** `200 OK`:
  ```json
  {
    "success": true,
    "data": {
      "transactions": [
        {
          "_id": "674def...",
          "type": "CREDIT",
          "source": "LEVEL_REWARD",
          "amount": 75,
          "balanceBefore": 100,
          "balanceAfter": 175,
          "idempotencyKey": "level_clear_674abc...",
          "status": "COMPLETED",
          "createdAt": "2026-11-24T08:15:30.000Z"
        }
      ],
      "pagination": { "page": 1, "totalPages": 1, "totalTransactions": 1 }
    }
  }
  ```

### 6.3 Purchase Store Consumable
- **Endpoint**: `POST /api/wallet/purchase`
- **Auth**: Protected
- **Request Body**:
  ```json
  {
    "itemType": "UNDO",
    "quantity": 1,
    "idempotencyKey": "purchase_undo_1732436000"
  }
  ```
- **Response** `200 OK`:
  ```json
  {
    "success": true,
    "data": {
      "itemType": "UNDO",
      "quantity": 1,
      "cost": 40,
      "newBalance": 135,
      "inventoryCount": 1
    }
  }
  ```
- **Errors**: `400 Bad Request` (Insufficient funds or invalid item type).

---

## 7. Player Inventory (`/api/inventory`)

### 7.1 Get Inventory
- **Endpoint**: `GET /api/inventory`
- **Auth**: Protected
- **Response** `200 OK`:
  ```json
  {
    "success": true,
    "data": {
      "items": {
        "UNDO": { "quantity": 1 },
        "HINT": { "quantity": 0 },
        "BOOSTER": { "quantity": 2 }
      }
    }
  }
  ```

### 7.2 Consume Item
- **Endpoint**: `POST /api/inventory/consume`
- **Auth**: Protected
- **Request Body**:
  ```json
  {
    "itemType": "BOOSTER",
    "idempotencyKey": "consume_booster_123"
  }
  ```
- **Response** `200 OK`: Decrements inventory and returns remaining quantity.

---

## 8. Rewarded Ads (`/api/ads`)

### 8.1 Get Ad Opportunities & Quotas
- **Endpoint**: `GET /api/ads/opportunities`
- **Auth**: Protected
- **Response** `200 OK`: Summary of placement quotas (`GAME_OVER_REVIVE`, `POST_WIN_DOUBLE_COIN`, `POST_WIN_DOUBLE_SCORE`, `STORE_FREE_COINS`, etc.), cooldown remaining, and daily limits.

### 8.2 Request Ad Opportunity (Quota Reservation)
- **Endpoint**: `POST /api/ads/opportunity`
- **Auth**: Protected
- **Request Body**:
  ```json
  {
    "placement": "STORE_FREE_COINS"
  }
  ```
- **Response** `200 OK`: Returns reserved `opportunityId`, anti-skip duration ($4$s), and reward specs.

### 8.3 Simulate Watched Ad & Claim Reward
- **Endpoint**: `POST /api/ads/simulate-watch`
- **Auth**: Protected
- **Request Body**:
  ```json
  {
    "opportunityId": "opp_1732436000_abc"
  }
  ```
- **Response** `200 OK`: Verifies playback completion, credits coins or applies session bonus, and returns receipt.

---

## 9. Global Leaderboard (`/api/leaderboard`)

### 9.1 Get Global Rankings
- **Endpoint**: `GET /api/leaderboard?limit=20&page=1`
- **Auth**: Optional Auth (populates `myEntry` if authenticated Bearer token provided)
- **Response** `200 OK`:
  ```json
  {
    "success": true,
    "data": {
      "rankings": [
        {
          "rank": 1,
          "username": "apple_master",
          "totalStars": 150,
          "totalScore": 72400,
          "levelsCompleted": 50
        }
      ],
      "myEntry": {
        "rank": 4,
        "username": "speedy_worm",
        "totalStars": 38,
        "totalScore": 18200,
        "levelsCompleted": 14
      },
      "pagination": { "page": 1, "totalPages": 1, "totalPlayers": 12 }
    }
  }
  ```

---

## 10. Achievements (`/api/achievements`)

### 10.1 Get All 10 Achievements
- **Endpoint**: `GET /api/achievements`
- **Auth**: Protected
- **Response** `200 OK`:
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "first_slither",
        "title": "First Slither",
        "description": "Complete your very first level",
        "progress": 1,
        "target": 1,
        "unlocked": true,
        "claimed": false,
        "rewardCoins": 25
      }
    ]
  }
  ```

### 10.2 Claim Achievement Reward
- **Endpoint**: `POST /api/achievements/:id/claim`
- **Auth**: Protected
- **Response** `200 OK`:
  ```json
  {
    "success": true,
    "message": "Reward claimed successfully!",
    "data": {
      "achievementId": "first_slither",
      "rewardCoins": 25,
      "newBalance": 200
    }
  }
  ```
- **Errors**: `400 Bad Request` (Achievement not unlocked yet or already claimed).

---

## 11. Daily Challenge & Streaks (`/api/daily-challenge`)

### 11.1 Get Today's Challenge & Streak Overview
- **Endpoint**: `GET /api/daily-challenge/today`
- **Auth**: Optional Auth
- **Response** `200 OK`:
  ```json
  {
    "success": true,
    "data": {
      "date": "2026-11-24",
      "levelNumber": 7,
      "title": "Daily Challenge - Level 7",
      "isCompletedToday": false,
      "streak": {
        "currentStreak": 3,
        "longestStreak": 5,
        "claimedMilestones": [3]
      }
    }
  }
  ```

### 11.2 Start Daily Challenge Session
- **Endpoint**: `POST /api/daily-challenge/start`
- **Auth**: Protected
- **Request Body**: `{ "date": "2026-11-24" }`
- **Response** `200 OK`: Active daily challenge game session.

### 11.3 Complete Daily Challenge
- **Endpoint**: `POST /api/daily-challenge/complete`
- **Auth**: Protected
- **Request Body**:
  ```json
  {
    "date": "2026-11-24",
    "completionData": {
      "moves": 8,
      "durationSeconds": 16,
      "checkpoint": { ... }
    }
  }
  ```
- **Response** `200 OK`:
  ```json
  {
    "success": true,
    "message": "Daily challenge completed!",
    "data": {
      "date": "2026-11-24",
      "coinsAwarded": 100,
      "currentStreak": 4,
      "longestStreak": 5,
      "walletBalance": 300
    }
  }
  ```

### 11.4 Claim Streak Milestone Reward
- **Endpoint**: `POST /api/daily-challenge/claim-milestone/:days`
- **Auth**: Protected
- **Path Parameter**: `:days` (3, 7, 14, or 30)
- **Response** `200 OK`:
  ```json
  {
    "success": true,
    "message": "Streak milestone reward claimed!",
    "data": {
      "milestoneDays": 3,
      "coinsAwarded": 100,
      "newBalance": 400
    }
  }
  ```
- **Errors**: `400 Bad Request` (Streak milestone not reached or already claimed).
