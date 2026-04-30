import type { GladiatorClass } from "../../gladiators/gladiatorTypes.js";
import type {
  BattleFighterRuntime,
  BattlePoint,
  BattleTeamId,
} from "../battleTypes.js";
import { chooseTactic } from "./ai.js";
import {
  shouldAttackNow,
  shouldSpendTurnRecovering,
} from "./actionDecisions.js";
import {
  planBrainAction,
  planBrainMovement,
} from "./actionPlanning.js";
import { createBattleActionPlannerContext } from "./actionPlannerContext.js";
import type { BattleSimulationResult } from "./actionPlannerTypes.js";
import { resolvePendingActions } from "./actionResolver.js";
import { createEffectiveFighters, getEnergyState } from "./energy.js";
import { randomBetween, randomUnit } from "./random.js";
import { getRuntime } from "./runtime.js";
import { getResolvedDurationMs } from "./outcome.js";
import {
  chooseTargetId,
  shouldRepositionForJavelin,
} from "./targeting.js";

export function createActions(
  gladiators: readonly GladiatorClass[],
  fighters: Record<string, BattleFighterRuntime>,
  startPositions: Record<string, BattlePoint>,
  teams: Record<string, BattleTeamId>,
): BattleSimulationResult {
  const context = createBattleActionPlannerContext({
    gladiators,
    fighters,
    startPositions,
    teams,
  });
  const {
    actions,
    fighterIds,
    brains,
    energyStates,
    currentHp,
    damageByFighter,
    traps,
  } = context;

  while (context.getAliveTeamCount() > 1) {
    const aliveBrains = brains.filter((candidate) => !context.isDefeated(candidate.id));
    const brain = aliveBrains.reduce((earliest, candidate) =>
      candidate.nextDecisionMs < earliest.nextDecisionMs ? candidate : earliest,
    );
    const timeMs = Math.round(brain.nextDecisionMs);

    if (!Number.isFinite(timeMs)) {
      break;
    }

    resolvePendingActions(context, timeMs);

    if (context.getAliveTeamCount() <= 1) {
      break;
    }

    if (context.isDefeated(brain.id)) {
      continue;
    }

    context.recoverAllEnergy(timeMs);

    const ownTrap = traps.get(brain.id);
    if (context.isTrapped(brain.id, timeMs)) {
      brain.tactic = "recover";
      brain.nextDecisionMs = Math.round(
        (ownTrap?.trappedUntilMs ?? timeMs + 1_200) + randomBetween(420, 1_250),
      );
      continue;
    }

    const targetId = chooseTargetId(context, brain, timeMs);
    if (!targetId) {
      break;
    }

    brain.targetId = targetId;

    const effectiveFighters = createEffectiveFighters(fighters, energyStates, timeMs, currentHp);
    const fighter = getRuntime(effectiveFighters, brain.id);
    const target = getRuntime(effectiveFighters, targetId);

    brain.tactic = chooseTactic(
      fighter,
      target,
      getEnergyState(energyStates, brain.id),
      getEnergyState(energyStates, targetId),
      timeMs,
    );

    if (shouldSpendTurnRecovering(context, brain, fighter, timeMs)) {
      planBrainMovement(context, brain, targetId, timeMs, "recover");
      continue;
    }

    if (shouldRepositionForJavelin(context, brain, targetId, timeMs)) {
      planBrainMovement(context, brain, targetId, timeMs, "move");
      continue;
    }

    if (shouldAttackNow(context, brain, targetId, timeMs)) {
      planBrainAction(context, brain, targetId, timeMs);
      continue;
    }

    planBrainMovement(context, brain, targetId, timeMs, "move");
  }

  resolvePendingActions(context, Number.POSITIVE_INFINITY);

  actions.sort((a, b) => a.timeMs - b.timeMs || a.index - b.index);
  actions.forEach((action, index) => {
    action.index = index;
  });

  const outcomeOrder = fighterIds
    .map((fighterId) => ({
      id: fighterId,
      hp: context.getHp(fighterId),
      hpRatio: context.getHpRatio(fighterId),
      damageDealt: damageByFighter.get(fighterId) ?? 0,
      tiebreaker: randomUnit(),
    }))
    .sort(
      (a, b) =>
        b.hpRatio - a.hpRatio ||
        b.hp - a.hp ||
        b.damageDealt - a.damageDealt ||
        b.tiebreaker - a.tiebreaker,
    );

  const teamScore = new Map<BattleTeamId, number>();
  for (const fighterId of fighterIds) {
    const team = teams[fighterId]!;
    teamScore.set(team, (teamScore.get(team) ?? 0) + context.getHp(fighterId));
  }

  const teamRanking = Array.from(teamScore.entries()).sort(
    (a, b) => b[1] - a[1] || randomUnit() - 0.5,
  );
  const winnerTeamId: BattleTeamId = teamRanking[0]?.[0] ?? "left";
  const loserTeamId: BattleTeamId =
    teamRanking[teamRanking.length - 1]?.[0] ?? (winnerTeamId === "left" ? "right" : "left");

  const winnerId =
    outcomeOrder.find((entry) => teams[entry.id] === winnerTeamId)?.id ??
    outcomeOrder[0]?.id ??
    fighterIds[0]!;
  const loserId =
    [...outcomeOrder].reverse().find((entry) => teams[entry.id] === loserTeamId)?.id ??
    outcomeOrder[outcomeOrder.length - 1]?.id ??
    fighterIds[1] ??
    winnerId;

  return {
    actions,
    winnerId,
    loserId,
    winnerTeamId,
    loserTeamId,
    durationMs: getResolvedDurationMs(actions, 0),
  };
}
