import mongoose from 'mongoose';

// 1. Sub-schema: 2D Coordinate Pair (X, Y)
const coordinateSchema = new mongoose.Schema(
  {
    x: {
      type: Number,
      required: [true, 'Coordinate x is required'],
      min: [0, 'x coordinate cannot be negative'],
      validate: {
        validator: Number.isInteger,
        message: 'x coordinate must be an integer',
      },
    },
    y: {
      type: Number,
      required: [true, 'Coordinate y is required'],
      min: [0, 'y coordinate cannot be negative'],
      validate: {
        validator: Number.isInteger,
        message: 'y coordinate must be an integer',
      },
    },
  },
  { _id: false }
);

// 2. Sub-schema: Key Item (for Key & Gate puzzles)
const keySchema = new mongoose.Schema(
  {
    x: {
      type: Number,
      required: [true, 'Key x coordinate is required'],
      min: [0, 'Key x coordinate cannot be negative'],
      validate: {
        validator: Number.isInteger,
        message: 'Key x coordinate must be an integer',
      },
    },
    y: {
      type: Number,
      required: [true, 'Key y coordinate is required'],
      min: [0, 'Key y coordinate cannot be negative'],
      validate: {
        validator: Number.isInteger,
        message: 'Key y coordinate must be an integer',
      },
    },
    keyId: {
      type: String,
      required: [true, 'keyId is required'],
      trim: true,
      minlength: [1, 'keyId cannot be empty'],
    },
  },
  { _id: false }
);

// 3. Sub-schema: Apple Item
const appleSchema = new mongoose.Schema(
  {
    x: {
      type: Number,
      required: [true, 'Apple x coordinate is required'],
      min: [0, 'Apple x coordinate cannot be negative'],
      validate: {
        validator: Number.isInteger,
        message: 'Apple x coordinate must be an integer',
      },
    },
    y: {
      type: Number,
      required: [true, 'Apple y coordinate is required'],
      min: [0, 'Apple y coordinate cannot be negative'],
      validate: {
        validator: Number.isInteger,
        message: 'Apple y coordinate must be an integer',
      },
    },
    type: {
      type: String,
      enum: {
        values: ['normal', 'golden', 'time', 'mystery', 'mega'],
        message: '{VALUE} is not a valid apple type',
      },
      default: 'normal',
    },
  },
  { _id: false }
);

// 4. Sub-schema: Pushable Stone
const stoneSchema = new mongoose.Schema(
  {
    x: {
      type: Number,
      required: [true, 'Stone x coordinate is required'],
      min: [0, 'Stone x coordinate cannot be negative'],
      validate: {
        validator: Number.isInteger,
        message: 'Stone x coordinate must be an integer',
      },
    },
    y: {
      type: Number,
      required: [true, 'Stone y coordinate is required'],
      min: [0, 'Stone y coordinate cannot be negative'],
      validate: {
        validator: Number.isInteger,
        message: 'Stone y coordinate must be an integer',
      },
    },
  },
  { _id: false }
);

// 5. Sub-schema: Obstacles and Hazards
const obstacleSchema = new mongoose.Schema(
  {
    x: {
      type: Number,
      required: [true, 'Obstacle x coordinate is required'],
      min: [0, 'Obstacle x coordinate cannot be negative'],
      validate: {
        validator: Number.isInteger,
        message: 'Obstacle x coordinate must be an integer',
      },
    },
    y: {
      type: Number,
      required: [true, 'Obstacle y coordinate is required'],
      min: [0, 'Obstacle y coordinate cannot be negative'],
      validate: {
        validator: Number.isInteger,
        message: 'Obstacle y coordinate must be an integer',
      },
    },
    type: {
      type: String,
      required: [true, 'Obstacle type is required'],
      enum: {
        values: ['wall', 'spike', 'pit', 'gate', 'moving_block'],
        message: '{VALUE} is not a valid obstacle type',
      },
    },
    keyId: {
      type: String,
      trim: true,
      default: null,
    },
    axis: {
      type: String,
      enum: {
        values: ['horizontal', 'vertical'],
        message: '{VALUE} is not a valid movement axis',
      },
      default: null,
    },
    range: {
      type: Number,
      min: [1, 'Moving block range must be at least 1 tile'],
      validate: {
        validator: function (val) {
          return val === null || val === undefined || Number.isInteger(val);
        },
        message: 'Moving block range must be an integer',
      },
      default: null,
    },
  },
  { _id: false }
);

// 6. Sub-schema: Worm Initial Spawn State
const wormStartSchema = new mongoose.Schema(
  {
    x: {
      type: Number,
      required: [true, 'Worm start x is required'],
      min: [0, 'Worm start x cannot be negative'],
      validate: {
        validator: Number.isInteger,
        message: 'Worm start x must be an integer',
      },
    },
    y: {
      type: Number,
      required: [true, 'Worm start y is required'],
      min: [0, 'Worm start y cannot be negative'],
      validate: {
        validator: Number.isInteger,
        message: 'Worm start y must be an integer',
      },
    },
    initialLength: {
      type: Number,
      required: [true, 'Initial worm length is required'],
      min: [2, 'Initial length must be at least 2 segments'],
      default: 2,
      validate: {
        validator: Number.isInteger,
        message: 'Initial length must be an integer',
      },
    },
    direction: {
      type: String,
      required: [true, 'Initial facing direction is required'],
      enum: {
        values: ['UP', 'DOWN', 'LEFT', 'RIGHT'],
        message: '{VALUE} is not a valid direction',
      },
      default: 'RIGHT',
    },
  },
  { _id: false }
);

// 7. Sub-schema: Star Move Thresholds (Fewer moves = more stars)
const starThresholdsSchema = new mongoose.Schema(
  {
    threeStars: {
      type: Number,
      required: [true, 'threeStars threshold is required'],
      min: [1, 'threeStars threshold must be at least 1 move'],
      validate: {
        validator: Number.isInteger,
        message: 'threeStars threshold must be an integer',
      },
    },
    twoStars: {
      type: Number,
      required: [true, 'twoStars threshold is required'],
      min: [1, 'twoStars threshold must be at least 1 move'],
      validate: {
        validator: Number.isInteger,
        message: 'twoStars threshold must be an integer',
      },
    },
    oneStar: {
      type: Number,
      required: [true, 'oneStar threshold is required'],
      min: [1, 'oneStar threshold must be at least 1 move'],
      validate: {
        validator: Number.isInteger,
        message: 'oneStar threshold must be an integer',
      },
    },
  },
  { _id: false }
);

// 8. Master Level Schema
const levelSchema = new mongoose.Schema(
  {
    levelNumber: {
      type: Number,
      required: [true, 'Level number is required'],
      unique: true,
      min: [1, 'Level number must be at least 1'],
      validate: {
        validator: Number.isInteger,
        message: 'Level number must be an integer',
      },
    },
    difficulty: {
      type: String,
      required: [true, 'Difficulty rating is required'],
      enum: {
        values: ['tutorial', 'easy', 'medium', 'hard', 'expert'],
        message: '{VALUE} is not a valid difficulty level',
      },
      index: true,
    },
    grid: {
      rows: {
        type: Number,
        required: [true, 'Grid rows count is required'],
        min: [4, 'Grid must have at least 4 rows'],
        max: [30, 'Grid cannot exceed 30 rows'],
        validate: {
          validator: Number.isInteger,
          message: 'Grid rows must be an integer',
        },
      },
      cols: {
        type: Number,
        required: [true, 'Grid columns count is required'],
        min: [4, 'Grid must have at least 4 columns'],
        max: [30, 'Grid cannot exceed 30 columns'],
        validate: {
          validator: Number.isInteger,
          message: 'Grid columns must be an integer',
        },
      },
    },
    wormStart: {
      type: wormStartSchema,
      required: [true, 'Worm starting position is required'],
    },
    apples: {
      type: [appleSchema],
      default: [],
    },
    stones: {
      type: [stoneSchema],
      default: [],
    },
    keys: {
      type: [keySchema],
      default: [],
    },
    obstacles: {
      type: [obstacleSchema],
      default: [],
    },
    portal: {
      type: coordinateSchema,
      required: [true, 'Portal coordinates are required'],
    },
    moveLimit: {
      type: Number,
      required: [true, 'Move limit is required'],
      min: [1, 'Move limit must be at least 1'],
      validate: {
        validator: Number.isInteger,
        message: 'Move limit must be an integer',
      },
    },
    starThresholds: {
      type: starThresholdsSchema,
      required: [true, 'Star move thresholds are required'],
    },
    objective: {
      type: String,
      required: [true, 'Level objective is required'],
      enum: {
        values: [
          'eat_all_apples',
          'reach_portal',
          'collect_keys',
          'collect_apple_count',
          'reach_length',
          'limited_moves',
          'perfect_route',
        ],
        message: '{VALUE} is not a valid objective',
      },
      default: 'eat_all_apples',
    },
    targetValue: {
      type: Number,
      default: null,
      validate: {
        validator: function (val) {
          return val === null || (Number.isInteger(val) && val > 0);
        },
        message: 'Target value must be a positive integer when provided',
      },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Comprehensive Pre-validation Hook: Safe boundary, association, patrol path, and collision enforcement
levelSchema.pre('validate', function () {
  // Safety Guard: Grid must be valid integers before computing coordinate logic
  if (!this.grid || !Number.isInteger(this.grid.rows) || !Number.isInteger(this.grid.cols)) {
    return;
  }

  const { rows, cols } = this.grid;
  if (rows < 4 || cols < 4) {
    return;
  }

  const isOutOfBounds = (x, y) => x < 0 || x >= cols || y < 0 || y >= rows;
  const coordKey = (x, y) => `${x},${y}`;
  const isValidCoord = (item) => item && Number.isInteger(item.x) && Number.isInteger(item.y);

  // -------------------------------------------------------------------------
  // 1. Move Limit and Star Threshold Logic
  // -------------------------------------------------------------------------
  if (this.starThresholds) {
    const { threeStars, twoStars, oneStar } = this.starThresholds;

    if (Number.isInteger(threeStars) && Number.isInteger(twoStars) && Number.isInteger(oneStar)) {
      if (threeStars > twoStars || twoStars > oneStar) {
        this.invalidate(
          'starThresholds',
          'Star thresholds must follow move efficiency order: threeStars <= twoStars <= oneStar'
        );
      }

      if (this.moveLimit !== undefined && this.moveLimit !== null && Number.isInteger(this.moveLimit)) {
        if (this.moveLimit < oneStar) {
          this.invalidate(
            'moveLimit',
            `Move limit (${this.moveLimit}) cannot be less than the oneStar threshold (${oneStar})`
          );
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // 2. Keys Validation (Bounds, duplicate coordinates, unique keyId)
  // -------------------------------------------------------------------------
  const keyIdSet = new Set();
  const keyCoordSet = new Set();

  if (Array.isArray(this.keys)) {
    this.keys.forEach((key, idx) => {
      if (!isValidCoord(key)) return;

      if (isOutOfBounds(key.x, key.y)) {
        this.invalidate(
          `keys.${idx}`,
          `Key [${idx}] (${key.keyId || 'unnamed'}) at (${key.x}, ${key.y}) is outside grid dimensions (${cols}x${rows})`
        );
      }

      const kPos = coordKey(key.x, key.y);
      if (keyCoordSet.has(kPos)) {
        this.invalidate(
          `keys.${idx}`,
          `Key [${idx}] spawns on duplicate coordinate (${key.x}, ${key.y})`
        );
      }
      keyCoordSet.add(kPos);

      if (key.keyId !== undefined && key.keyId !== null) {
        const trimmedKeyId = typeof key.keyId === 'string' ? key.keyId.trim() : '';
        if (trimmedKeyId.length === 0) {
          this.invalidate(`keys.${idx}.keyId`, `Key [${idx}] must have a non-empty keyId`);
        } else if (keyIdSet.has(trimmedKeyId)) {
          this.invalidate(`keys.${idx}.keyId`, `Duplicate keyId "${trimmedKeyId}" found in level keys`);
        } else {
          keyIdSet.add(trimmedKeyId);
        }
      }
    });
  }

  // -------------------------------------------------------------------------
  // 3. Obstacles Validation (Bounds, duplicates, moving block config, gate keyId)
  // -------------------------------------------------------------------------
  const obstacleCoordSet = new Set();
  const movingBlocks = [];

  if (Array.isArray(this.obstacles)) {
    this.obstacles.forEach((obs, idx) => {
      if (!isValidCoord(obs)) return;

      if (isOutOfBounds(obs.x, obs.y)) {
        this.invalidate(
          `obstacles.${idx}`,
          `Obstacle [${idx}] (${obs.type}) at (${obs.x}, ${obs.y}) is outside grid dimensions (${cols}x${rows})`
        );
      }

      const obsPos = coordKey(obs.x, obs.y);
      if (obstacleCoordSet.has(obsPos)) {
        this.invalidate(
          `obstacles.${idx}`,
          `Obstacle [${idx}] (${obs.type}) spawns on duplicate coordinate (${obs.x}, ${obs.y})`
        );
      }
      obstacleCoordSet.add(obsPos);

      // Moving Block validation
      if (obs.type === 'moving_block') {
        const hasValidAxis = obs.axis && ['horizontal', 'vertical'].includes(obs.axis);
        const hasValidRange = Number.isInteger(obs.range) && obs.range >= 1;

        if (!hasValidAxis) {
          this.invalidate(
            `obstacles.${idx}.axis`,
            `Moving block [${idx}] must define a valid axis ('horizontal' or 'vertical')`
          );
        }

        if (!hasValidRange) {
          this.invalidate(
            `obstacles.${idx}.range`,
            `Moving block [${idx}] must define a positive integer range (>= 1)`
          );
        }

        if (hasValidAxis && hasValidRange) {
          const endX = obs.axis === 'horizontal' ? obs.x + obs.range : obs.x;
          const endY = obs.axis === 'vertical' ? obs.y + obs.range : obs.y;

          if (isOutOfBounds(endX, endY)) {
            this.invalidate(
              `obstacles.${idx}.range`,
              `Moving block [${idx}] patrol path reaches (${endX}, ${endY}), which exceeds grid dimensions (${cols}x${rows})`
            );
          } else {
            movingBlocks.push({ idx, obs });
          }
        }
      } else {
        // Non-moving obstacles must not have axis or range
        if (obs.axis !== null && obs.axis !== undefined) {
          this.invalidate(
            `obstacles.${idx}.axis`,
            `Non-moving obstacle [${idx}] of type "${obs.type}" cannot have an axis`
          );
        }
        if (obs.range !== null && obs.range !== undefined) {
          this.invalidate(
            `obstacles.${idx}.range`,
            `Non-moving obstacle [${idx}] of type "${obs.type}" cannot have a range`
          );
        }
      }

      // Gate key association validation
      if (obs.type === 'gate') {
        if (obs.keyId !== null && obs.keyId !== undefined) {
          const trimmedKeyId = typeof obs.keyId === 'string' ? obs.keyId.trim() : '';
          if (trimmedKeyId.length === 0) {
            this.invalidate(
              `obstacles.${idx}.keyId`,
              `Gate [${idx}] keyId cannot be an empty string`
            );
          } else if (!keyIdSet.has(trimmedKeyId)) {
            this.invalidate(
              `obstacles.${idx}.keyId`,
              `Gate [${idx}] references keyId "${trimmedKeyId}" which does not exist in the level's keys`
            );
          }
        }
      } else {
        // Non-gate obstacles must not define a keyId
        if (obs.keyId !== null && obs.keyId !== undefined) {
          this.invalidate(
            `obstacles.${idx}.keyId`,
            `Non-gate obstacle [${idx}] of type "${obs.type}" cannot have a keyId`
          );
        }
      }
    });
  }

  // -------------------------------------------------------------------------
  // 4. Apples Validation (Bounds & Duplicate coordinates)
  // -------------------------------------------------------------------------
  const appleCoordSet = new Set();
  if (Array.isArray(this.apples)) {
    this.apples.forEach((apple, idx) => {
      if (!isValidCoord(apple)) return;

      if (isOutOfBounds(apple.x, apple.y)) {
        this.invalidate(
          `apples.${idx}`,
          `Apple [${idx}] at (${apple.x}, ${apple.y}) is outside grid dimensions (${cols}x${rows})`
        );
      }

      const aPos = coordKey(apple.x, apple.y);
      if (appleCoordSet.has(aPos)) {
        this.invalidate(
          `apples.${idx}`,
          `Apple [${idx}] spawns on duplicate coordinate (${apple.x}, ${apple.y})`
        );
      }
      appleCoordSet.add(aPos);
    });
  }

  // -------------------------------------------------------------------------
  // 5. Stones Validation (Bounds & Duplicate coordinates)
  // -------------------------------------------------------------------------
  const stoneCoordSet = new Set();
  if (Array.isArray(this.stones)) {
    this.stones.forEach((stone, idx) => {
      if (!isValidCoord(stone)) return;

      if (isOutOfBounds(stone.x, stone.y)) {
        this.invalidate(
          `stones.${idx}`,
          `Stone [${idx}] at (${stone.x}, ${stone.y}) is outside grid dimensions (${cols}x${rows})`
        );
      }

      const sPos = coordKey(stone.x, stone.y);
      if (stoneCoordSet.has(sPos)) {
        this.invalidate(
          `stones.${idx}`,
          `Stone [${idx}] spawns on duplicate coordinate (${stone.x}, ${stone.y})`
        );
      }
      stoneCoordSet.add(sPos);
    });
  }

  // -------------------------------------------------------------------------
  // 6. Portal Coordinates Validation
  // -------------------------------------------------------------------------
  let portalKey = null;
  if (isValidCoord(this.portal)) {
    if (isOutOfBounds(this.portal.x, this.portal.y)) {
      this.invalidate(
        'portal',
        `Portal position (${this.portal.x}, ${this.portal.y}) is outside grid dimensions (${cols}x${rows})`
      );
    } else {
      portalKey = coordKey(this.portal.x, this.portal.y);
    }
  }

  // -------------------------------------------------------------------------
  // 7. Worm Initial Layout & Bounds
  // -------------------------------------------------------------------------
  const wormSegments = [];
  const wormCoordSet = new Set();

  if (isValidCoord(this.wormStart) && Number.isInteger(this.wormStart.initialLength)) {
    const { x, y, initialLength, direction } = this.wormStart;

    for (let i = 0; i < initialLength; i++) {
      let segX = x;
      let segY = y;

      if (direction === 'RIGHT') segX = x - i;
      else if (direction === 'LEFT') segX = x + i;
      else if (direction === 'UP') segY = y + i;
      else if (direction === 'DOWN') segY = y - i;

      if (isOutOfBounds(segX, segY)) {
        this.invalidate(
          'wormStart',
          `Worm segment ${i} at (${segX}, ${segY}) is outside grid dimensions (${cols}x${rows})`
        );
      } else {
        const segKey = coordKey(segX, segY);
        wormSegments.push({ x: segX, y: segY, index: i, key: segKey });
        wormCoordSet.add(segKey);
      }
    }
  }

  // -------------------------------------------------------------------------
  // 8. Static Starting Collisions
  // -------------------------------------------------------------------------
  wormSegments.forEach((seg) => {
    if (obstacleCoordSet.has(seg.key)) {
      this.invalidate(
        'wormStart',
        `Worm segment ${seg.index} at (${seg.x}, ${seg.y}) spawns inside an obstacle`
      );
    }
    if (stoneCoordSet.has(seg.key)) {
      this.invalidate(
        'wormStart',
        `Worm segment ${seg.index} at (${seg.x}, ${seg.y}) spawns inside a stone`
      );
    }
    if (portalKey && seg.key === portalKey) {
      this.invalidate(
        'wormStart',
        `Worm segment ${seg.index} at (${seg.x}, ${seg.y}) spawns on top of the exit portal`
      );
    }
    if (appleCoordSet.has(seg.key)) {
      this.invalidate(
        'wormStart',
        `Worm segment ${seg.index} at (${seg.x}, ${seg.y}) spawns on top of an apple`
      );
    }
    if (keyCoordSet.has(seg.key)) {
      this.invalidate(
        'wormStart',
        `Worm segment ${seg.index} at (${seg.x}, ${seg.y}) spawns on top of a key`
      );
    }
  });

  if (portalKey) {
    if (obstacleCoordSet.has(portalKey)) {
      this.invalidate(
        'portal',
        `Portal at (${this.portal.x}, ${this.portal.y}) spawns inside an obstacle`
      );
    }
    if (stoneCoordSet.has(portalKey)) {
      this.invalidate(
        'portal',
        `Portal at (${this.portal.x}, ${this.portal.y}) spawns inside a stone`
      );
    }
  }

  if (Array.isArray(this.apples)) {
    this.apples.forEach((apple, idx) => {
      if (!isValidCoord(apple)) return;
      const aKey = coordKey(apple.x, apple.y);

      if (obstacleCoordSet.has(aKey)) {
        this.invalidate(
          `apples.${idx}`,
          `Apple [${idx}] at (${apple.x}, ${apple.y}) spawns inside an obstacle`
        );
      }
      if (stoneCoordSet.has(aKey)) {
        this.invalidate(
          `apples.${idx}`,
          `Apple [${idx}] at (${apple.x}, ${apple.y}) spawns inside a stone`
        );
      }
      if (portalKey && aKey === portalKey) {
        this.invalidate(
          `apples.${idx}`,
          `Apple [${idx}] at (${apple.x}, ${apple.y}) spawns on top of the portal`
        );
      }
    });
  }

  if (Array.isArray(this.keys)) {
    this.keys.forEach((keyItem, idx) => {
      if (!isValidCoord(keyItem)) return;
      const kKey = coordKey(keyItem.x, keyItem.y);

      if (obstacleCoordSet.has(kKey)) {
        this.invalidate(
          `keys.${idx}`,
          `Key [${idx}] (${keyItem.keyId}) at (${keyItem.x}, ${keyItem.y}) spawns inside an obstacle`
        );
      }
      if (stoneCoordSet.has(kKey)) {
        this.invalidate(
          `keys.${idx}`,
          `Key [${idx}] (${keyItem.keyId}) at (${keyItem.x}, ${keyItem.y}) spawns inside a stone`
        );
      }
      if (portalKey && kKey === portalKey) {
        this.invalidate(
          `keys.${idx}`,
          `Key [${idx}] (${keyItem.keyId}) at (${keyItem.x}, ${keyItem.y}) spawns on top of the portal`
        );
      }
      if (appleCoordSet.has(kKey)) {
        this.invalidate(
          `keys.${idx}`,
          `Key [${idx}] (${keyItem.keyId}) at (${keyItem.x}, ${keyItem.y}) spawns on top of an apple`
        );
      }
    });
  }

  if (Array.isArray(this.stones)) {
    this.stones.forEach((stone, idx) => {
      if (!isValidCoord(stone)) return;
      const sKey = coordKey(stone.x, stone.y);

      if (obstacleCoordSet.has(sKey)) {
        this.invalidate(
          `stones.${idx}`,
          `Stone [${idx}] at (${stone.x}, ${stone.y}) spawns inside an obstacle`
        );
      }
    });
  }

  // -------------------------------------------------------------
  // 9. Moving Block Full Patrol Path Collision Validation
  // -------------------------------------------------------------
  // Track future patrol tiles of moving blocks to reject overlapping paths
  const movingBlockPatrolMap = new Map(); // coordKey -> blockIdx

  movingBlocks.forEach(({ idx, obs }) => {
    for (let step = 1; step <= obs.range; step++) {
      const pathX = obs.axis === 'horizontal' ? obs.x + step : obs.x;
      const pathY = obs.axis === 'vertical' ? obs.y + step : obs.y;
      const pKey = coordKey(pathX, pathY);

      if (obstacleCoordSet.has(pKey)) {
        this.invalidate(
          `obstacles.${idx}.range`,
          `Moving block [${idx}] patrol path collides with an obstacle at (${pathX}, ${pathY})`
        );
        break;
      }
      if (stoneCoordSet.has(pKey)) {
        this.invalidate(
          `obstacles.${idx}.range`,
          `Moving block [${idx}] patrol path collides with a stone at (${pathX}, ${pathY})`
        );
        break;
      }
      if (appleCoordSet.has(pKey)) {
        this.invalidate(
          `obstacles.${idx}.range`,
          `Moving block [${idx}] patrol path collides with an apple at (${pathX}, ${pathY})`
        );
        break;
      }
      if (keyCoordSet.has(pKey)) {
        this.invalidate(
          `obstacles.${idx}.range`,
          `Moving block [${idx}] patrol path collides with a key at (${pathX}, ${pathY})`
        );
        break;
      }
      if (portalKey && pKey === portalKey) {
        this.invalidate(
          `obstacles.${idx}.range`,
          `Moving block [${idx}] patrol path collides with the exit portal at (${pathX}, ${pathY})`
        );
        break;
      }
      if (wormCoordSet.has(pKey)) {
        this.invalidate(
          `obstacles.${idx}.range`,
          `Moving block [${idx}] patrol path collides with the worm's initial body at (${pathX}, ${pathY})`
        );
        break;
      }
      if (movingBlockPatrolMap.has(pKey)) {
        const otherIdx = movingBlockPatrolMap.get(pKey);
        this.invalidate(
          `obstacles.${idx}.range`,
          `Moving block [${idx}] patrol path collides with moving block [${otherIdx}] patrol path at (${pathX}, ${pathY})`
        );
        break;
      }

      movingBlockPatrolMap.set(pKey, idx);
    }
  });

  // -------------------------------------------------------------
  // 10. Objective and targetValue Consistency Validation
  // -------------------------------------------------------------
  const numApples = Array.isArray(this.apples) ? this.apples.length : 0;
  const numKeys = Array.isArray(this.keys) ? this.keys.length : 0;
  const initialLen =
    this.wormStart && Number.isInteger(this.wormStart.initialLength)
      ? this.wormStart.initialLength
      : null;

  switch (this.objective) {
    case 'collect_apple_count':
      if (this.targetValue === null || this.targetValue === undefined) {
        this.invalidate(
          'targetValue',
          'Objective "collect_apple_count" requires a positive integer targetValue'
        );
      } else if (Number.isInteger(this.targetValue) && this.targetValue > numApples) {
        this.invalidate(
          'targetValue',
          `Objective "collect_apple_count" targetValue (${this.targetValue}) exceeds total apples in level (${numApples})`
        );
      }
      break;

    case 'reach_length':
      if (this.targetValue === null || this.targetValue === undefined) {
        this.invalidate(
          'targetValue',
          'Objective "reach_length" requires a positive integer targetValue'
        );
      } else if (initialLen !== null && Number.isInteger(this.targetValue)) {
        if (this.targetValue <= initialLen) {
          this.invalidate(
            'targetValue',
            `Objective "reach_length" targetValue (${this.targetValue}) must be greater than initial worm length (${initialLen})`
          );
        } else if (this.targetValue > initialLen + numApples) {
          this.invalidate(
            'targetValue',
            `Objective "reach_length" targetValue (${this.targetValue}) exceeds maximum possible length (${initialLen + numApples})`
          );
        }
      }
      break;

    case 'collect_keys':
      if (numKeys === 0) {
        this.invalidate(
          'objective',
          'Objective "collect_keys" requires at least one key in the level'
        );
      } else if (
        this.targetValue !== null &&
        this.targetValue !== undefined &&
        Number.isInteger(this.targetValue) &&
        this.targetValue > numKeys
      ) {
        this.invalidate(
          'targetValue',
          `Objective "collect_keys" targetValue (${this.targetValue}) exceeds total keys in level (${numKeys})`
        );
      }
      break;

    case 'eat_all_apples':
      if (numApples === 0) {
        this.invalidate(
          'objective',
          'Objective "eat_all_apples" requires at least one apple in the level'
        );
      }
      break;

    case 'reach_portal':
    case 'limited_moves':
    case 'perfect_route':
      if (this.targetValue !== null && this.targetValue !== undefined) {
        this.invalidate(
          'targetValue',
          `Objective "${this.objective}" does not use targetValue`
        );
      }
      break;
  }
});

const Level = mongoose.models.Level || mongoose.model('Level', levelSchema);

export default Level;