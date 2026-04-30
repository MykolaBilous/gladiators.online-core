import { ARENA_STANDARD_STEP_DISTANCE } from "../../config/arenaScale.js";
import type {
  BattleActionType,
  BattleFatigueSnapshot,
  BattleFighterRuntime,
  BattleOutcome,
} from "../battleTypes.js";
import type { FighterEnergyState } from "../battleSimulatorTypes.js";
import { MIN_MOVEMENT_DISTANCE, MOVEMENT_ENERGY_PER_STEP } from "./constants.js";
import { clamp } from "./math.js";
import { randomBetween } from "./random.js";

export function createEnergyState(fighter: BattleFighterRuntime): FighterEnergyState {
  return {
    energy: fighter.maxEnergy,
    maxEnergy: fighter.maxEnergy,
    recoveryUntilMs: 0,
    lastUpdatedMs: 0,
  };
}

export function getEnergyState(
  states: Map<string, FighterEnergyState>,
  fighterId: string,
): FighterEnergyState {
  const state = states.get(fighterId);

  if (!state) {
    throw new Error(`Missing fatigue state for fighter: ${fighterId}`);
  }

  return state;
}

export function recoverEnergy(
  fighter: BattleFighterRuntime,
  state: FighterEnergyState,
  timeMs: number,
): void {
  const elapsedMs = Math.max(0, timeMs - state.lastUpdatedMs);

  if (elapsedMs <= 0) {
    return;
  }

  const restingBonus = timeMs < state.recoveryUntilMs ? 1.42 : 1;
  state.energy = clamp(
    state.energy + (elapsedMs / 1_000) * fighter.recoveryRate * restingBonus,
    0,
    state.maxEnergy,
  );
  state.lastUpdatedMs = timeMs;

  if (state.energy >= state.maxEnergy * 0.44) {
    state.recoveryUntilMs = Math.min(state.recoveryUntilMs, timeMs);
  }
}

export function isWinded(state: FighterEnergyState, timeMs: number): boolean {
  return timeMs < state.recoveryUntilMs || state.energy <= state.maxEnergy * 0.18;
}

export function applyFatigueToFighter(
  fighter: BattleFighterRuntime,
  state: FighterEnergyState,
  timeMs: number,
): BattleFighterRuntime {
  const energyRatio = clamp(state.energy / state.maxEnergy, 0, 1);
  const winded = isWinded(state, timeMs);
  const pressure = 1 - energyRatio;
  const movementMultiplier = winded ? 0.5 + energyRatio * 0.22 : 1 - pressure * 0.18;
  const actionMultiplier = winded ? 0.64 + energyRatio * 0.18 : 1 - pressure * 0.12;
  const defenseMultiplier = winded ? 0.66 + energyRatio * 0.18 : 1 - pressure * 0.1;
  const enduranceMultiplier = winded ? 0.68 + energyRatio * 0.16 : 1 - pressure * 0.08;
  const speed = fighter.speed * movementMultiplier;
  const dexterity = fighter.dexterity * movementMultiplier;
  const endurance = fighter.endurance * enduranceMultiplier;
  const mobility = speed * 0.5 + dexterity * 0.34 + endurance * 0.16;

  return {
    ...fighter,
    attack: fighter.attack * actionMultiplier,
    defense: fighter.defense * defenseMultiplier,
    speed,
    dexterity,
    endurance,
    mobility,
    focus: fighter.focus * (winded ? 0.88 : 1 - pressure * 0.04),
  };
}

export function applyInjuryToFighter(
  fighter: BattleFighterRuntime,
  currentHp: number,
): BattleFighterRuntime {
  const healthRatio = clamp(currentHp / fighter.maxHp, 0, 1);
  const injuryPressure = 1 - healthRatio;
  const badlyHurt = healthRatio <= 0.34;
  const movementMultiplier = badlyHurt
    ? 0.72 + healthRatio * 0.4
    : 1 - injuryPressure * 0.16;
  const actionMultiplier = badlyHurt
    ? 0.76 + healthRatio * 0.32
    : 1 - injuryPressure * 0.14;
  const defenseMultiplier = badlyHurt
    ? 0.74 + healthRatio * 0.3
    : 1 - injuryPressure * 0.12;
  const enduranceMultiplier = badlyHurt
    ? 0.78 + healthRatio * 0.24
    : 1 - injuryPressure * 0.1;
  const speed = fighter.speed * movementMultiplier;
  const dexterity = fighter.dexterity * movementMultiplier;
  const endurance = fighter.endurance * enduranceMultiplier;
  const mobility = speed * 0.5 + dexterity * 0.34 + endurance * 0.16;

  return {
    ...fighter,
    attack: fighter.attack * actionMultiplier,
    defense: fighter.defense * defenseMultiplier,
    speed,
    dexterity,
    endurance,
    mobility,
    focus: fighter.focus * (badlyHurt ? 0.9 : 1 - injuryPressure * 0.05),
  };
}

export function createEffectiveFighters(
  fighters: Record<string, BattleFighterRuntime>,
  states: Map<string, FighterEnergyState>,
  timeMs: number,
  hpByFighter?: Map<string, number>,
): Record<string, BattleFighterRuntime> {
  const effective: Record<string, BattleFighterRuntime> = {};

  for (const [fighterId, fighter] of Object.entries(fighters)) {
    const fatigued = applyFatigueToFighter(
      fighter,
      getEnergyState(states, fighterId),
      timeMs,
    );
    effective[fighterId] = applyInjuryToFighter(
      fatigued,
      hpByFighter?.get(fighterId) ?? fighter.maxHp,
    );
  }

  return effective;
}

export function spendEnergy(
  fighter: BattleFighterRuntime,
  state: FighterEnergyState,
  amount: number,
  timeMs: number,
): void {
  state.energy = clamp(state.energy - amount, 0, state.maxEnergy);

  if (state.energy <= state.maxEnergy * 0.16) {
    const recoveryMs = Math.round(
      randomBetween(1_800, 3_200) * clamp(1.22 - fighter.endurance / 260, 0.72, 1.2),
    );
    state.recoveryUntilMs = Math.max(state.recoveryUntilMs, timeMs + recoveryMs);
  }
}

export function spendMovementEnergy(
  fighter: BattleFighterRuntime,
  state: FighterEnergyState,
  distance: number,
  rush: boolean,
  timeMs: number,
): void {
  if (distance < MIN_MOVEMENT_DISTANCE) {
    return;
  }

  const enduranceDiscount = clamp(1.18 - fighter.endurance / 210, 0.64, 1.12);
  const cost =
    (distance / ARENA_STANDARD_STEP_DISTANCE) *
    MOVEMENT_ENERGY_PER_STEP *
    enduranceDiscount *
    (rush ? 1.28 : 1);
  spendEnergy(fighter, state, cost, timeMs);
}

export function spendActionEnergy(
  fighter: BattleFighterRuntime,
  state: FighterEnergyState,
  actionType: BattleActionType,
  contested: boolean,
  timeMs: number,
): void {
  const enduranceDiscount = clamp(1.15 - fighter.endurance / 240, 0.66, 1.12);
  const baseCost = actionType === "net" ? 17 : actionType === "javelin" ? 15 : 12;
  spendEnergy(fighter, state, (baseCost + (contested ? 4 : 0)) * enduranceDiscount, timeMs);
}

export function spendReactionEnergy(
  fighter: BattleFighterRuntime,
  state: FighterEnergyState,
  outcome: BattleOutcome,
  timeMs: number,
): void {
  const enduranceDiscount = clamp(1.14 - fighter.endurance / 255, 0.68, 1.1);
  const baseCost = outcome === "miss" ? 9 : outcome === "block" ? 7 : 4;
  spendEnergy(fighter, state, baseCost * enduranceDiscount, timeMs);
}

export function snapshotFatigue(
  fighterIds: readonly string[],
  states: Map<string, FighterEnergyState>,
  timeMs: number,
): BattleFatigueSnapshot[] {
  return fighterIds.map((fighterId) => {
    const state = getEnergyState(states, fighterId);

    return {
      fighterId,
      energyPercent: Math.round(clamp((state.energy / state.maxEnergy) * 100, 0, 100)),
      winded: isWinded(state, timeMs),
      recoveryUntilMs: state.recoveryUntilMs,
    };
  });
}
