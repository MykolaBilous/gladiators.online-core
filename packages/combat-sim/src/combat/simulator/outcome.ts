import type { BattleEvent, BattleFighterRuntime, BattleNetTrap, BattleOutcome, BattleTeamId, BattleActionType } from "../battleTypes.js";
import type { FighterBrain, TimedBattleAction } from "../battleSimulatorTypes.js";
import { JAVELIN_ATTACK_CSS_CLASS } from "./constants.js";
import { clamp, isVelesGladiator } from "./math.js";
import { randomBetween, randomUnit } from "./random.js";

export function getActionResolutionTimeMs(action: TimedBattleAction): number {
  const impactDelay =
    action.actionType === "strike" || action.actionType === "net" || action.actionType === "javelin"
      ? action.impactDelayMs
      : 0;

  return action.timeMs + action.movement.durationMs + impactDelay;
}

export function compareActionResolution(a: TimedBattleAction, b: TimedBattleAction): number {
  return getActionResolutionTimeMs(a) - getActionResolutionTimeMs(b) || a.index - b.index;
}
export function estimateImpactDelay(
  attacker: BattleFighterRuntime,
  actionType: BattleActionType,
  rush: boolean,
): number {
  const baseDelay =
    actionType === "net"
      ? randomBetween(680, 900)
      : actionType === "javelin"
        ? randomBetween(1_050, 1_850)
        : randomBetween(460, 720);
  const quickness =
    attacker.dexterity * 0.52 +
    attacker.speed * 0.28 +
    attacker.endurance * 0.12 +
    attacker.focus * 12;
  const rushFactor = rush && actionType !== "javelin" ? 0.96 : 1;
  const minDelay = actionType === "javelin" ? 820 : 320;
  const maxDelay = actionType === "javelin" ? 1_900 : 920;

  return Math.round(clamp((baseDelay - (quickness - 62) * 1.55) * rushFactor, minDelay, maxDelay));
}

export function getCriticalChance(attacker: BattleFighterRuntime): number {
  return clamp(
    0.08 + attacker.focus * 0.045 + attacker.attack / 950 + attacker.dexterity / 1_100,
    0.1,
    0.3,
  );
}

export function getAttackDamageMultiplier(attackCssClass: string): number {
  if (attackCssClass === "attack-shield-bash") {
    return 0.84;
  }

  if (attackCssClass === "attack-trident-thrust") {
    return 1.08;
  }

  if (attackCssClass === JAVELIN_ATTACK_CSS_CLASS) {
    return 1.14;
  }

  if (attackCssClass === "attack-veles-sword") {
    return 0.78;
  }

  return 1;
}

export function calculateStrikeDamage(
  attacker: BattleFighterRuntime,
  defender: BattleFighterRuntime,
  attackCssClass: string,
  critical: boolean,
  defenderTrapped: boolean,
): number {
  const attackPressure =
    attacker.attack * 0.16 +
    attacker.dexterity * 0.025 +
    attacker.mobility * 0.018 +
    attacker.focus * 2.2;
  const defenseSoak = defender.defense * 0.09 + defender.endurance * 0.032;
  const trappedBonus = defenderTrapped ? 2.4 : 0;
  const rawDamage =
    (5.2 + attackPressure - defenseSoak + trappedBonus) *
    getAttackDamageMultiplier(attackCssClass);
  const criticalMultiplier = critical ? randomBetween(1.45, 1.75) : 1;
  const maxDamage = defender.maxHp * (critical ? 0.32 : 0.24);

  return Math.round(
    clamp(rawDamage * criticalMultiplier * randomBetween(0.84, 1.2), critical ? 4 : 2, maxDamage),
  );
}

export interface DefenseProfile {
  canBlock: boolean;
  blockMultiplier: number;
}

export function planOutcome(
  attacker: BattleFighterRuntime,
  defender: BattleFighterRuntime,
  defenderTrapped = false,
  defenseProfile: DefenseProfile = { canBlock: true, blockMultiplier: 1 },
): { outcome: BattleOutcome; critical: boolean } {
  if (defenderTrapped) {
    return { outcome: "hit", critical: randomUnit() < getCriticalChance(attacker) };
  }

  const hitChance = clamp(
    0.52 +
      (attacker.attack - defender.defense * 0.58) / 195 +
      (attacker.dexterity - defender.dexterity) / 330 +
      (attacker.mobility - defender.mobility) / 420,
    0.34,
    0.82,
  );

  if (randomUnit() < hitChance) {
    return { outcome: "hit", critical: randomUnit() < getCriticalChance(attacker) };
  }

  const dodgeWeight = clamp(
    0.18 +
      defender.dexterity / 165 +
      defender.endurance / 520 +
      (defender.mobility - attacker.mobility) / 340,
    0.14,
    0.74,
  );
  const blockWeight = defenseProfile.canBlock
    ? clamp(
        (0.18 +
          defender.defense / 155 +
          defender.endurance / 265 -
          attacker.dexterity / 560) *
          defenseProfile.blockMultiplier,
        0.08,
        0.78,
      )
    : 0;

  return {
    outcome:
      blockWeight > 0 && randomUnit() < blockWeight / (blockWeight + dodgeWeight)
        ? "block"
        : "miss",
    critical: false,
  };
}

export function planJavelinOutcome(
  attacker: BattleFighterRuntime,
  defender: BattleFighterRuntime,
  defenderCanBlock: boolean,
  defenderTrapped = false,
): { outcome: BattleOutcome; critical: boolean } {
  if (defenderTrapped) {
    return { outcome: "hit", critical: randomUnit() < getCriticalChance(attacker) };
  }

  const hitChance = clamp(
    0.48 +
      (attacker.attack - defender.defense * 0.36) / 210 +
      (attacker.dexterity - defender.dexterity) / 310 +
      attacker.focus * 0.055 -
      defender.mobility / 620,
    0.28,
    0.76,
  );

  if (randomUnit() < hitChance) {
    return { outcome: "hit", critical: randomUnit() < getCriticalChance(attacker) };
  }

  const dodgeWeight = clamp(
    0.24 +
      defender.dexterity / 145 +
      defender.mobility / 420 +
      defender.endurance / 560 -
      attacker.focus * 0.05,
    0.18,
    0.84,
  );
  const blockWeight = defenderCanBlock
    ? clamp(0.2 + defender.defense / 135 + defender.endurance / 360 - attacker.dexterity / 680, 0.12, 0.72)
    : 0;

  return {
    outcome:
      blockWeight > 0 && randomUnit() < blockWeight / (blockWeight + dodgeWeight)
        ? "block"
        : "miss",
    critical: false,
  };
}

export function planNetTrap(
  attacker: BattleFighterRuntime,
  defender: BattleFighterRuntime,
  timeMs: number,
): { outcome: BattleOutcome; netTrap: BattleNetTrap } {
  const evadeChance = clamp(
    0.12 +
      defender.dexterity / 230 +
      defender.endurance / 650 +
      defender.mobility / 520 +
      defender.focus * 0.05 -
      attacker.dexterity / 760 -
      attacker.focus * 0.05,
    0.16,
    0.74,
  );
  const escaped = randomUnit() < evadeChance;
  const durationMs = escaped
    ? 0
    : Math.round(
        randomBetween(4_400, 7_200) *
          clamp(1.16 + attacker.focus * 0.1 - defender.endurance / 580, 0.82, 1.32),
      );

  return {
    outcome: escaped ? "miss" : "hit",
    netTrap: {
      escaped,
      durationMs,
      releaseTimeMs: timeMs + durationMs,
    },
  };
}
export function getStrikeDefenseProfile(brain: FighterBrain | undefined): DefenseProfile {
  if (!brain) {
    return { canBlock: true, blockMultiplier: 1 };
  }

  if (!isVelesGladiator(brain.gladiator)) {
    return { canBlock: true, blockMultiplier: 1 };
  }

  if (brain.javelinsLeft > 0 && !brain.usingShortSword) {
    return { canBlock: false, blockMultiplier: 0 };
  }

  return { canBlock: true, blockMultiplier: 0.46 };
}
export function trimEventsAfterDefeat(
  events: BattleEvent[],
  teams: Record<string, BattleTeamId>,
  fighterIds: readonly string[],
): BattleEvent[] {
  const sorted = [...events].sort(compareActionResolution);
  const aliveFighters = new Set<string>(fighterIds);

  let endingEvent: BattleEvent | null = null;

  for (const event of sorted) {
    if (event.damage > 0 && event.defenderHp <= 0 && aliveFighters.has(event.defenderId)) {
      aliveFighters.delete(event.defenderId);
      const stillAliveTeams = new Set<BattleTeamId>();
      for (const fighterId of aliveFighters) {
        stillAliveTeams.add(teams[fighterId]!);
      }
      if (stillAliveTeams.size <= 1) {
        endingEvent = event;
        break;
      }
    }
  }

  if (!endingEvent) {
    return events;
  }

  const endTimeMs = getActionResolutionTimeMs(endingEvent);

  return events
    .filter(
      (event) =>
        event.index === endingEvent!.index ||
        getActionResolutionTimeMs(event) <= endTimeMs,
    )
    .map((event, index) => ({
      ...event,
      index,
    }));
}

export function getResolvedDurationMs(events: readonly BattleEvent[], fallbackDurationMs: number): number {
  if (events.length === 0) {
    return fallbackDurationMs;
  }

  return Math.max(...events.map(getActionResolutionTimeMs));
}
