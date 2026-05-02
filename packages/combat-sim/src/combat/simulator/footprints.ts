import type { BattleFighterRuntime, BattlePoint, BattleTeamId } from "../battleTypes.js";
import {
  ARENA_MAX_X,
  ARENA_MAX_Y,
  ARENA_MIN_X,
  ARENA_MIN_Y,
} from "./constants.js";
import { clamp, clonePoint, getDistance } from "./math.js";
import { randomBetween } from "./random.js";

const FOOTPRINT_PADDING = 0.006;
const FORMATION_RELAXATION_PASSES = 8;
const DESTINATION_RELAXATION_PASSES = 4;

interface FighterFootprint {
  readonly fighterId: string;
  readonly point: BattlePoint;
  readonly radius: number;
}

export function getFighterBodyRadius(
  fighters: Record<string, BattleFighterRuntime>,
  fighterId: string,
): number {
  return fighters[fighterId]?.bodyRadius ?? 0.028;
}

export function separateStartPositionsByFootprint(
  positions: Record<string, BattlePoint>,
  fighters: Record<string, BattleFighterRuntime>,
  teams: Record<string, BattleTeamId>,
): Record<string, BattlePoint> {
  const next = Object.fromEntries(
    Object.entries(positions).map(([fighterId, point]) => [fighterId, clonePoint(point)]),
  ) as Record<string, BattlePoint>;
  const fighterIds = Object.keys(next).sort();

  for (let pass = 0; pass < FORMATION_RELAXATION_PASSES; pass += 1) {
    let changed = false;

    for (let i = 0; i < fighterIds.length; i += 1) {
      const leftId = fighterIds[i];
      if (!leftId) {
        continue;
      }

      for (let j = i + 1; j < fighterIds.length; j += 1) {
        const rightId = fighterIds[j];
        if (!rightId) {
          continue;
        }

        const leftPoint = next[leftId];
        const rightPoint = next[rightId];
        if (!leftPoint || !rightPoint) {
          continue;
        }

        const minDistance =
          getFighterBodyRadius(fighters, leftId) +
          getFighterBodyRadius(fighters, rightId) +
          FOOTPRINT_PADDING;
        const separation = getSeparationVector(leftPoint, rightPoint, leftId, rightId, teams);

        if (separation.distance >= minDistance) {
          continue;
        }

        const push = (minDistance - separation.distance) / 2;
        next[leftId] = clampFootprintPoint({
          x: leftPoint.x + separation.x * push,
          y: leftPoint.y + separation.y * push,
        });
        next[rightId] = clampFootprintPoint({
          x: rightPoint.x - separation.x * push,
          y: rightPoint.y - separation.y * push,
        });
        changed = true;
      }
    }

    if (!changed) {
      break;
    }
  }

  return next;
}

export function resolveDestinationByFootprint(
  point: BattlePoint,
  radius: number,
  footprints: readonly FighterFootprint[],
  fallbackDirection: BattlePoint,
): BattlePoint {
  let next = clonePoint(point);

  for (let pass = 0; pass < DESTINATION_RELAXATION_PASSES; pass += 1) {
    let changed = false;

    for (const footprint of footprints) {
      const minDistance = radius + footprint.radius + FOOTPRINT_PADDING;
      const dx = next.x - footprint.point.x;
      const dy = next.y - footprint.point.y;
      const distance = Math.hypot(dx, dy);

      if (distance >= minDistance) {
        continue;
      }

      const direction =
        distance > 0.001
          ? { x: dx / distance, y: dy / distance }
          : normalizeFallback(fallbackDirection);
      const push = minDistance - distance;

      next = clampFootprintPoint({
        x: next.x + direction.x * push,
        y: next.y + direction.y * push,
      });
      changed = true;
    }

    if (!changed) {
      break;
    }
  }

  return next;
}

export function createFighterFootprints(
  fighterIds: readonly string[],
  fighters: Record<string, BattleFighterRuntime>,
  points: ReadonlyMap<string, BattlePoint>,
  selfId: string,
): FighterFootprint[] {
  return fighterIds.flatMap((fighterId) => {
    if (fighterId === selfId) {
      return [];
    }

    const point = points.get(fighterId);
    if (!point) {
      return [];
    }

    return [{
      fighterId,
      point,
      radius: getFighterBodyRadius(fighters, fighterId),
    }];
  });
}

function getSeparationVector(
  leftPoint: BattlePoint,
  rightPoint: BattlePoint,
  leftId: string,
  rightId: string,
  teams: Record<string, BattleTeamId>,
): { x: number; y: number; distance: number } {
  const dx = leftPoint.x - rightPoint.x;
  const dy = leftPoint.y - rightPoint.y;
  const distance = getDistance(leftPoint, rightPoint);

  if (distance > 0.001) {
    return {
      x: dx / distance,
      y: dy / distance,
      distance,
    };
  }

  const leftTeam = teams[leftId];
  const rightTeam = teams[rightId];
  if (leftTeam && rightTeam && leftTeam !== rightTeam) {
    return {
      x: leftTeam === "left" ? -1 : 1,
      y: randomBetween(-0.16, 0.16),
      distance: 0,
    };
  }

  return normalizeFallback({
    x: randomBetween(-1, 1),
    y: randomBetween(-1, 1),
  });
}

function normalizeFallback(point: BattlePoint): { x: number; y: number; distance: number } {
  const length = Math.hypot(point.x, point.y);

  if (length > 0.001) {
    return {
      x: point.x / length,
      y: point.y / length,
      distance: 0,
    };
  }

  return { x: 1, y: 0, distance: 0 };
}

function clampFootprintPoint(point: BattlePoint): BattlePoint {
  return {
    x: clamp(point.x, ARENA_MIN_X, ARENA_MAX_X),
    y: clamp(point.y, ARENA_MIN_Y, ARENA_MAX_Y),
  };
}
