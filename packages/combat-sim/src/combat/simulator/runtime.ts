import type { GladiatorClass } from "../../gladiators/gladiatorTypes.js";
import type { BattleFighterRuntime } from "../battleTypes.js";
import { clamp } from "./math.js";
import { randomBetween } from "./random.js";

export function getRuntime(
  fighters: Record<string, BattleFighterRuntime>,
  id: string,
): BattleFighterRuntime {
  const fighter = fighters[id];
  if (!fighter) {
    throw new Error(`Unknown fighter in battle plan: ${id}`);
  }
  return fighter;
}

export function createRuntime(gladiator: GladiatorClass): BattleFighterRuntime {
  const stamina = randomBetween(0.9, 1.16);
  const focus = randomBetween(0.86, 1.14);
  const aggression = randomBetween(0.78, 1.22);
  const speed = gladiator.stats.speed * randomBetween(0.9, 1.2);
  const dexterity = clamp(
    gladiator.stats.dexterity * randomBetween(0.9, 1.16) * (0.92 + focus * 0.08),
    1,
    112,
  );
  const endurance = clamp(
    gladiator.stats.endurance * randomBetween(0.92, 1.12) * stamina,
    1,
    116,
  );
  const mobility = speed * 0.5 + dexterity * 0.34 + endurance * 0.16;

  return {
    id: gladiator.id,
    name: gladiator.name,
    maxHp: gladiator.stats.hp,
    maxEnergy: Math.round(72 + endurance * 0.72 + speed * 0.12),
    recoveryRate: 7.5 + endurance / 18,
    attack: gladiator.stats.attack * randomBetween(0.9, 1.18) * focus,
    defense:
      gladiator.stats.defense *
      randomBetween(0.88, 1.18) *
      stamina *
      clamp(0.82 + endurance / 285, 0.88, 1.18),
    speed,
    dexterity,
    endurance,
    mobility,
    focus,
    stamina,
    aggression,
  };
}
