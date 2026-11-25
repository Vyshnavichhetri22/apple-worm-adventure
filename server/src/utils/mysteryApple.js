export const MYSTERY_EFFECT_TYPES = Object.freeze({
  BONUS_SCORE: 'BONUS_SCORE',
  EXTRA_MOVES: 'EXTRA_MOVES',
  EXTRA_GROWTH: 'EXTRA_GROWTH',
});

export const DEFAULT_MYSTERY_CONFIG = Object.freeze({
  effects: ['BONUS_SCORE', 'EXTRA_MOVES', 'EXTRA_GROWTH'],
  bonusScore: 200,
  extraMoves: 5,
  extraGrowth: 1, // +1 additional segment (+2 segments total)
});

/**
 * 32-bit FNV-1a hash function for deterministic cross-platform effect selection.
 */
export function hashString(str) {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Resolves the deterministic Mystery Apple effect for a given seed, coordinate, and configuration.
 *
 * @param {string|number} seedKey - Session ID, Level Number, or persistent seed
 * @param {number} x - Apple X coordinate
 * @param {number} y - Apple Y coordinate
 * @param {object} [config] - Optional configuration overriding default rewards/effects
 * @returns {{ type: string, value: number, x: number, y: number }}
 */
export function resolveMysteryEffect(seedKey, x, y, config = {}) {
  const allowedEffects =
    Array.isArray(config.effects) && config.effects.length > 0
      ? config.effects
      : DEFAULT_MYSTERY_CONFIG.effects;

  const bonusScoreValue =
    typeof config.bonusScore === 'number' && config.bonusScore >= 0
      ? config.bonusScore
      : DEFAULT_MYSTERY_CONFIG.bonusScore;

  const extraMovesValue =
    typeof config.extraMoves === 'number' && config.extraMoves > 0
      ? config.extraMoves
      : DEFAULT_MYSTERY_CONFIG.extraMoves;

  const extraGrowthValue =
    typeof config.extraGrowth === 'number' && config.extraGrowth > 0
      ? config.extraGrowth
      : DEFAULT_MYSTERY_CONFIG.extraGrowth;

  const key = `${seedKey || 'default'}_${x}_${y}`;
  const h = hashString(key);
  const effectIndex = h % allowedEffects.length;
  const effectType = allowedEffects[effectIndex];

  let value = 0;
  if (effectType === 'BONUS_SCORE') {
    value = bonusScoreValue;
  } else if (effectType === 'EXTRA_MOVES') {
    value = extraMovesValue;
  } else if (effectType === 'EXTRA_GROWTH') {
    value = extraGrowthValue;
  }

  return {
    type: effectType,
    value,
    x,
    y,
  };
}

/**
 * Human-readable description of a resolved mystery effect.
 */
export function formatMysteryEffectDescription(effect) {
  if (!effect) return 'Mystery Bonus';
  switch (effect.type) {
    case 'BONUS_SCORE':
      return `+${effect.value} Bonus Score!`;
    case 'EXTRA_MOVES':
      return `+${effect.value} Extra Moves!`;
    case 'EXTRA_GROWTH':
      return `Mega Growth (+${effect.value + 1} Segments)!`;
    default:
      return `${effect.type} (+${effect.value})`;
  }
}

