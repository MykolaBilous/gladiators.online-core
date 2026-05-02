import type { BattleActionType, BattleNetTrap } from "../battleTypes.js";
import type { FighterBrain, PlannedAction } from "../battleSimulatorTypes.js";
import {
  chooseAttack,
  getJavelinAttack,
  getNetAttack,
  isEnemyDangerouslyClose,
  shouldRushForTactic,
  shouldUseNet,
} from "./ai.js";
import type { BattleActionPlannerContext } from "./actionPlannerTypes.js";
import {
  estimateNextDecisionDelay,
  restBrain,
} from "./actionDecisions.js";
import {
  JAVELIN_ATTACK_CSS_CLASS,
} from "./constants.js";
import {
  createEffectiveFighters,
  getEnergyState,
  snapshotFatigue,
  spendActionEnergy,
  spendMovementEnergy,
} from "./energy.js";
import { getDistance, isVelesGladiator } from "./math.js";
import { createMovement, getFighterPosition } from "./movement.js";
import { estimateImpactDelay } from "./outcome.js";
import { randomBetween } from "./random.js";
import { getRuntime } from "./runtime.js";

export function planBrainMovement(
  context: BattleActionPlannerContext,
  brain: FighterBrain,
  targetId: string,
  timeMs: number,
  actionType: "move" | "recover",
): void {
  const { fighters, energyStates, currentHp, motions, teams, fighterIds, actions } = context;
  const effectiveFighters = createEffectiveFighters(fighters, energyStates, timeMs, currentHp);
  const fighter = getRuntime(effectiveFighters, brain.id);
  const ownState = getEnergyState(energyStates, brain.id);
  const rush = actionType === "move" && shouldRushForTactic(brain.tactic, ownState, false);
  const ownPosition = getFighterPosition(motions, brain.id, timeMs);
  const targetPosition = getFighterPosition(motions, targetId, timeMs);
  const targetBrain = context.brains.find((candidate) => candidate.id === targetId);
  const javelinAttack = getJavelinAttack(brain.gladiator);
  const javelinReady = Boolean(javelinAttack) && brain.javelinsLeft > 0;
  const dangerousClose = targetBrain
    ? isEnemyDangerouslyClose(getDistance(ownPosition, targetPosition), targetBrain.gladiator)
    : false;
  brain.usingShortSword = isVelesGladiator(brain.gladiator)
    ? brain.javelinsLeft <= 0 || dangerousClose
    : false;
  const setupAttack =
    actionType === "move"
      ? javelinReady && !brain.usingShortSword && javelinAttack
        ? javelinAttack
        : chooseAttack(brain.gladiator, false, getDistance(ownPosition, targetPosition))
      : null;
  const movementTactic =
    setupAttack?.cssClass === JAVELIN_ATTACK_CSS_CLASS ? "counter" : brain.tactic;
  const movement = createMovement(
    teams,
    brain.id,
    targetId,
    actionType,
    effectiveFighters,
    motions,
    context.motionTracks,
    fighterIds.filter((fighterId) => !context.isDefeated(fighterId)),
    timeMs,
    rush,
    movementTactic,
    setupAttack?.reach,
  );

  spendMovementEnergy(
    getRuntime(fighters, brain.id),
    ownState,
    getDistance(movement.attackerFrom, movement.attackerTo),
    movement.rush,
    timeMs,
  );

  if (actionType === "recover") {
    restBrain(context, brain, fighter, timeMs);
    brain.nextDecisionMs = Math.max(
      brain.nextDecisionMs,
      timeMs + movement.durationMs + randomBetween(260, 640),
    );
  } else {
    brain.nextDecisionMs =
      timeMs +
      movement.durationMs +
      estimateNextDecisionDelay(fighter, ownState, actionType, brain.tactic);
  }

  actions.push({
    index: actions.length,
    timeMs,
    attackerId: brain.id,
    defenderId: targetId,
    attackName: "",
    attackCssClass: "",
    actionType,
    outcome: "miss",
    critical: false,
    damage: 0,
    defenderHp: context.getDefenderHp(targetId),
    movement,
    impactDelayMs: 0,
    fatigue: snapshotFatigue(fighterIds, energyStates, timeMs),
    decisions: context.createDecisions(),
  });
}

export function planBrainAction(
  context: BattleActionPlannerContext,
  brain: FighterBrain,
  targetId: string,
  timeMs: number,
): void {
  const {
    fighters,
    energyStates,
    currentHp,
    motions,
    teams,
    fighterIds,
    actions,
    pendingResolutions,
    traps,
  } = context;
  const effectiveFighters = createEffectiveFighters(fighters, energyStates, timeMs, currentHp);
  const attacker = getRuntime(effectiveFighters, brain.id);
  const ownState = getEnergyState(energyStates, brain.id);
  const defenderTrapped = context.isTrapped(targetId, timeMs);
  const targetTrap = traps.get(targetId);
  const forcedRush = defenderTrapped && targetTrap?.trapperId === brain.id;
  const netAttack = getNetAttack(brain.gladiator);
  const ownPosition = getFighterPosition(motions, brain.id, timeMs);
  const targetPosition = getFighterPosition(motions, targetId, timeMs);
  const currentDistance = getDistance(ownPosition, targetPosition);
  const targetBrain = context.brains.find((candidate) => candidate.id === targetId);
  const javelinAttack = getJavelinAttack(brain.gladiator);
  const dangerousClose = targetBrain
    ? isEnemyDangerouslyClose(currentDistance, targetBrain.gladiator)
    : false;
  brain.usingShortSword = isVelesGladiator(brain.gladiator)
    ? brain.javelinsLeft <= 0 || dangerousClose
    : false;
  const shouldThrowJavelin =
    Boolean(javelinAttack) &&
    brain.javelinsLeft > 0 &&
    !brain.usingShortSword;
  const shouldThrowNet =
    Boolean(netAttack) &&
    !brain.netThrown &&
    !defenderTrapped &&
    shouldUseNet(brain.tactic, ownState);
  const actionType: BattleActionType =
    shouldThrowJavelin && javelinAttack
      ? "javelin"
      : shouldThrowNet && netAttack
        ? "net"
        : "strike";
  const attack =
    actionType === "javelin" && javelinAttack
      ? javelinAttack
      : actionType === "net" && netAttack
      ? netAttack
      : chooseAttack(brain.gladiator, false, currentDistance);
  const rush = actionType === "javelin" ? false : shouldRushForTactic(brain.tactic, ownState, forcedRush);
  const movementTactic = actionType === "javelin" ? "counter" : brain.tactic;
  const movement = createMovement(
    teams,
    brain.id,
    targetId,
    actionType,
    effectiveFighters,
    motions,
    context.motionTracks,
    fighterIds.filter((fighterId) => !context.isDefeated(fighterId)),
    timeMs,
    rush,
    movementTactic,
    attack.reach,
  );
  const impactDelayMs = estimateImpactDelay(attacker, actionType, rush);
  const impactTimeMs = timeMs + movement.durationMs + impactDelayMs;
  const netTrap: BattleNetTrap | undefined =
    actionType === "net"
      ? {
          escaped: true,
          durationMs: 0,
          releaseTimeMs: impactTimeMs,
        }
      : undefined;

  spendMovementEnergy(
    getRuntime(fighters, brain.id),
    ownState,
    getDistance(movement.attackerFrom, movement.attackerTo),
    movement.rush,
    timeMs,
  );
  spendActionEnergy(getRuntime(fighters, brain.id), ownState, actionType, false, timeMs);

  if (actionType === "net") {
    brain.netThrown = true;
  }

  if (actionType === "javelin") {
    brain.javelinsLeft = Math.max(0, brain.javelinsLeft - 1);
    brain.usingShortSword = brain.javelinsLeft <= 0;
  }

  const action: PlannedAction = {
    index: actions.length,
    timeMs,
    attackerId: brain.id,
    defenderId: targetId,
    attackName: attack.name,
    attackCssClass: attack.cssClass,
    actionType,
    outcome: "miss",
    critical: false,
    damage: 0,
    defenderHp: context.getDefenderHp(targetId),
    movement,
    impactDelayMs,
    fatigue: snapshotFatigue(fighterIds, energyStates, timeMs),
    decisions: context.createDecisions(),
    netTrap,
  };

  actions.push(action);
  pendingResolutions.push({ action, reach: attack.reach });

  brain.nextDecisionMs =
    impactTimeMs + estimateNextDecisionDelay(attacker, ownState, actionType, brain.tactic);
}
