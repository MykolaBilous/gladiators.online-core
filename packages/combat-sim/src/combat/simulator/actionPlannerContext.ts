import type { BattleDecisionSnapshot, BattleTeamId } from "../battleTypes.js";
import type { FighterBrain, PlannedAction } from "../battleSimulatorTypes.js";
import { createDecisionSnapshot, getStartingJavelinCount } from "./ai.js";
import {
  createEnergyState,
  getEnergyState,
  recoverEnergy,
} from "./energy.js";
import { clamp } from "./math.js";
import { createMotionStates } from "./movement.js";
import { randomBetween } from "./random.js";
import { getRuntime } from "./runtime.js";
import type {
  BattleActionPlannerContext,
  CreateActionPlannerContextInput,
  PendingActionResolution,
} from "./actionPlannerTypes.js";

export function createBattleActionPlannerContext({
  gladiators,
  fighters,
  startPositions,
  teams,
}: CreateActionPlannerContextInput): BattleActionPlannerContext {
  const fighterIds = gladiators.map((gladiator) => gladiator.id);
  const energyStates = new Map(
    fighterIds.map((fighterId) => [
      fighterId,
      createEnergyState(getRuntime(fighters, fighterId)),
    ]),
  );
  const currentHp = new Map(
    fighterIds.map((fighterId) => [
      fighterId,
      getRuntime(fighters, fighterId).maxHp,
    ]),
  );
  const damageByFighter = new Map(fighterIds.map((fighterId) => [fighterId, 0]));
  const motions = createMotionStates(fighterIds, startPositions);
  const traps = new Map();
  const pendingResolutions: PendingActionResolution[] = [];
  const actions: PlannedAction[] = [];
  const teamIndexCounter = new Map<string, number>();
  const brains: FighterBrain[] = gladiators.map((gladiator) => {
    const team = teams[gladiator.id] ?? "left";
    const teamIndex = teamIndexCounter.get(team) ?? 0;
    teamIndexCounter.set(team, teamIndex + 1);
    return {
      id: gladiator.id,
      gladiator,
      nextDecisionMs: Math.round(randomBetween(900, 1_650) + teamIndex * randomBetween(120, 360)),
      tactic: "balanced",
      targetId: null,
      netThrown: false,
      javelinsLeft: getStartingJavelinCount(gladiator),
      usingShortSword: false,
    };
  });

  const context = {
    actions,
    fighterIds,
    energyStates,
    currentHp,
    damageByFighter,
    motions,
    traps,
    pendingResolutions,
    brains,
    fighters,
    teams,
  } as BattleActionPlannerContext;

  context.getHp = (fighterId: string): number => currentHp.get(fighterId) ?? 0;
  context.getHpRatio = (fighterId: string): number =>
    clamp(context.getHp(fighterId) / getRuntime(fighters, fighterId).maxHp, 0, 1);
  context.isDefeated = (fighterId: string): boolean => context.getHp(fighterId) <= 0;
  context.getAliveTeamCount = (): number => {
    const aliveTeams = new Set<BattleTeamId>();
    for (const fighterId of fighterIds) {
      if (!context.isDefeated(fighterId)) {
        aliveTeams.add(teams[fighterId]!);
      }
    }
    return aliveTeams.size;
  };
  context.getDefenderHp = (fighterId: string): number =>
    Math.max(0, Math.round(context.getHp(fighterId)));
  context.recoverAllEnergy = (timeMs: number): void => {
    for (const fighterId of fighterIds) {
      recoverEnergy(
        getRuntime(fighters, fighterId),
        getEnergyState(energyStates, fighterId),
        timeMs,
      );
    }
  };
  context.isTrapped = (fighterId: string, timeMs: number): boolean => {
    const trap = traps.get(fighterId);

    return Boolean(trap && timeMs >= trap.trappedFromMs && timeMs < trap.trappedUntilMs);
  };
  context.createDecisions = (): BattleDecisionSnapshot[] =>
    fighterIds.map((fighterId) => {
      const brain = brains.find((item) => item.id === fighterId);

      return createDecisionSnapshot(
        fighterId,
        brain?.tactic ?? "balanced",
        getEnergyState(energyStates, fighterId),
      );
    });
  context.getBrain = (fighterId: string): FighterBrain | undefined =>
    brains.find((candidate) => candidate.id === fighterId);
  context.getEnemyCandidateIds = (brain: FighterBrain): string[] => {
    const ownTeam = teams[brain.id];

    return fighterIds.filter(
      (fighterId) =>
        fighterId !== brain.id &&
        !context.isDefeated(fighterId) &&
        teams[fighterId] !== ownTeam,
    );
  };

  return context;
}
