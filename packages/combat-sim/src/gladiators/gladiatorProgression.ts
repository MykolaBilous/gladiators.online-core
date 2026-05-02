import type {
  GladiatorClass,
  GladiatorStatKey,
  GladiatorStatMultipliers,
  GladiatorStatPoints,
  GladiatorStats,
} from "./gladiatorTypes.js";

export const gladiatorStatKeys = [
  "hp",
  "attack",
  "defense",
  "dexterity",
  "endurance",
] as const satisfies readonly GladiatorStatKey[];

export const LEVEL_ZERO_STAT_POINTS = 12;
export const POINTS_PER_GLADIATOR_LEVEL = 3;
export const MIN_GLADIATOR_LEVEL = 0;
export const MAX_GLADIATOR_LEVEL = 20;

export function createEmptyStatPoints(): GladiatorStatPoints {
  return {
    hp: 0,
    attack: 0,
    defense: 0,
    dexterity: 0,
    endurance: 0,
  };
}

export function sumStatPoints(points: GladiatorStatPoints): number {
  return gladiatorStatKeys.reduce((sum, key) => sum + points[key], 0);
}

export function addStatPoints(
  first: GladiatorStatPoints,
  second: GladiatorStatPoints,
): GladiatorStatPoints {
  const combined = createEmptyStatPoints();

  for (const key of gladiatorStatKeys) {
    combined[key] = first[key] + second[key];
  }

  return combined;
}

export function cloneStatPoints(points: GladiatorStatPoints): GladiatorStatPoints {
  return addStatPoints(createEmptyStatPoints(), points);
}

export function getBonusPointsForLevel(level: number): number {
  return Math.max(0, Math.floor(level)) * POINTS_PER_GLADIATOR_LEVEL;
}

export function getTotalPointsForLevel(level: number): number {
  return LEVEL_ZERO_STAT_POINTS + getBonusPointsForLevel(level);
}

export function clampGladiatorLevel(level: number): number {
  if (!Number.isFinite(level)) {
    return MIN_GLADIATOR_LEVEL;
  }

  return Math.min(
    Math.max(Math.floor(level), MIN_GLADIATOR_LEVEL),
    MAX_GLADIATOR_LEVEL,
  );
}

export function createRandomLevelZeroPoints(): GladiatorStatPoints {
  const points = createEmptyStatPoints();

  for (let index = 0; index < LEVEL_ZERO_STAT_POINTS; index += 1) {
    const stat = gladiatorStatKeys[Math.floor(Math.random() * gladiatorStatKeys.length)]!;
    points[stat] += 1;
  }

  return points;
}

export function distributePointsByWeights(
  totalPoints: number,
  weights: GladiatorStatMultipliers,
): GladiatorStatPoints {
  const points = createEmptyStatPoints();
  const normalizedTotal = Math.max(0, Math.floor(totalPoints));

  if (normalizedTotal === 0) {
    return points;
  }

  const totalWeight = gladiatorStatKeys.reduce(
    (sum, key) => sum + Math.max(0.01, weights[key]),
    0,
  );
  const weightedShares = gladiatorStatKeys
    .map((key) => {
      const exact = (normalizedTotal * Math.max(0.01, weights[key])) / totalWeight;

      return {
        key,
        base: Math.floor(exact),
        remainder: exact - Math.floor(exact),
      };
    })
    .sort((a, b) => b.remainder - a.remainder);

  let spentPoints = 0;

  for (const share of weightedShares) {
    points[share.key] = share.base;
    spentPoints += share.base;
  }

  for (let index = 0; spentPoints < normalizedTotal; index += 1) {
    const share = weightedShares[index % weightedShares.length]!;
    points[share.key] += 1;
    spentPoints += 1;
  }

  return points;
}

export function getAutoBonusPoints(
  gladiator: GladiatorClass,
  level: number,
): GladiatorStatPoints {
  return distributePointsByWeights(
    getBonusPointsForLevel(clampGladiatorLevel(level)),
    gladiator.statMultipliers,
  );
}

export function deriveGladiatorStats(
  gladiator: GladiatorClass,
  points: GladiatorStatPoints,
): GladiatorStats {
  const stats = {} as GladiatorStats;

  for (const key of gladiatorStatKeys) {
    stats[key] = Math.round(gladiator.stats[key] + points[key] * gladiator.statMultipliers[key]);
  }

  return stats;
}

export function createProgressedGladiator(
  gladiator: GladiatorClass,
  _level: number,
  points: GladiatorStatPoints,
): GladiatorClass {
  return {
    ...gladiator,
    stats: deriveGladiatorStats(gladiator, points),
  };
}
