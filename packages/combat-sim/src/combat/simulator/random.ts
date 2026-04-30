export type BattleSeed = number | string;

let activeRandom: () => number = Math.random;

export function randomUnit(): number {
  return activeRandom();
}

export const randomBetween = (min: number, max: number): number =>
  min + randomUnit() * (max - min);

export function normalizeBattleSeed(seed: BattleSeed | undefined): string {
  if (seed !== undefined) {
    return String(seed);
  }

  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1_000_000_000).toString(36)}`;
}

export function hashSeed(seed: string): number {
  let hash = 2_166_136_261;

  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }

  return hash >>> 0;
}

export function createSeededRandom(seed: string): () => number {
  let state = hashSeed(seed) || 0x6d2b79f5;

  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);

    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function withBattleRandom<T>(random: () => number, callback: () => T): T {
  const previousRandom = activeRandom;
  activeRandom = random;

  try {
    return callback();
  } finally {
    activeRandom = previousRandom;
  }
}

export function createBattleId(seed: string): string {
  return `${hashSeed(seed).toString(36)}-${Math.floor(randomUnit() * 10_000).toString(36)}`;
}
