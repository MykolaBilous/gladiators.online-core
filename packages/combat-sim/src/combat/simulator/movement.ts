import {
  ARENA_STANDARD_STEP_DISTANCE,
  metersToArenaDistance,
} from "../../config/arenaScale.js";
import type {
  BattleActionType,
  BattleFighterRuntime,
  BattleMovement,
  BattlePoint,
  BattleTactic,
  BattleTeamId,
} from "../battleTypes.js";
import type { AttackReach, FighterMotionState } from "../battleSimulatorTypes.js";
import {
  LATERAL_ALIGNMENT_DISTANCE,
  MAX_STEADY_STEP,
  MIN_MOVEMENT_DISTANCE,
  MIN_STEADY_STEP,
  STEP_DURATION_MS,
} from "./constants.js";
import { clamp, clonePoint, getDistance } from "./math.js";
import {
  clampPoint,
  getSideSign,
  keepPointOnHomeSide,
} from "./movementGeometry.js";
import { getFighterPosition } from "./motionState.js";
import { randomBetween } from "./random.js";
import {
  chooseReachDistance,
  getDefaultReach,
  getReachGap,
  isDistanceInReach,
  normalizeReach,
} from "./reach.js";
import { getRuntime } from "./runtime.js";

export {
  clampPoint,
  createStartPositions,
  getSideSign,
  keepPointOnHomeSide,
} from "./movementGeometry.js";
export {
  createMotionStates,
  getFighterPosition,
  getMotionPosition,
  interpolatePoint,
} from "./motionState.js";

export function getSteadyStepDistance(
  fighter: BattleFighterRuntime,
  actionType: BattleActionType,
  rush: boolean,
): number {
  const dexterityRatio = clamp((fighter.dexterity - 35) / 75, 0, 1);
  const baseStep = ARENA_STANDARD_STEP_DISTANCE * (0.92 + dexterityRatio * 0.16);
  const actionFactor =
    actionType === "recover"
      ? 0.86
      : actionType === "net"
        ? 0.96
        : actionType === "javelin"
          ? 0.92
          : actionType === "strike"
            ? 1.04
            : 1;
  const rushFactor = rush ? 1.28 : 1;

  return clamp(baseStep * actionFactor * rushFactor, MIN_STEADY_STEP, MAX_STEADY_STEP);
}

function limitPointToSteadyStep(
  from: BattlePoint,
  to: BattlePoint,
  stepDistance: number,
): BattlePoint {
  const distance = getDistance(from, to);

  if (distance <= stepDistance || distance <= 0.001) {
    return to;
  }

  const progress = stepDistance / distance;

  return clampPoint({
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress,
  });
}

function createAttackerPointNearTarget(
  teams: Record<string, BattleTeamId>,
  attackerId: string,
  attackerFrom: BattlePoint,
  targetPoint: BattlePoint,
  actionType: BattleActionType,
  tactic: BattleTactic,
  reach = getDefaultReach(actionType),
): BattlePoint {
  const normalizedReach = normalizeReach(reach);
  const homeSign = getSideSign(teams, attackerId);
  const currentSideSign =
    Math.abs(attackerFrom.x - targetPoint.x) > LATERAL_ALIGNMENT_DISTANCE
      ? attackerFrom.x < targetPoint.x
        ? -1
        : 1
      : homeSign;
  const sign = currentSideSign === homeSign ? currentSideSign : homeSign;
  const distance = chooseReachDistance(normalizedReach, tactic);
  const maxLateralDrift = Math.min(
    distance * 0.34,
    (normalizedReach.max - normalizedReach.min) * 0.55 + LATERAL_ALIGNMENT_DISTANCE,
  );
  const lateralDrift =
    tactic === "press"
      ? randomBetween(-maxLateralDrift * 0.42, maxLateralDrift * 0.42)
      : tactic === "counter"
        ? randomBetween(-maxLateralDrift, maxLateralDrift)
        : randomBetween(-maxLateralDrift * 0.68, maxLateralDrift * 0.68);
  const signs = [sign];
  const lateralOptions = [lateralDrift, -lateralDrift, 0];
  let bestPoint: BattlePoint | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const side of signs) {
    for (const lateral of lateralOptions) {
      const forward = Math.sqrt(Math.max(0, distance * distance - lateral * lateral));
      const point = clampPoint({
        x: targetPoint.x + side * forward,
        y: targetPoint.y + lateral,
      });
      const pointDistance = getDistance(point, targetPoint);
      const reachGap = getReachGap(pointDistance, normalizedReach);
      const score =
        reachGap * 8 +
        Math.abs(pointDistance - distance) +
        (side === sign ? 0 : metersToArenaDistance(0.18)) +
        (lateral === lateralDrift ? 0 : metersToArenaDistance(0.07));

      if (score < bestScore) {
        bestPoint = point;
        bestScore = score;
      }
    }
  }

  if (bestPoint && isDistanceInReach(getDistance(bestPoint, targetPoint), normalizedReach)) {
    return bestPoint;
  }

  const fallbackDirection = bestPoint
    ? {
        x: bestPoint.x - targetPoint.x,
        y: bestPoint.y - targetPoint.y,
      }
    : { x: sign, y: 0 };
  const fallbackDistance = Math.hypot(fallbackDirection.x, fallbackDirection.y);
  const direction =
    fallbackDistance > 0.001
      ? { x: fallbackDirection.x / fallbackDistance, y: fallbackDirection.y / fallbackDistance }
      : { x: sign, y: 0 };

  return keepPointOnHomeSide(
    teams,
    attackerId,
    clampPoint({
      x: targetPoint.x + direction.x * distance,
      y: targetPoint.y + direction.y * distance,
    }),
    targetPoint,
  );
}

function createIndependentMovePoint(
  teams: Record<string, BattleTeamId>,
  fighterId: string,
  fighterFrom: BattlePoint,
  targetPoint: BattlePoint,
  tactic: BattleTactic,
  recovering: boolean,
  intendedReach?: AttackReach,
): BattlePoint {
  if (tactic === "press" && !recovering) {
    return createAttackerPointNearTarget(
      teams,
      fighterId,
      fighterFrom,
      targetPoint,
      "strike",
      tactic,
      intendedReach,
    );
  }

  const fallbackSign = getSideSign(teams, fighterId);
  const dx = fighterFrom.x - targetPoint.x;
  const dy = fighterFrom.y - targetPoint.y;
  const distance = Math.hypot(dx, dy);
  const direction =
    distance > 0.001
      ? { x: dx / distance, y: dy / distance }
      : { x: fallbackSign, y: randomBetween(-metersToArenaDistance(1), metersToArenaDistance(1)) };
  const desiredDistance = recovering
    ? randomBetween(metersToArenaDistance(2.1), metersToArenaDistance(2.9))
    : intendedReach
      ? chooseReachDistance(intendedReach, tactic)
      : tactic === "counter"
        ? randomBetween(metersToArenaDistance(1.75), metersToArenaDistance(2.5))
        : randomBetween(metersToArenaDistance(1.25), metersToArenaDistance(1.9));
  const tangent = { x: -direction.y, y: direction.x };
  const circleLimit =
    intendedReach && !recovering
      ? Math.min(
          metersToArenaDistance(0.42),
          Math.max(MIN_MOVEMENT_DISTANCE, (normalizeReach(intendedReach).max - desiredDistance) * 0.55),
        )
      : metersToArenaDistance(0.7);
  const circleStep = recovering
    ? randomBetween(-metersToArenaDistance(0.35), metersToArenaDistance(0.35))
    : randomBetween(-circleLimit, circleLimit);
  let next = keepPointOnHomeSide(
    teams,
    fighterId,
    clampPoint({
      x: targetPoint.x + direction.x * desiredDistance + tangent.x * circleStep,
      y: targetPoint.y + direction.y * desiredDistance + tangent.y * circleStep,
    }),
    targetPoint,
  );

  if (getDistance(fighterFrom, next) < metersToArenaDistance(0.25) && (!intendedReach || recovering)) {
    next = keepPointOnHomeSide(
      teams,
      fighterId,
      clampPoint({
        x:
          next.x +
          tangent.x * randomBetween(metersToArenaDistance(0.35), metersToArenaDistance(0.7)) +
          direction.x * randomBetween(-metersToArenaDistance(0.2), metersToArenaDistance(0.2)),
        y:
          next.y +
          tangent.y * randomBetween(metersToArenaDistance(0.35), metersToArenaDistance(0.7)) +
          direction.y * randomBetween(-metersToArenaDistance(0.2), metersToArenaDistance(0.2)),
      }),
      targetPoint,
    );
  }

  return next;
}

function estimateMoveDuration(
  distance: number,
  fighter: BattleFighterRuntime,
  rush: boolean,
): number {
  if (distance < MIN_MOVEMENT_DISTANCE) {
    return 0;
  }

  const speedFactor = clamp(82 / fighter.mobility, 0.62, 1.76);
  const enduranceFactor = clamp(
    1.12 - fighter.endurance / 360 - (fighter.stamina - 1) * 0.16,
    0.78,
    1.18,
  );
  const rushFactor = rush ? 0.84 : 1;

  return (
    460 +
    (distance / ARENA_STANDARD_STEP_DISTANCE) *
      STEP_DURATION_MS *
      speedFactor *
      enduranceFactor *
      rushFactor
  );
}

export function createMovement(
  teams: Record<string, BattleTeamId>,
  attackerId: string,
  defenderId: string,
  actionType: BattleActionType,
  fighters: Record<string, BattleFighterRuntime>,
  motions: Map<string, FighterMotionState>,
  timeMs: number,
  rush: boolean,
  attackerTactic: BattleTactic,
  intendedReach?: AttackReach,
): BattleMovement {
  const attackerFrom = getFighterPosition(motions, attackerId, timeMs);
  const defenderFrom = getFighterPosition(motions, defenderId, timeMs);

  if (actionType === "javelin") {
    motions.set(attackerId, {
      from: clonePoint(attackerFrom),
      to: clonePoint(attackerFrom),
      startMs: timeMs,
      endMs: timeMs,
    });

    return {
      attackerFrom,
      defenderFrom,
      attackerTo: attackerFrom,
      defenderTo: defenderFrom,
      durationMs: 0,
      attackerDurationMs: 0,
      defenderDurationMs: 0,
      rush: false,
      defenderRush: false,
      distance: getDistance(attackerFrom, defenderFrom),
    };
  }

  const attacker = getRuntime(fighters, attackerId);
  const plannedAttackerTo =
    actionType === "move" || actionType === "recover"
      ? createIndependentMovePoint(
          teams,
          attackerId,
          attackerFrom,
          defenderFrom,
          attackerTactic,
          actionType === "recover",
          intendedReach,
        )
      : createAttackerPointNearTarget(
          teams,
          attackerId,
          attackerFrom,
          defenderFrom,
          actionType,
          attackerTactic,
          intendedReach,
        );
  const attackerTo = limitPointToSteadyStep(
    attackerFrom,
    plannedAttackerTo,
    getSteadyStepDistance(attacker, actionType, rush),
  );
  const attackerDistance = getDistance(attackerFrom, attackerTo);
  const attackerDuration = estimateMoveDuration(attackerDistance, attacker, rush);
  const maxDuration =
    actionType === "net"
      ? 2_450
      : actionType === "recover"
        ? 1_850
        : rush
          ? 1_650
          : 2_050;
  const attackerDurationMs = Math.round(clamp(attackerDuration, 0, maxDuration));

  motions.set(attackerId, {
    from: clonePoint(attackerFrom),
    to: clonePoint(attackerTo),
    startMs: timeMs,
    endMs: timeMs + attackerDurationMs,
  });

  return {
    attackerFrom,
    defenderFrom,
    attackerTo,
    defenderTo: defenderFrom,
    durationMs: attackerDurationMs,
    attackerDurationMs,
    defenderDurationMs: 0,
    rush,
    defenderRush: false,
    distance: getDistance(attackerTo, defenderFrom),
  };
}
