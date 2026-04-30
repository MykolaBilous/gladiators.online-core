import type { GladiatorClass } from "../gladiators/gladiatorTypes.js";
import type {
  BattleFighterRuntime,
  BattlePlan,
  BattlePoint,
  BattleTeamId,
} from "./battleTypes.js";
import { createActions } from "./simulator/createActions.js";
import { createStartPositions } from "./simulator/movement.js";
import {
  getResolvedDurationMs,
  trimEventsAfterDefeat,
} from "./simulator/outcome.js";
import {
  createBattleId,
  createSeededRandom,
  normalizeBattleSeed,
  withBattleRandom,
  type BattleSeed,
} from "./simulator/random.js";
import { createRuntime } from "./simulator/runtime.js";

export type {
  BattleActionType,
  BattleCounterAttack,
  BattleDecisionSnapshot,
  BattleEvent,
  BattleFatigueSnapshot,
  BattleFighterRuntime,
  BattleMovement,
  BattleNetTrap,
  BattleOutcome,
  BattlePlan,
  BattlePoint,
  BattleTactic,
  BattleTeamId,
} from "./battleTypes.js";
export type { BattleSeed } from "./simulator/random.js";

export interface BattlePlanOptions {
  seed?: BattleSeed;
}

export function createBattlePlan(
  gladiators: readonly GladiatorClass[],
  teams?: Record<string, BattleTeamId>,
  requestedStartPositions?: Record<string, BattlePoint>,
  options: BattlePlanOptions = {},
): BattlePlan {
  if (gladiators.length < 2) {
    throw new Error("A battle needs at least two gladiators");
  }

  const seed = normalizeBattleSeed(options.seed);
  const seededRandom = createSeededRandom(seed);

  return withBattleRandom(seededRandom, () =>
    createSeededBattlePlan(gladiators, seed, teams, requestedStartPositions),
  );
}

function createSeededBattlePlan(
  gladiators: readonly GladiatorClass[],
  seed: string,
  teams?: Record<string, BattleTeamId>,
  requestedStartPositions?: Record<string, BattlePoint>,
): BattlePlan {
  const resolvedTeams: Record<string, BattleTeamId> = teams
    ? { ...teams }
    : gladiators.reduce<Record<string, BattleTeamId>>((acc, gladiator, index) => {
        acc[gladiator.id] = index === 0 ? "left" : "right";
        return acc;
      }, {});

  for (const gladiator of gladiators) {
    if (!resolvedTeams[gladiator.id]) {
      throw new Error(`Missing team assignment for gladiator: ${gladiator.id}`);
    }
  }

  const distinctTeams = new Set(Object.values(resolvedTeams));
  if (distinctTeams.size < 2) {
    throw new Error("A battle needs at least two teams");
  }

  const fighters: Record<string, BattleFighterRuntime> = {};

  for (const gladiator of gladiators) {
    fighters[gladiator.id] = createRuntime(gladiator);
  }

  const startPositions = createStartPositions(gladiators, resolvedTeams, requestedStartPositions);
  const simulation = createActions(
    gladiators,
    fighters,
    startPositions,
    resolvedTeams,
  );
  const fighterIds = gladiators.map((gladiator) => gladiator.id);
  const events = trimEventsAfterDefeat(
    simulation.actions.map((action) => ({ ...action })),
    resolvedTeams,
    fighterIds,
  );
  const resolvedDurationMs = getResolvedDurationMs(events, simulation.durationMs);

  return {
    id: createBattleId(seed),
    seed,
    durationMs: resolvedDurationMs,
    teams: resolvedTeams,
    winnerTeamId: simulation.winnerTeamId,
    loserTeamId: simulation.loserTeamId,
    winnerId: simulation.winnerId,
    loserId: simulation.loserId,
    fighters,
    startPositions,
    events,
  };
}
