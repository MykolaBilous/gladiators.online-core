import { metersToArenaDistance } from "../../config/arenaScale.js";
import type { GladiatorAttack, GladiatorClass } from "../../gladiators/gladiatorTypes.js";
import type {
  BattleDecisionSnapshot,
  BattleFighterRuntime,
  BattleTactic,
} from "../battleTypes.js";
import type { AttackReach, FighterEnergyState } from "../battleSimulatorTypes.js";
import {
  JAVELIN_ATTACK_CSS_CLASS,
  JAVELIN_STARTING_COUNT,
  MIN_REACH_WIDTH,
  NET_ATTACK_CSS_CLASS,
} from "./constants.js";
import { isWinded } from "./energy.js";
import { clamp, isProjectileAttack, isVelesGladiator } from "./math.js";
import { randomBetween, randomUnit } from "./random.js";
import {
  getReachEnvelope,
  getReachGap,
  isDistanceInReach,
  normalizeReach,
} from "./reach.js";

export function createDecisionSnapshot(
  fighterId: string,
  tactic: BattleTactic,
  state: FighterEnergyState,
): BattleDecisionSnapshot {
  return {
    fighterId,
    tactic,
    energyPercent: Math.round(clamp((state.energy / state.maxEnergy) * 100, 0, 100)),
  };
}

export function chooseTactic(
  fighter: BattleFighterRuntime,
  opponent: BattleFighterRuntime,
  state: FighterEnergyState,
  opponentState: FighterEnergyState,
  timeMs: number,
): BattleTactic {
  const energyRatio = clamp(state.energy / state.maxEnergy, 0, 1);
  const opponentEnergyRatio = clamp(opponentState.energy / opponentState.maxEnergy, 0, 1);
  const winded = isWinded(state, timeMs);
  const opponentWinded = isWinded(opponentState, timeMs);
  const staminaEdge = energyRatio - opponentEnergyRatio;
  const offenseEdge =
    fighter.attack + fighter.mobility * 0.42 - (opponent.defense + opponent.mobility * 0.24);
  const counterTools =
    fighter.dexterity / 150 + fighter.defense / 260 + fighter.endurance / 520;
  const scores: Record<BattleTactic, number> = {
    press:
      0.14 +
      fighter.aggression * 0.2 +
      energyRatio * 0.5 +
      Math.max(staminaEdge, 0) * 0.45 +
      offenseEdge / 230 +
      (opponentWinded ? 0.42 : 0),
    balanced:
      0.56 +
      energyRatio * 0.18 -
      Math.abs(energyRatio - 0.58) * 0.24 +
      fighter.focus * 0.08,
    counter:
      0.1 +
      counterTools +
      (opponent.aggression - 1) * 0.18 +
      Math.max(-staminaEdge, 0) * 0.2 +
      (energyRatio < 0.45 ? 0.14 : 0),
    recover:
      0.02 +
      (1 - energyRatio) * 1.08 +
      (winded ? 0.86 : 0) -
      Math.max(staminaEdge, 0) * 0.42,
  };

  let bestTactic: BattleTactic = "balanced";
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const [tactic, score] of Object.entries(scores) as [BattleTactic, number][]) {
    const noisyScore = score + randomBetween(-0.13, 0.13);

    if (noisyScore > bestScore) {
      bestTactic = tactic;
      bestScore = noisyScore;
    }
  }

  if (winded && bestTactic === "press") {
    return energyRatio < 0.24 ? "recover" : "counter";
  }

  return bestTactic;
}

export function shouldRushForTactic(
  tactic: BattleTactic,
  state: FighterEnergyState,
  forcedRush: boolean,
): boolean {
  const energyRatio = clamp(state.energy / state.maxEnergy, 0, 1);

  if (forcedRush) {
    return energyRatio > 0.18;
  }

  if (tactic === "press") {
    return energyRatio > 0.42 && randomUnit() < 0.72;
  }

  if (tactic === "balanced") {
    return energyRatio > 0.58 && randomUnit() < 0.24;
  }

  return false;
}

export function shouldUseNet(
  tactic: BattleTactic,
  energyState: FighterEnergyState,
): boolean {
  const energyRatio = clamp(energyState.energy / energyState.maxEnergy, 0, 1);

  if (energyRatio < 0.24) {
    return false;
  }

  const tacticBonus = tactic === "press" ? 0.18 : tactic === "counter" ? 0.08 : tactic === "recover" ? -0.2 : 0;
  const chance = clamp(
    0.16 + tacticBonus + (energyRatio - 0.5) * 0.18,
    0.04,
    0.58,
  );

  return randomUnit() < chance;
}

export function chooseAttack(
  gladiator: GladiatorClass,
  allowNet = false,
  currentDistance?: number,
): GladiatorClass["attacks"][number] {
  const attacks = allowNet
    ? gladiator.attacks
    : gladiator.attacks.filter((attack) => !isProjectileAttack(attack));
  const attackPool = attacks.length > 0 ? attacks : gladiator.attacks;

  if (typeof currentDistance === "number") {
    let bestAttack = attackPool[0]!;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const attack of attackPool) {
      const reach = normalizeReach(attack.reach);
      const reachGap = getReachGap(currentDistance, reach);
      const centeredness =
        1 -
        clamp(
          Math.abs(currentDistance - reach.preferred) / Math.max(reach.max - reach.min, MIN_REACH_WIDTH),
          0,
          1,
        );
      const inReachBonus = isDistanceInReach(currentDistance, reach) ? 1.2 : 0;
      const reachWidthBonus = (reach.max - reach.min) * 0.35;
      const score =
        inReachBonus +
        centeredness * 0.32 +
        reachWidthBonus -
        reachGap * 2.8 +
        randomBetween(-0.18, 0.18);

      if (score > bestScore) {
        bestAttack = attack;
        bestScore = score;
      }
    }

    return bestAttack;
  }

  return attackPool[Math.floor(randomUnit() * attackPool.length)]!;
}

export function getNetAttack(gladiator: GladiatorClass): GladiatorClass["attacks"][number] | null {
  return gladiator.attacks.find((attack) => attack.cssClass === NET_ATTACK_CSS_CLASS) ?? null;
}

export function getJavelinAttack(gladiator: GladiatorClass): GladiatorClass["attacks"][number] | null {
  return gladiator.attacks.find((attack) => attack.cssClass === JAVELIN_ATTACK_CSS_CLASS) ?? null;
}

export function getCloseCombatAttacks(gladiator: GladiatorClass): GladiatorAttack[] {
  return gladiator.attacks.filter((attack) => !isProjectileAttack(attack));
}

export function getCloseCombatReach(gladiator: GladiatorClass): AttackReach {
  return getReachEnvelope(getCloseCombatAttacks(gladiator));
}

export function getStartingJavelinCount(gladiator: GladiatorClass): number {
  return isVelesGladiator(gladiator) ? JAVELIN_STARTING_COUNT : 0;
}
export function isEnemyDangerouslyClose(distance: number, enemy: GladiatorClass): boolean {
  const enemyReach = normalizeReach(getCloseCombatReach(enemy));

  return distance <= enemyReach.max + metersToArenaDistance(0.14);
}
