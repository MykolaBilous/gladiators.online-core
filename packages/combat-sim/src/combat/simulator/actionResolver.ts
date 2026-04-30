import {
  canShieldBlockProjectiles,
  getDistance,
  isVelesGladiator,
} from "./math.js";
import { getFighterPosition } from "./movement.js";
import {
  calculateStrikeDamage,
  compareActionResolution,
  getActionResolutionTimeMs,
  getStrikeDefenseProfile,
  planJavelinOutcome,
  planNetTrap,
  planOutcome,
} from "./outcome.js";
import { isDistanceInReach } from "./reach.js";
import { getRuntime } from "./runtime.js";
import {
  createEffectiveFighters,
  getEnergyState,
  snapshotFatigue,
  spendReactionEnergy,
} from "./energy.js";
import { isEnemyDangerouslyClose } from "./ai.js";
import type { BattleActionPlannerContext } from "./actionPlannerTypes.js";

export function resolvePendingActions(
  context: BattleActionPlannerContext,
  untilMs: number,
): void {
  const {
    pendingResolutions,
    fighterIds,
    energyStates,
    fighters,
    currentHp,
    brains,
    motions,
    traps,
    damageByFighter,
  } = context;

  pendingResolutions.sort((a, b) => compareActionResolution(a.action, b.action));

  while (pendingResolutions.length > 0) {
    const pending = pendingResolutions[0]!;
    const action = pending.action;
    const impactTimeMs = getActionResolutionTimeMs(action);

    if (impactTimeMs > untilMs) {
      break;
    }

    pendingResolutions.shift();
    context.recoverAllEnergy(impactTimeMs);
    action.defenderHp = context.getDefenderHp(action.defenderId);

    if (context.isDefeated(action.attackerId) || context.isDefeated(action.defenderId)) {
      action.outcome = "miss";
      action.critical = false;
      action.damage = 0;
      action.fatigue = snapshotFatigue(fighterIds, energyStates, impactTimeMs);
      continue;
    }

    const effectiveFighters = createEffectiveFighters(
      fighters,
      energyStates,
      impactTimeMs,
      currentHp,
    );
    const attacker = getRuntime(effectiveFighters, action.attackerId);
    const defender = getRuntime(effectiveFighters, action.defenderId);
    const attackerBrain = brains.find((candidate) => candidate.id === action.attackerId);
    const defenderBrain = brains.find((candidate) => candidate.id === action.defenderId);
    const defenderTrapped = context.isTrapped(action.defenderId, impactTimeMs);
    const impactDistance = getDistance(
      getFighterPosition(motions, action.attackerId, impactTimeMs),
      getFighterPosition(motions, action.defenderId, impactTimeMs),
    );
    const attackInReach = isDistanceInReach(impactDistance, pending.reach);

    if (defenderBrain && isVelesGladiator(defenderBrain.gladiator)) {
      defenderBrain.usingShortSword =
        defenderBrain.javelinsLeft <= 0 ||
        (attackerBrain
          ? isEnemyDangerouslyClose(impactDistance, attackerBrain.gladiator)
          : false);
    }

    if (action.actionType === "net") {
      if (!attackInReach) {
        action.outcome = "miss";
        action.netTrap = {
          escaped: true,
          durationMs: 0,
          releaseTimeMs: impactTimeMs,
        };
      } else {
        const plannedNet = planNetTrap(attacker, defender, impactTimeMs);
        action.outcome = plannedNet.outcome;
        action.netTrap = plannedNet.netTrap;

        if (!plannedNet.netTrap.escaped) {
          traps.set(action.defenderId, {
            trappedFromMs: impactTimeMs,
            trappedUntilMs: plannedNet.netTrap.releaseTimeMs,
            trapperId: action.attackerId,
          });
        }
      }
    } else if (action.actionType === "javelin") {
      if (!attackInReach) {
        action.outcome = "miss";
        action.critical = false;
      } else {
        const plannedOutcome = planJavelinOutcome(
          attacker,
          defender,
          defenderBrain ? canShieldBlockProjectiles(defenderBrain.gladiator) : false,
          defenderTrapped,
        );
        action.outcome = plannedOutcome.outcome;
        action.critical = plannedOutcome.critical;

        if (action.outcome === "hit") {
          action.damage = Math.min(
            context.getDefenderHp(action.defenderId),
            calculateStrikeDamage(
              attacker,
              defender,
              action.attackCssClass,
              action.critical,
              defenderTrapped,
            ),
          );
          action.defenderHp = Math.max(0, context.getDefenderHp(action.defenderId) - action.damage);
          currentHp.set(action.defenderId, action.defenderHp);
          damageByFighter.set(
            action.attackerId,
            (damageByFighter.get(action.attackerId) ?? 0) + action.damage,
          );

          if (action.defenderHp <= 0) {
            if (defenderBrain) {
              defenderBrain.nextDecisionMs = Number.POSITIVE_INFINITY;
            }
            traps.delete(action.defenderId);
          }
        }
      }
    } else if (action.actionType === "strike") {
      if (!attackInReach) {
        action.outcome = "miss";
        action.critical = false;
      } else {
        const plannedOutcome = planOutcome(
          attacker,
          defender,
          defenderTrapped,
          getStrikeDefenseProfile(defenderBrain),
        );
        action.outcome = plannedOutcome.outcome;
        action.critical = plannedOutcome.critical;

        if (action.outcome === "hit") {
          action.damage = Math.min(
            context.getDefenderHp(action.defenderId),
            calculateStrikeDamage(
              attacker,
              defender,
              action.attackCssClass,
              action.critical,
              defenderTrapped,
            ),
          );
          action.defenderHp = Math.max(0, context.getDefenderHp(action.defenderId) - action.damage);
          currentHp.set(action.defenderId, action.defenderHp);
          damageByFighter.set(
            action.attackerId,
            (damageByFighter.get(action.attackerId) ?? 0) + action.damage,
          );

          if (action.defenderHp <= 0) {
            if (defenderBrain) {
              defenderBrain.nextDecisionMs = Number.POSITIVE_INFINITY;
            }
            traps.delete(action.defenderId);
          }
        }
      }
    }

    spendReactionEnergy(
      getRuntime(fighters, action.defenderId),
      getEnergyState(energyStates, action.defenderId),
      action.outcome,
      impactTimeMs,
    );
    action.fatigue = snapshotFatigue(fighterIds, energyStates, impactTimeMs);
  }
}
