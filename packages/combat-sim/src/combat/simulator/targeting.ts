import { metersToArenaDistance } from "../../config/arenaScale.js";
import type { FighterBrain } from "../battleSimulatorTypes.js";
import {
  JAVELIN_ALIGNMENT_DISTANCE,
  JAVELIN_SAFE_DISTANCE,
} from "./constants.js";
import {
  getCloseCombatReach,
  getJavelinAttack,
  isEnemyDangerouslyClose,
} from "./ai.js";
import { getDistance, isVelesGladiator } from "./math.js";
import { getFighterPosition } from "./movement.js";
import { randomBetween } from "./random.js";
import { normalizeReach } from "./reach.js";
import { getEnergyState } from "./energy.js";
import { clamp } from "./math.js";
import type { BattleActionPlannerContext } from "./actionPlannerTypes.js";

function hasReadyJavelin(brain: FighterBrain): boolean {
  return (
    isVelesGladiator(brain.gladiator) &&
    Boolean(getJavelinAttack(brain.gladiator)) &&
    brain.javelinsLeft > 0
  );
}

function getNearestDangerousEnemyId(
  context: BattleActionPlannerContext,
  brain: FighterBrain,
  candidates: readonly string[],
  timeMs: number,
): string | null {
  const ownPosition = getFighterPosition(context.motions, brain.id, timeMs);
  let bestTargetId: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidateId of candidates) {
    const candidateBrain = context.getBrain(candidateId);
    if (!candidateBrain) {
      continue;
    }

    const distance = getDistance(
      ownPosition,
      getFighterPosition(context.motions, candidateId, timeMs),
    );

    if (isEnemyDangerouslyClose(distance, candidateBrain.gladiator) && distance < bestDistance) {
      bestTargetId = candidateId;
      bestDistance = distance;
    }
  }

  return bestTargetId;
}

function isEnemyPinnedByAlly(
  context: BattleActionPlannerContext,
  enemyId: string,
  spotterId: string,
  timeMs: number,
): boolean {
  const ownTeam = context.teams[spotterId];
  const enemyBrain = context.getBrain(enemyId);
  const enemyPosition = getFighterPosition(context.motions, enemyId, timeMs);

  if (
    enemyBrain?.targetId &&
    enemyBrain.targetId !== spotterId &&
    context.teams[enemyBrain.targetId] === ownTeam &&
    !context.isDefeated(enemyBrain.targetId)
  ) {
    return true;
  }

  return context.fighterIds.some((allyId) => {
    if (
      allyId === spotterId ||
      allyId === enemyId ||
      context.teams[allyId] !== ownTeam ||
      context.isDefeated(allyId)
    ) {
      return false;
    }

    const allyBrain = context.getBrain(allyId);
    const allyPosition = getFighterPosition(context.motions, allyId, timeMs);
    const allyReach = allyBrain ? normalizeReach(getCloseCombatReach(allyBrain.gladiator)).max : 0;
    const distance = getDistance(allyPosition, enemyPosition);
    const closeEnoughToHold =
      distance <= Math.max(allyReach + metersToArenaDistance(0.28), metersToArenaDistance(0.48));

    return closeEnoughToHold || (allyBrain?.targetId === enemyId && distance <= metersToArenaDistance(1.15));
  });
}

function chooseVelesJavelinTargetId(
  context: BattleActionPlannerContext,
  brain: FighterBrain,
  candidates: readonly string[],
  timeMs: number,
): string | null {
  const ownPosition = getFighterPosition(context.motions, brain.id, timeMs);
  let bestTargetId = candidates[0] ?? null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const candidateId of candidates) {
    const targetPosition = getFighterPosition(context.motions, candidateId, timeMs);
    const lateralGap = Math.abs(targetPosition.y - ownPosition.y);
    const aligned = lateralGap <= JAVELIN_ALIGNMENT_DISTANCE;
    const distance = getDistance(ownPosition, targetPosition);
    const trap = context.traps.get(candidateId);
    const ownTrapBonus =
      trap && trap.trapperId === brain.id && context.isTrapped(candidateId, timeMs) ? -0.28 : 0;
    const pinnedBonus = isEnemyPinnedByAlly(context, candidateId, brain.id, timeMs) ? -0.08 : 0;
    const alignmentBonus = aligned ? -0.22 : 0;
    const score =
      distance +
      lateralGap * 0.72 +
      alignmentBonus +
      ownTrapBonus +
      pinnedBonus +
      randomBetween(-0.018, 0.018);

    if (score < bestScore) {
      bestTargetId = candidateId;
      bestScore = score;
    }
  }

  return bestTargetId;
}

export function shouldRepositionForJavelin(
  context: BattleActionPlannerContext,
  brain: FighterBrain,
  targetId: string,
  timeMs: number,
): boolean {
  if (!hasReadyJavelin(brain)) {
    return false;
  }

  const targetBrain = context.getBrain(targetId);
  if (!targetBrain) {
    return false;
  }

  const ownPosition = getFighterPosition(context.motions, brain.id, timeMs);
  const targetPosition = getFighterPosition(context.motions, targetId, timeMs);
  const distance = getDistance(ownPosition, targetPosition);

  if (isEnemyDangerouslyClose(distance, targetBrain.gladiator)) {
    return false;
  }

  if (distance >= JAVELIN_SAFE_DISTANCE) {
    return false;
  }

  const ownState = getEnergyState(context.energyStates, brain.id);
  const energyRatio = clamp(ownState.energy / ownState.maxEnergy, 0, 1);

  return energyRatio > 0.3 && isEnemyPinnedByAlly(context, targetId, brain.id, timeMs);
}

export function chooseTargetId(
  context: BattleActionPlannerContext,
  brain: FighterBrain,
  timeMs: number,
): string | null {
  const candidates = context.getEnemyCandidateIds(brain);

  if (candidates.length === 0) {
    return null;
  }

  if (hasReadyJavelin(brain)) {
    const dangerousTargetId = getNearestDangerousEnemyId(context, brain, candidates, timeMs);
    if (dangerousTargetId) {
      return dangerousTargetId;
    }

    const javelinTargetId = chooseVelesJavelinTargetId(context, brain, candidates, timeMs);
    if (javelinTargetId) {
      return javelinTargetId;
    }
  }

  if (brain.targetId && candidates.includes(brain.targetId) && randomBetween(0, 1) > 0.22) {
    return brain.targetId;
  }

  const ownPosition = getFighterPosition(context.motions, brain.id, timeMs);
  let bestTargetId = candidates[0] ?? null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const candidateId of candidates) {
    const targetPosition = getFighterPosition(context.motions, candidateId, timeMs);
    const trap = context.traps.get(candidateId);
    const ownTrapBonus =
      trap && trap.trapperId === brain.id && context.isTrapped(candidateId, timeMs) ? -0.28 : 0;
    const score =
      getDistance(ownPosition, targetPosition) +
      ownTrapBonus +
      randomBetween(-0.08, 0.08);

    if (score < bestScore) {
      bestTargetId = candidateId;
      bestScore = score;
    }
  }

  return bestTargetId;
}
