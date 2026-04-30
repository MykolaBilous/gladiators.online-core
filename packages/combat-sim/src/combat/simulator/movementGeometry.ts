import type { GladiatorClass } from "../../gladiators/gladiatorTypes.js";
import type { BattlePoint, BattleTeamId } from "../battleTypes.js";
import {
  ARENA_MAX_X,
  ARENA_MAX_Y,
  ARENA_MIN_X,
  ARENA_MIN_Y,
  HOME_SIDE_SEPARATION,
} from "./constants.js";
import { clamp } from "./math.js";

export function clampPoint(point: BattlePoint): BattlePoint {
  return {
    x: clamp(point.x, ARENA_MIN_X, ARENA_MAX_X),
    y: clamp(point.y, ARENA_MIN_Y, ARENA_MAX_Y),
  };
}

export function createStartPositions(
  gladiators: readonly GladiatorClass[],
  teams: Record<string, BattleTeamId>,
  requestedStartPositions?: Record<string, BattlePoint>,
): Record<string, BattlePoint> {
  const leftMembers = gladiators.filter((gladiator) => teams[gladiator.id] === "left");
  const rightMembers = gladiators.filter((gladiator) => teams[gladiator.id] === "right");
  const applyRequestedPositions = (
    positions: Record<string, BattlePoint>,
  ): Record<string, BattlePoint> => {
    if (!requestedStartPositions) {
      return positions;
    }

    const next = { ...positions };
    for (const gladiator of gladiators) {
      const requested = requestedStartPositions[gladiator.id];
      if (requested) {
        next[gladiator.id] = clampPoint(requested);
      }
    }

    return next;
  };

  if (leftMembers.length === 1 && rightMembers.length === 1) {
    const left = leftMembers[0]!;
    const right = rightMembers[0]!;

    return applyRequestedPositions({
      [left.id]: { x: 0.24, y: 0.74 },
      [right.id]: { x: 0.76, y: 0.42 },
    });
  }

  const positions: Record<string, BattlePoint> = {};

  const placeTeam = (members: readonly GladiatorClass[], baseX: number): void => {
    if (members.length === 0) {
      return;
    }

    if (members.length === 1) {
      positions[members[0]!.id] = clampPoint({ x: baseX, y: 0.58 });
      return;
    }

    const minY = 0.26;
    const maxY = 0.9;

    members.forEach((gladiator, index) => {
      const t = index / (members.length - 1);
      const lateralWobble = (index % 2 === 0 ? -1 : 1) * 0.07;

      positions[gladiator.id] = clampPoint({
        x: baseX + lateralWobble,
        y: minY + t * (maxY - minY),
      });
    });
  };

  placeTeam(leftMembers, 0.24);
  placeTeam(rightMembers, 0.76);

  return applyRequestedPositions(positions);
}

export function getSideSign(teams: Record<string, BattleTeamId>, attackerId: string): number {
  return teams[attackerId] === "left" ? -1 : 1;
}

export function keepPointOnHomeSide(
  teams: Record<string, BattleTeamId>,
  fighterId: string,
  point: BattlePoint,
  targetPoint: BattlePoint,
): BattlePoint {
  const side = getSideSign(teams, fighterId);
  const minSideOffset = HOME_SIDE_SEPARATION;
  const sideOffset = (point.x - targetPoint.x) * side;

  if (sideOffset >= minSideOffset) {
    return point;
  }

  return clampPoint({
    ...point,
    x: targetPoint.x + side * Math.max(minSideOffset, Math.abs(point.x - targetPoint.x)),
  });
}
