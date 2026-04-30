import type { GladiatorAttack } from "../../gladiators/gladiatorTypes.js";
import type { BattleActionType, BattleTactic } from "../battleTypes.js";
import type { AttackReach } from "../battleSimulatorTypes.js";
import {
  DEFAULT_JAVELIN_REACH,
  DEFAULT_NET_REACH,
  DEFAULT_STRIKE_REACH,
  MAX_REACH_DISTANCE,
  MIN_REACH_WIDTH,
  REACH_TOLERANCE,
} from "./constants.js";
import { clamp } from "./math.js";
import { randomBetween } from "./random.js";

export function normalizeReach(reach: AttackReach): AttackReach {
  const max = clamp(Math.max(reach.preferred, reach.max), MIN_REACH_WIDTH, MAX_REACH_DISTANCE);
  const min = clamp(Math.min(reach.min, max), 0, max);

  return {
    min,
    max,
    preferred: clamp(reach.preferred, Math.max(min, MIN_REACH_WIDTH), max),
  };
}

export function isDistanceInReach(distance: number, reach: AttackReach): boolean {
  const normalized = normalizeReach(reach);

  return (
    distance >= normalized.min - REACH_TOLERANCE &&
    distance <= normalized.max + REACH_TOLERANCE
  );
}

export function getReachGap(distance: number, reach: AttackReach): number {
  const normalized = normalizeReach(reach);

  if (distance > normalized.max) {
    return distance - normalized.max;
  }

  if (distance < normalized.min) {
    return normalized.min - distance;
  }

  return 0;
}

export function canCloseToReach(distance: number, reach: AttackReach, stepDistance: number): boolean {
  return distance <= normalizeReach(reach).max + stepDistance;
}

export function chooseReachDistance(reach: AttackReach, tactic: BattleTactic): number {
  const normalized = normalizeReach(reach);
  const closeButUsable = Math.max(normalized.min, normalized.preferred * 0.62);
  const strongLower = Math.max(closeButUsable, normalized.preferred * 0.84);

  if (tactic === "press") {
    return randomBetween(closeButUsable, normalized.preferred);
  }

  if (tactic === "counter") {
    return randomBetween(strongLower, normalized.max);
  }

  return randomBetween(strongLower, normalized.preferred);
}

export function getReachEnvelope(attacks: readonly GladiatorAttack[]): AttackReach {
  if (attacks.length === 0) {
    return DEFAULT_STRIKE_REACH;
  }

  const normalized = attacks.map((attack) => normalizeReach(attack.reach));
  const min = Math.min(...normalized.map((reach) => reach.min));
  const max = Math.max(...normalized.map((reach) => reach.max));
  const preferred = normalized.reduce((sum, reach) => sum + reach.preferred, 0) / normalized.length;

  return {
    min,
    max,
    preferred: clamp(preferred, min, max),
  };
}

export function getDefaultReach(actionType: BattleActionType): AttackReach {
  if (actionType === "net") {
    return DEFAULT_NET_REACH;
  }

  if (actionType === "javelin") {
    return DEFAULT_JAVELIN_REACH;
  }

  return DEFAULT_STRIKE_REACH;
}
