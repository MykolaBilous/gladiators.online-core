import { metersToArenaDistance } from "../../config/arenaScale.js";
import type {
  BattleActionType,
  BattleFighterRuntime,
  BattleTactic,
} from "../battleTypes.js";
import type { FighterBrain, FighterEnergyState } from "../battleSimulatorTypes.js";
import {
  getCloseCombatReach,
  getJavelinAttack,
  getNetAttack,
  isEnemyDangerouslyClose,
  shouldRushForTactic,
} from "./ai.js";
import { createEffectiveFighters, getEnergyState, isWinded } from "./energy.js";
import { clamp, getDistance, isVelesGladiator } from "./math.js";
import { getFighterPosition, getSteadyStepDistance } from "./movement.js";
import { randomBetween, randomUnit } from "./random.js";
import { canCloseToReach, getReachGap, isDistanceInReach } from "./reach.js";
import { getRuntime } from "./runtime.js";
import type { BattleActionPlannerContext } from "./actionPlannerTypes.js";

export function shouldSpendTurnRecovering(
  context: BattleActionPlannerContext,
  brain: FighterBrain,
  fighter: BattleFighterRuntime,
  timeMs: number,
): boolean {
  const state = getEnergyState(context.energyStates, brain.id);
  const energyRatio = clamp(state.energy / state.maxEnergy, 0, 1);

  if (isWinded(state, timeMs) && energyRatio < 0.42) {
    return true;
  }

  if (brain.tactic !== "recover") {
    return false;
  }

  return energyRatio < 0.68 && randomUnit() < clamp(0.35 + fighter.endurance / 260, 0.42, 0.74);
}

export function restBrain(
  context: BattleActionPlannerContext,
  brain: FighterBrain,
  fighter: BattleFighterRuntime,
  timeMs: number,
): void {
  const state = getEnergyState(context.energyStates, brain.id);
  const restMs = Math.round(
    randomBetween(850, 1_650) * clamp(1.22 - fighter.endurance / 260, 0.72, 1.18),
  );

  state.recoveryUntilMs = Math.max(state.recoveryUntilMs, timeMs + restMs);
  brain.nextDecisionMs = Math.round(timeMs + restMs * randomBetween(0.64, 0.94));
}

export function estimateNextDecisionDelay(
  fighter: BattleFighterRuntime,
  state: FighterEnergyState,
  actionType: BattleActionType,
  tactic: BattleTactic,
): number {
  const energyRatio = clamp(state.energy / state.maxEnergy, 0, 1);
  const baseDelay =
    actionType === "net"
      ? randomBetween(2_100, 3_250)
      : actionType === "javelin"
        ? randomBetween(1_650, 3_150)
        : actionType === "move"
          ? randomBetween(360, 880)
          : actionType === "recover"
            ? randomBetween(520, 1_050)
            : randomBetween(900, 1_850);
  const tacticFactor =
    tactic === "press" ? 0.82 : tactic === "counter" ? 1.08 : tactic === "recover" ? 1.32 : 1;
  const fatigueFactor = energyRatio < 0.34 ? 1.38 : energyRatio > 0.72 ? 0.88 : 1;
  const speedFactor = clamp(1.18 - fighter.dexterity / 360 - fighter.speed / 520, 0.72, 1.16);

  return Math.round(baseDelay * tacticFactor * fatigueFactor * speedFactor);
}

export function shouldAttackNow(
  context: BattleActionPlannerContext,
  brain: FighterBrain,
  targetId: string,
  timeMs: number,
): boolean {
  const { fighters, energyStates, currentHp, motions } = context;
  const effectiveFighters = createEffectiveFighters(fighters, energyStates, timeMs, currentHp);
  const fighter = getRuntime(effectiveFighters, brain.id);
  const ownState = getEnergyState(energyStates, brain.id);
  const energyRatio = clamp(ownState.energy / ownState.maxEnergy, 0, 1);
  const ownPosition = getFighterPosition(motions, brain.id, timeMs);
  const targetPosition = getFighterPosition(motions, targetId, timeMs);
  const distance = getDistance(ownPosition, targetPosition);
  const targetBrain = context.brains.find((candidate) => candidate.id === targetId);
  const netAttack = getNetAttack(brain.gladiator);
  const netReady = Boolean(netAttack) && !brain.netThrown;
  const javelinAttack = getJavelinAttack(brain.gladiator);
  const javelinReady = Boolean(javelinAttack) && brain.javelinsLeft > 0;
  const dangerousClose = targetBrain
    ? isEnemyDangerouslyClose(distance, targetBrain.gladiator)
    : false;
  const strikeReach = getCloseCombatReach(brain.gladiator);

  if (energyRatio < 0.24) {
    return false;
  }

  // A fighter who is already being targeted by an in-flight attack cannot also
  // launch their own attack at the same time (they're occupied blocking/dodging).
  // Exception: if both fighters committed to attacking within a short window
  // (≤300 ms apart) treat it as a simultaneous exchange and allow both.
  const SIMULTANEITY_WINDOW_MS = 300;
  const blockedByIncoming = context.pendingResolutions.some(
    (pending) =>
      pending.action.defenderId === brain.id &&
      (pending.action.actionType === "strike" || pending.action.actionType === "javelin") &&
      pending.action.timeMs + pending.action.movement.durationMs + pending.action.impactDelayMs >
        timeMs &&
      timeMs - pending.action.timeMs > SIMULTANEITY_WINDOW_MS,
  );
  if (blockedByIncoming) {
    return false;
  }

  brain.usingShortSword = isVelesGladiator(brain.gladiator)
    ? brain.javelinsLeft <= 0 || dangerousClose
    : false;

  if (
    javelinReady &&
    javelinAttack &&
    !brain.usingShortSword
  ) {
    return true;
  }

  if (javelinReady && !brain.usingShortSword) {
    return false;
  }

  if (
    netReady &&
    netAttack &&
    canCloseToReach(
      distance,
      netAttack.reach,
      getSteadyStepDistance(fighter, "net", shouldRushForTactic(brain.tactic, ownState, false)),
    ) &&
    randomUnit() < 0.42
  ) {
    return true;
  }

  const strikeGap = getReachGap(distance, strikeReach);
  const strikeStepDistance = getSteadyStepDistance(
    fighter,
    "strike",
    shouldRushForTactic(brain.tactic, ownState, false),
  );

  if (!canCloseToReach(distance, strikeReach, strikeStepDistance)) {
    return false;
  }

  if (context.isTrapped(targetId, timeMs)) {
    return true;
  }

  const rangeReadiness =
    isDistanceInReach(distance, strikeReach)
      ? 0.46
      : strikeGap < metersToArenaDistance(0.6)
        ? 0.24
        : 0.08;
  const tacticBonus =
    brain.tactic === "press"
      ? 0.22
      : brain.tactic === "counter"
        ? -0.08
        : brain.tactic === "recover"
          ? -0.18
          : 0;
  const chance = clamp(rangeReadiness + tacticBonus + (energyRatio - 0.5) * 0.18, 0.06, 0.72);

  return randomUnit() < chance;
}
