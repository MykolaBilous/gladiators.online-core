export const ARENA_METERS_PER_UNIT = 0.5;
export const ARENA_HALF_METER_DISTANCE = 0.067;
export const ARENA_STANDARD_STEP_DISTANCE = ARENA_HALF_METER_DISTANCE;

export function metersToArenaDistance(meters: number): number {
  return (meters / ARENA_METERS_PER_UNIT) * ARENA_HALF_METER_DISTANCE;
}

export function halfMetersToArenaDistance(units: number): number {
  return units * ARENA_HALF_METER_DISTANCE;
}

export function createArenaReach(preferredMeters: number): {
  min: number;
  preferred: number;
  max: number;
} {
  const distance = metersToArenaDistance(preferredMeters);

  return {
    min: 0,
    preferred: distance,
    max: distance,
  };
}
