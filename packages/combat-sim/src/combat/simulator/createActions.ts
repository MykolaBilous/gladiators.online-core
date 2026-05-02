import { metersToArenaDistance } from "../../config/arenaScale.js";
import type { GladiatorAttack, GladiatorClass } from "../../gladiators/gladiatorTypes.js";
import type {
  BattleActionType,
  BattleDecisionSnapshot,
  BattleEvent,
  BattleFighterRuntime,
  BattleMotionSegment,
  BattlePoint,
  BattleTactic,
  BattleTeamId,
} from "../battleTypes.js";
import type { AttackReach, FighterEnergyState } from "../battleSimulatorTypes.js";
import {
  createDecisionSnapshot,
  chooseAttack,
  chooseTactic,
  getCloseCombatAttacks,
  getJavelinAttack,
  getNetAttack,
  getStartingJavelinCount,
  shouldRushForTactic,
  shouldUseNet,
} from "./ai.js";
import type { BattleSimulationResult } from "./actionPlannerTypes.js";
import {
  ARENA_MAX_X,
  ARENA_MAX_Y,
  ARENA_MIN_X,
  ARENA_MIN_Y,
  JAVELIN_ATTACK_CSS_CLASS,
  NET_ATTACK_CSS_CLASS,
} from "./constants.js";
import {
  createEffectiveFighters,
  createEnergyState,
  getEnergyState,
  recoverEnergy,
  snapshotFatigue,
  spendActionEnergy,
  spendMovementEnergy,
  spendReactionEnergy,
} from "./energy.js";
import {
  calculateStrikeDamage,
  estimateImpactDelay,
  getActionResolutionTimeMs,
  planJavelinOutcome,
  planNetTrap,
  planOutcome,
} from "./outcome.js";
import { appendMotionSegment, createMotionTracks, toMotionTrackRecord } from "./movement.js";
import {
  canShieldBlockProjectiles,
  clamp,
  clonePoint,
  getDistance,
  isVelesGladiator,
} from "./math.js";
import { randomBetween, randomUnit } from "./random.js";
import { normalizeReach } from "./reach.js";
import { getRuntime } from "./runtime.js";

const FRAME_MS = 80;
const MAX_BATTLE_MS = 90_000;
const MOTION_RECORD_EPSILON = 0.00004;
const COLLISION_PADDING = metersToArenaDistance(0.12);
const DEFEATED_BODY_PADDING = metersToArenaDistance(0.02);
const DEFEATED_BODY_RADIUS_FACTOR = 0.52;
const DEFEAT_SLIDE_DISTANCE = metersToArenaDistance(0.18);
const DEFEAT_SLIDE_MS = 520;
const TARGET_RESELECT_MS = 320;
const BODY_BLOCKING_PADDING = metersToArenaDistance(0.08);
const ATTACK_REACH_TOLERANCE = metersToArenaDistance(0.05);
const CROWD_TARGET_PENALTY = metersToArenaDistance(1.45);
const BLOCKED_TARGET_LANE_PENALTY = metersToArenaDistance(2.4);
const IMMEDIATE_MELEE_TARGET_BONUS = metersToArenaDistance(2.65);
const NEAR_MELEE_APPROACH_BONUS = metersToArenaDistance(1.55);
const MELEE_APPROACH_BUFFER = metersToArenaDistance(0.36);
const ATTACK_LUNGE_MAX_DISTANCE = metersToArenaDistance(0.42);
const ATTACK_LUNGE_REACH_MARGIN = metersToArenaDistance(0.03);
const RECENT_TARGET_MEMORY_MS = 3_200;
const RECENT_TARGET_ATTACK_PENALTY = metersToArenaDistance(1.35);
const TARGET_LANE_PENALTY = 0.58;
const LOW_ENERGY_RECOVER_RATIO = 0.24;

interface RealtimeFighterState {
  id: string;
  gladiator: GladiatorClass;
  teamId: BattleTeamId;
  position: BattlePoint;
  previousPosition: BattlePoint;
  velocity: BattlePoint;
  tactic: BattleTactic;
  targetId: string | null;
  nextTargetSelectionMs: number;
  nextAttackReadyMs: number;
  lockedUntilMs: number;
  trappedUntilMs: number;
  trapperId: string | null;
  hp: number;
  defeatedAtMs: number | null;
  netThrown: boolean;
  javelinsLeft: number;
  usingShortSword: boolean;
  strafeSign: -1 | 1;
  engagementOffset: number;
  formationY: number;
}

interface PendingRealtimeAttack {
  event: BattleEvent;
  reach: AttackReach;
  impactAtMs: number;
}

interface RealtimeContext {
  actions: BattleEvent[];
  currentHp: Map<string, number>;
  damageByFighter: Map<string, number>;
  energyStates: Map<string, FighterEnergyState>;
  fighterIds: string[];
  fighters: Record<string, BattleFighterRuntime>;
  motionTracks: Map<string, BattleMotionSegment[]>;
  pendingAttacks: PendingRealtimeAttack[];
  states: Map<string, RealtimeFighterState>;
  teams: Record<string, BattleTeamId>;
}

interface AttackIntent {
  actionType: BattleActionType;
  attack: GladiatorAttack;
  rush: boolean;
}

export function createActions(
  gladiators: readonly GladiatorClass[],
  fighters: Record<string, BattleFighterRuntime>,
  startPositions: Record<string, BattlePoint>,
  teams: Record<string, BattleTeamId>,
): BattleSimulationResult {
  const fighterIds = gladiators.map((gladiator) => gladiator.id);
  const context = createRealtimeContext(gladiators, fighters, startPositions, teams);
  let timeMs = 0;

  while (timeMs <= MAX_BATTLE_MS && getAliveTeamCount(context) > 1) {
    updateEnergy(context, timeMs);
    resolvePendingAttacks(context, timeMs);

    if (getAliveTeamCount(context) <= 1) {
      break;
    }

    const effectiveFighters = createEffectiveFighters(
      fighters,
      context.energyStates,
      timeMs,
      context.currentHp,
    );
    updateTargetsAndTactics(context, effectiveFighters, timeMs);
    startReadyAttacks(context, effectiveFighters, timeMs);
    stepMovement(context, effectiveFighters, timeMs, FRAME_MS);
    recordMotionSegments(context, timeMs, FRAME_MS);

    timeMs += FRAME_MS;
  }

  resolvePendingAttacks(context, Number.POSITIVE_INFINITY);

  const actions = context.actions
    .sort((a, b) => a.timeMs - b.timeMs || getActionResolutionTimeMs(a) - getActionResolutionTimeMs(b))
    .map((action, index) => ({
      ...action,
      index,
    }));
  const outcome = resolveBattleOutcome(context, fighterIds);
  const motionTracks = toMotionTrackRecord(fighterIds, context.motionTracks);

  return {
    actions,
    motionTracks,
    ...outcome,
    durationMs: Math.max(
      getLastActionResolutionMs(actions),
      getMotionTrackEndMs(motionTracks),
      timeMs,
    ),
  };
}

function createRealtimeContext(
  gladiators: readonly GladiatorClass[],
  fighters: Record<string, BattleFighterRuntime>,
  startPositions: Record<string, BattlePoint>,
  teams: Record<string, BattleTeamId>,
): RealtimeContext {
  const fighterIds = gladiators.map((gladiator) => gladiator.id);
  const energyStates = new Map(
    fighterIds.map((fighterId) => [fighterId, createEnergyState(getRuntime(fighters, fighterId))]),
  );
  const currentHp = new Map(
    fighterIds.map((fighterId) => [fighterId, getRuntime(fighters, fighterId).maxHp]),
  );
  const states = new Map<string, RealtimeFighterState>();
  const teamSizes = new Map<BattleTeamId, number>();
  const teamIndexes = new Map<BattleTeamId, number>();

  for (const gladiator of gladiators) {
    const teamId = teams[gladiator.id] ?? "left";
    teamSizes.set(teamId, (teamSizes.get(teamId) ?? 0) + 1);
  }

  for (const gladiator of gladiators) {
    const start = clonePoint(startPositions[gladiator.id] ?? { x: 0.5, y: 0.58 });
    const teamId = teams[gladiator.id] ?? "left";
    const teamIndex = teamIndexes.get(teamId) ?? 0;
    const teamSize = teamSizes.get(teamId) ?? 1;
    const centeredIndex = teamIndex - (teamSize - 1) / 2;
    teamIndexes.set(teamId, teamIndex + 1);

    states.set(gladiator.id, {
      id: gladiator.id,
      gladiator,
      teamId,
      position: start,
      previousPosition: clonePoint(start),
      velocity: { x: 0, y: 0 },
      tactic: "balanced",
      targetId: null,
      nextTargetSelectionMs: 0,
      nextAttackReadyMs: Math.round(randomBetween(420, 920)),
      lockedUntilMs: 0,
      trappedUntilMs: 0,
      trapperId: null,
      hp: getRuntime(fighters, gladiator.id).maxHp,
      defeatedAtMs: null,
      netThrown: false,
      javelinsLeft: getStartingJavelinCount(gladiator),
      usingShortSword: false,
      strafeSign: randomUnit() < 0.5 ? -1 : 1,
      engagementOffset: clamp(
        centeredIndex * metersToArenaDistance(0.32) +
          randomBetween(-metersToArenaDistance(0.08), metersToArenaDistance(0.08)),
        -metersToArenaDistance(1.25),
        metersToArenaDistance(1.25),
      ),
      formationY: start.y,
    });
  }

  return {
    actions: [],
    currentHp,
    damageByFighter: new Map(fighterIds.map((fighterId) => [fighterId, 0])),
    energyStates,
    fighterIds,
    fighters,
    motionTracks: createMotionTracks(fighterIds),
    pendingAttacks: [],
    states,
    teams,
  };
}

function updateEnergy(context: RealtimeContext, timeMs: number): void {
  for (const fighterId of context.fighterIds) {
    recoverEnergy(
      getRuntime(context.fighters, fighterId),
      getEnergyState(context.energyStates, fighterId),
      timeMs,
    );
  }
}

function updateTargetsAndTactics(
  context: RealtimeContext,
  effectiveFighters: Record<string, BattleFighterRuntime>,
  timeMs: number,
): void {
  const targetPressure = createTargetPressureMap(context);

  for (const state of context.states.values()) {
    if (!isAlive(state)) {
      continue;
    }

    const currentTarget = state.targetId ? context.states.get(state.targetId) : undefined;
    const immediateTargetId = chooseImmediateMeleeTarget(context, state, targetPressure);
    if (
      timeMs >= state.nextTargetSelectionMs ||
      !currentTarget ||
      !isAlive(currentTarget) ||
      currentTarget.teamId === state.teamId ||
      (immediateTargetId !== null && immediateTargetId !== state.targetId)
    ) {
      if (state.targetId) {
        decrementTargetPressure(targetPressure, state.targetId);
      }

      state.targetId = immediateTargetId ?? chooseRealtimeTarget(context, state, targetPressure, timeMs);

      if (state.targetId) {
        targetPressure.set(state.targetId, (targetPressure.get(state.targetId) ?? 0) + 1);
      }

      state.nextTargetSelectionMs = timeMs + TARGET_RESELECT_MS + Math.round(randomBetween(-60, 90));
    }

    const target = state.targetId ? context.states.get(state.targetId) : undefined;
    if (!target || !isAlive(target)) {
      state.tactic = "balanced";
      continue;
    }

    const selfRuntime = getRuntime(effectiveFighters, state.id);
    const targetRuntime = getRuntime(effectiveFighters, target.id);
    state.tactic = chooseTactic(
      selfRuntime,
      targetRuntime,
      getEnergyState(context.energyStates, state.id),
      getEnergyState(context.energyStates, target.id),
      timeMs,
    );
  }
}

function createTargetPressureMap(context: RealtimeContext): Map<string, number> {
  const pressure = new Map<string, number>();

  for (const state of context.states.values()) {
    if (!isAlive(state) || !state.targetId) {
      continue;
    }

    const target = context.states.get(state.targetId);
    if (!target || !isAlive(target)) {
      continue;
    }

    pressure.set(state.targetId, (pressure.get(state.targetId) ?? 0) + 1);
  }

  for (const pending of context.pendingAttacks) {
    const attacker = context.states.get(pending.event.attackerId);
    const defender = context.states.get(pending.event.defenderId);
    if (!attacker || !defender || !isAlive(attacker) || !isAlive(defender)) {
      continue;
    }

    pressure.set(defender.id, (pressure.get(defender.id) ?? 0) + 1);
  }

  return pressure;
}

function decrementTargetPressure(targetPressure: Map<string, number>, targetId: string): void {
  const nextPressure = (targetPressure.get(targetId) ?? 0) - 1;

  if (nextPressure <= 0) {
    targetPressure.delete(targetId);
    return;
  }

  targetPressure.set(targetId, nextPressure);
}

function chooseRealtimeTarget(
  context: RealtimeContext,
  state: RealtimeFighterState,
  targetPressure: ReadonlyMap<string, number>,
  timeMs: number,
): string | null {
  let bestTargetId: string | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const candidate of context.states.values()) {
    if (!isAlive(candidate) || candidate.teamId === state.teamId) {
      continue;
    }

    const distance = getDistance(state.position, candidate.position);
    const surfaceDistance = getSurfaceDistance(context, state, candidate);
    const attackLaneBlocked = isAttackLaneBlocked(context, state, candidate);
    const immediateMeleeTarget =
      !attackLaneBlocked && isCloseAttackInReach(context, state, candidate, surfaceDistance);
    const nearMeleeApproachTarget =
      !attackLaneBlocked &&
      !immediateMeleeTarget &&
      isCloseAttackApproachTarget(context, state, candidate, surfaceDistance);
    const pressure = Math.max(
      0,
      (targetPressure.get(candidate.id) ?? 0) - (candidate.id === state.targetId ? 1 : 0),
    );
    const stickyBonus = candidate.id === state.targetId ? -metersToArenaDistance(0.35) : 0;
    const woundedBonus = -((1 - candidate.hp / getRuntime(context.fighters, candidate.id).maxHp) * metersToArenaDistance(0.3));
    const lanePenalty =
      Math.abs(candidate.position.y - state.formationY) *
      TARGET_LANE_PENALTY *
      (immediateMeleeTarget ? 0.25 : nearMeleeApproachTarget ? 0.45 : 1);
    const blockedLanePenalty = attackLaneBlocked ? BLOCKED_TARGET_LANE_PENALTY : 0;
    const recentTargetPenalty =
      immediateMeleeTarget
        ? 0
        : countRecentTargetedAttacks(context, candidate.id, timeMs) *
          RECENT_TARGET_ATTACK_PENALTY *
          (nearMeleeApproachTarget ? 0.35 : 1);
    const immediateMeleeBonus = immediateMeleeTarget ? -IMMEDIATE_MELEE_TARGET_BONUS : 0;
    const nearMeleeApproachBonus = nearMeleeApproachTarget ? -NEAR_MELEE_APPROACH_BONUS : 0;
    const score =
      distance +
      pressure *
        CROWD_TARGET_PENALTY *
        (immediateMeleeTarget ? 0.18 : nearMeleeApproachTarget ? 0.45 : 1) +
      lanePenalty +
      blockedLanePenalty +
      recentTargetPenalty +
      immediateMeleeBonus +
      nearMeleeApproachBonus +
      stickyBonus +
      woundedBonus +
      randomBetween(-metersToArenaDistance(0.08), metersToArenaDistance(0.08));

    if (score < bestScore) {
      bestTargetId = candidate.id;
      bestScore = score;
    }
  }

  return bestTargetId;
}

function chooseImmediateMeleeTarget(
  context: RealtimeContext,
  state: RealtimeFighterState,
  targetPressure: ReadonlyMap<string, number>,
): string | null {
  let bestTargetId: string | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const candidate of context.states.values()) {
    if (!isAlive(candidate) || candidate.teamId === state.teamId) {
      continue;
    }

    const surfaceDistance = getSurfaceDistance(context, state, candidate);
    if (
      isAttackLaneBlocked(context, state, candidate) ||
      !isCloseAttackInReach(context, state, candidate, surfaceDistance)
    ) {
      continue;
    }

    const woundedBonus = -((1 - candidate.hp / getRuntime(context.fighters, candidate.id).maxHp) * metersToArenaDistance(0.18));
    const pressure = Math.max(
      0,
      (targetPressure.get(candidate.id) ?? 0) - (candidate.id === state.targetId ? 1 : 0),
    );
    const score =
      surfaceDistance +
      Math.abs(candidate.position.y - state.position.y) * 0.12 +
      pressure * metersToArenaDistance(1.45) +
      woundedBonus;

    if (score < bestScore) {
      bestTargetId = candidate.id;
      bestScore = score;
    }
  }

  return bestTargetId;
}

function isCloseAttackInReach(
  context: RealtimeContext,
  state: RealtimeFighterState,
  candidate: RealtimeFighterState,
  surfaceDistance = getSurfaceDistance(context, state, candidate),
): boolean {
  return getCloseCombatAttacks(state.gladiator).some((attack) =>
    isSurfaceDistanceInReach(surfaceDistance, getCombatReach(attack)),
  );
}

function isCloseAttackApproachTarget(
  context: RealtimeContext,
  state: RealtimeFighterState,
  candidate: RealtimeFighterState,
  surfaceDistance = getSurfaceDistance(context, state, candidate),
): boolean {
  return surfaceDistance <= getCloseAttackMaxReach(state) + MELEE_APPROACH_BUFFER;
}

function getCloseAttackMaxReach(state: RealtimeFighterState): number {
  return getCloseCombatAttacks(state.gladiator).reduce(
    (maxReach, attack) => Math.max(maxReach, normalizeReach(getCombatReach(attack)).max),
    0,
  );
}

function countRecentTargetedAttacks(
  context: RealtimeContext,
  targetId: string,
  timeMs: number,
): number {
  let count = 0;

  for (let index = context.actions.length - 1; index >= 0; index -= 1) {
    const action = context.actions[index];
    if (!action) {
      continue;
    }

    if (timeMs - action.timeMs > RECENT_TARGET_MEMORY_MS) {
      break;
    }

    if (
      action.defenderId === targetId &&
      action.actionType !== "move" &&
      action.actionType !== "recover"
    ) {
      count += 1;
    }
  }

  return count;
}

function startReadyAttacks(
  context: RealtimeContext,
  effectiveFighters: Record<string, BattleFighterRuntime>,
  timeMs: number,
): void {
  const attackPressure = createPendingAttackPressureMap(context);
  const orderedStates = [...context.states.values()]
    .filter(isAlive)
    .sort((a, b) => a.id.localeCompare(b.id));

  const readyAttacks: {
    readonly state: RealtimeFighterState;
    readonly target: RealtimeFighterState;
    readonly intent: AttackIntent;
  }[] = [];

  for (const state of orderedStates) {
    if (timeMs < state.nextAttackReadyMs || timeMs < state.lockedUntilMs || isTrapped(state, timeMs)) {
      continue;
    }

    let target = state.targetId ? context.states.get(state.targetId) : undefined;
    if (target && (attackPressure.get(target.id) ?? 0) >= 2) {
      const alternativeTargetId =
        chooseImmediateMeleeTarget(context, state, attackPressure) ??
        chooseRealtimeTarget(context, state, attackPressure, timeMs);
      const alternativeTarget = alternativeTargetId
        ? context.states.get(alternativeTargetId)
        : undefined;

      if (alternativeTarget && isAlive(alternativeTarget) && alternativeTarget.teamId !== state.teamId) {
        state.targetId = alternativeTarget.id;
        target = alternativeTarget;
      }
    }

    if (!target || !isAlive(target)) {
      continue;
    }

    const intent = chooseAttackIntent(context, effectiveFighters, state, target);
    if (!intent) {
      continue;
    }

    readyAttacks.push({ state, target, intent });
    attackPressure.set(target.id, (attackPressure.get(target.id) ?? 0) + 1);
  }

  for (const { state, target, intent } of readyAttacks) {
    createPendingAttack(context, effectiveFighters, state, target, intent, timeMs);
  }
}

function createPendingAttackPressureMap(context: RealtimeContext): Map<string, number> {
  const pressure = new Map<string, number>();

  for (const pending of context.pendingAttacks) {
    const attacker = context.states.get(pending.event.attackerId);
    const defender = context.states.get(pending.event.defenderId);
    if (!attacker || !defender || !isAlive(attacker) || !isAlive(defender)) {
      continue;
    }

    pressure.set(defender.id, (pressure.get(defender.id) ?? 0) + 1);
  }

  return pressure;
}

function chooseAttackIntent(
  context: RealtimeContext,
  effectiveFighters: Record<string, BattleFighterRuntime>,
  state: RealtimeFighterState,
  target: RealtimeFighterState,
): AttackIntent | null {
  const ownState = getEnergyState(context.energyStates, state.id);
  const energyRatio = ownState.energy / ownState.maxEnergy;
  if (energyRatio < LOW_ENERGY_RECOVER_RATIO) {
    return null;
  }

  const self = getRuntime(effectiveFighters, state.id);
  const surfaceDistance = getSurfaceDistance(context, state, target);
  const attackLaneBlocked = isAttackLaneBlocked(context, state, target);
  const javelinAttack = getJavelinAttack(state.gladiator);
  const netAttack = getNetAttack(state.gladiator);
  state.usingShortSword = shouldUseVelesShortSword(state, surfaceDistance);

  if (
    javelinAttack &&
    state.javelinsLeft > 0 &&
    !state.usingShortSword &&
    surfaceDistance >= metersToArenaDistance(1.15) &&
    isSurfaceDistanceInReach(surfaceDistance, getCombatReach(javelinAttack)) &&
    !attackLaneBlocked
  ) {
    return {
      actionType: "javelin",
      attack: javelinAttack,
      rush: false,
    };
  }

  if (
    netAttack &&
    !state.netThrown &&
    isSurfaceDistanceInReach(surfaceDistance, getCombatReach(netAttack)) &&
    !attackLaneBlocked &&
    shouldUseNet(state.tactic, ownState)
  ) {
    return {
      actionType: "net",
      attack: netAttack,
      rush: false,
    };
  }

  const attack = chooseAttack(state.gladiator, false, surfaceDistance);
  const attackReach = getCombatReach(attack);
  if (
    attackLaneBlocked ||
    (!isSurfaceDistanceInReach(surfaceDistance, attackReach) &&
      getAttackLungeDistance(surfaceDistance, attackReach) > ATTACK_LUNGE_MAX_DISTANCE)
  ) {
    return null;
  }

  return {
    actionType: "strike",
    attack,
    rush:
      (shouldRushForTactic(state.tactic, ownState, false) && self.mobility > 8) ||
      getAttackLungeDistance(surfaceDistance, attackReach) > 0,
  };
}

function createPendingAttack(
  context: RealtimeContext,
  effectiveFighters: Record<string, BattleFighterRuntime>,
  attackerState: RealtimeFighterState,
  defenderState: RealtimeFighterState,
  intent: AttackIntent,
  timeMs: number,
): void {
  const attacker = getRuntime(effectiveFighters, attackerState.id);
  const rawImpactDelayMs = estimateImpactDelay(attacker, intent.actionType, intent.rush);
  const impactAtMs = alignToSimulationFrame(timeMs + rawImpactDelayMs);
  const impactDelayMs = impactAtMs - timeMs;
  const reach = getCombatReach(intent.attack);
  const attackerFrom = clonePoint(attackerState.position);
  const defenderFrom = clonePoint(defenderState.position);
  const lunge = intent.actionType === "strike"
    ? createAttackLunge(context, attackerState, defenderState, reach, timeMs, impactAtMs)
    : null;
  const event: BattleEvent = {
    index: context.actions.length,
    timeMs,
    attackerId: attackerState.id,
    defenderId: defenderState.id,
    attackName: intent.attack.name,
    attackCssClass: intent.attack.cssClass,
    actionType: intent.actionType,
    outcome: "miss",
    critical: false,
    damage: 0,
    defenderHp: Math.max(0, Math.round(defenderState.hp)),
    movement: {
      attackerFrom,
      defenderFrom,
      attackerTo: clonePoint(attackerState.position),
      defenderTo: clonePoint(defenderState.position),
      durationMs: lunge?.durationMs ?? 0,
      attackerDurationMs: lunge?.durationMs ?? 0,
      defenderDurationMs: 0,
      rush: intent.rush,
      defenderRush: false,
      distance: getDistance(attackerState.position, defenderState.position),
    },
    impactDelayMs,
    fatigue: snapshotFatigue(context.fighterIds, context.energyStates, timeMs),
    decisions: createDecisions(context),
    netTrap: intent.actionType === "net"
      ? { escaped: true, durationMs: 0, releaseTimeMs: impactAtMs }
      : undefined,
  };

  context.actions.push(event);
  context.pendingAttacks.push({ event, reach, impactAtMs });
  spendActionEnergy(
    getRuntime(context.fighters, attackerState.id),
    getEnergyState(context.energyStates, attackerState.id),
    intent.actionType,
    false,
    timeMs,
  );

  if (intent.actionType === "net") {
    attackerState.netThrown = true;
  } else if (intent.actionType === "javelin") {
    attackerState.javelinsLeft = Math.max(0, attackerState.javelinsLeft - 1);
    attackerState.usingShortSword = attackerState.javelinsLeft <= 0;
  }

  attackerState.lockedUntilMs = timeMs + Math.round(impactDelayMs * 0.72);
  attackerState.nextAttackReadyMs = impactAtMs + getActionRecoveryMs(attacker, intent.actionType, attackerState.tactic);
}

function createAttackLunge(
  context: RealtimeContext,
  attackerState: RealtimeFighterState,
  defenderState: RealtimeFighterState,
  reach: AttackReach,
  timeMs: number,
  impactAtMs: number,
): { durationMs: number } | null {
  const surfaceDistance = getSurfaceDistance(context, attackerState, defenderState);
  const lungeDistance = getAttackLungeDistance(surfaceDistance, reach);

  if (lungeDistance <= 0) {
    return null;
  }

  const dx = defenderState.position.x - attackerState.position.x;
  const dy = defenderState.position.y - attackerState.position.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= 0.001) {
    return null;
  }

  const direction = { x: dx / distance, y: dy / distance };
  const from = clonePoint(attackerState.position);
  const plannedTo = clampPointToArena({
    x: attackerState.position.x + direction.x * lungeDistance,
    y: attackerState.position.y + direction.y * lungeDistance,
  });
  const to = resolveRestingBodyPoint(
    context,
    attackerState.id,
    plannedTo,
    getRuntime(context.fighters, attackerState.id).bodyRadius,
    { x: -direction.x, y: -direction.y },
  );
  const movedDistance = getDistance(from, to);

  if (movedDistance < MOTION_RECORD_EPSILON) {
    return null;
  }

  const durationMs = Math.max(120, Math.min(Math.round((impactAtMs - timeMs) * 0.58), 360));
  appendMotionSegment(context.motionTracks, {
    fighterId: attackerState.id,
    from,
    to,
    startMs: timeMs,
    endMs: timeMs + durationMs,
    actionType: "strike",
    rush: true,
  });
  attackerState.position = to;
  attackerState.previousPosition = to;
  attackerState.velocity = { x: 0, y: 0 };

  return { durationMs };
}

function resolvePendingAttacks(context: RealtimeContext, untilMs: number): void {
  context.pendingAttacks.sort((a, b) => a.impactAtMs - b.impactAtMs || a.event.index - b.event.index);

  while (context.pendingAttacks.length > 0) {
    const pending = context.pendingAttacks[0]!;
    if (pending.impactAtMs > untilMs) {
      return;
    }

    context.pendingAttacks.shift();
    resolveAttackImpact(context, pending);
  }
}

function resolveAttackImpact(context: RealtimeContext, pending: PendingRealtimeAttack): void {
  const { event, reach, impactAtMs } = pending;
  const attackerState = context.states.get(event.attackerId);
  const defenderState = context.states.get(event.defenderId);
  if (!attackerState || !defenderState) {
    return;
  }

  updateEnergy(context, impactAtMs);
  event.defenderHp = Math.max(0, Math.round(defenderState.hp));

  if (!isAlive(attackerState) || !isAlive(defenderState)) {
    event.outcome = "miss";
    event.critical = false;
    event.damage = 0;
    event.fatigue = snapshotFatigue(context.fighterIds, context.energyStates, impactAtMs);
    return;
  }

  const effectiveFighters = createEffectiveFighters(
    context.fighters,
    context.energyStates,
    impactAtMs,
    context.currentHp,
  );
  const attacker = getRuntime(effectiveFighters, event.attackerId);
  const defender = getRuntime(effectiveFighters, event.defenderId);
  const surfaceDistance = getSurfaceDistance(context, attackerState, defenderState);
  const inReach =
    isSurfaceDistanceInReach(surfaceDistance, reach) &&
    !isAttackLaneBlocked(context, attackerState, defenderState);
  const defenderTrapped = isTrapped(defenderState, impactAtMs);

  if (event.actionType === "net") {
    resolveNetImpact(context, event, attacker, defender, defenderState, impactAtMs, inReach);
  } else if (event.actionType === "javelin") {
    resolveJavelinImpact(context, event, attacker, defender, defenderState, defenderTrapped, inReach, impactAtMs);
  } else {
    resolveStrikeImpact(context, event, attacker, defender, defenderState, defenderTrapped, inReach, impactAtMs);
  }

  spendReactionEnergy(
    getRuntime(context.fighters, defenderState.id),
    getEnergyState(context.energyStates, defenderState.id),
    event.outcome,
    impactAtMs,
  );
  event.fatigue = snapshotFatigue(context.fighterIds, context.energyStates, impactAtMs);
}

function resolveNetImpact(
  context: RealtimeContext,
  event: BattleEvent,
  attacker: BattleFighterRuntime,
  defender: BattleFighterRuntime,
  defenderState: RealtimeFighterState,
  impactAtMs: number,
  inReach: boolean,
): void {
  if (!inReach) {
    event.outcome = "miss";
    event.netTrap = { escaped: true, durationMs: 0, releaseTimeMs: impactAtMs };
    return;
  }

  const plannedNet = planNetTrap(attacker, defender, impactAtMs);
  event.outcome = plannedNet.outcome;
  event.netTrap = plannedNet.netTrap;

  if (!plannedNet.netTrap.escaped) {
    defenderState.trappedUntilMs = Math.max(defenderState.trappedUntilMs, plannedNet.netTrap.releaseTimeMs);
    defenderState.trapperId = event.attackerId;
    defenderState.velocity = { x: 0, y: 0 };
  }

  if (event.outcome === "hit") {
    event.defenderHp = Math.max(0, Math.round(defenderState.hp));
    context.currentHp.set(defenderState.id, event.defenderHp);
  }
}

function resolveJavelinImpact(
  context: RealtimeContext,
  event: BattleEvent,
  attacker: BattleFighterRuntime,
  defender: BattleFighterRuntime,
  defenderState: RealtimeFighterState,
  defenderTrapped: boolean,
  inReach: boolean,
  impactAtMs: number,
): void {
  if (!inReach) {
    event.outcome = "miss";
    event.critical = false;
    return;
  }

  const defenderCanBlock = canShieldBlockProjectiles(defenderState.gladiator);
  const planned = planJavelinOutcome(attacker, defender, defenderCanBlock, defenderTrapped);
  event.outcome = planned.outcome;
  event.critical = planned.critical;

  if (event.outcome === "hit") {
    applyDamage(context, event, attacker, defender, defenderState, defenderTrapped, impactAtMs);
  }
}

function resolveStrikeImpact(
  context: RealtimeContext,
  event: BattleEvent,
  attacker: BattleFighterRuntime,
  defender: BattleFighterRuntime,
  defenderState: RealtimeFighterState,
  defenderTrapped: boolean,
  inReach: boolean,
  impactAtMs: number,
): void {
  if (!inReach) {
    event.outcome = "miss";
    event.critical = false;
    return;
  }

  const planned = planOutcome(attacker, defender, defenderTrapped, getRealtimeDefenseProfile(defenderState));
  event.outcome = planned.outcome;
  event.critical = planned.critical;

  if (event.outcome === "hit") {
    applyDamage(context, event, attacker, defender, defenderState, defenderTrapped, impactAtMs);
  }
}

function applyDamage(
  context: RealtimeContext,
  event: BattleEvent,
  attacker: BattleFighterRuntime,
  defender: BattleFighterRuntime,
  defenderState: RealtimeFighterState,
  defenderTrapped: boolean,
  impactAtMs: number,
): void {
  const damage = Math.min(
    Math.max(0, Math.round(defenderState.hp)),
    calculateStrikeDamage(
      attacker,
      defender,
      event.attackCssClass,
      event.critical,
      defenderTrapped,
    ),
  );

  defenderState.hp = Math.max(0, defenderState.hp - damage);
  event.damage = damage;
  event.defenderHp = Math.max(0, Math.round(defenderState.hp));
  context.currentHp.set(defenderState.id, event.defenderHp);
  context.damageByFighter.set(
    event.attackerId,
    (context.damageByFighter.get(event.attackerId) ?? 0) + damage,
  );

  if (defenderState.hp <= 0 && defenderState.defeatedAtMs === null) {
    defenderState.defeatedAtMs = impactAtMs;
    defenderState.velocity = { x: 0, y: 0 };
    defenderState.trappedUntilMs = 0;
    settleDefeatedBody(context, defenderState, context.states.get(event.attackerId), impactAtMs);
  }
}

function stepMovement(
  context: RealtimeContext,
  effectiveFighters: Record<string, BattleFighterRuntime>,
  timeMs: number,
  frameMs: number,
): void {
  const dt = frameMs / 1_000;
  const snapshot = new Map(
    [...context.states.values()].map((state) => [state.id, clonePoint(state.position)]),
  );
  const desiredVelocities = new Map<string, BattlePoint>();

  for (const state of context.states.values()) {
    state.previousPosition = clonePoint(state.position);
    desiredVelocities.set(
      state.id,
      getDesiredVelocity(context, effectiveFighters, state, snapshot, timeMs),
    );
  }

  for (const state of context.states.values()) {
    if (!isAlive(state)) {
      continue;
    }

    const desired = desiredVelocities.get(state.id) ?? { x: 0, y: 0 };
    const velocity = smoothVelocity(state.velocity, desired, isTrapped(state, timeMs) ? 0.18 : 0.42);
    state.velocity = velocity;
    state.position = clampPointToArena({
      x: state.position.x + velocity.x * dt,
      y: state.position.y + velocity.y * dt,
    });
  }

  resolveCollisions(context, timeMs);
}

function getDesiredVelocity(
  context: RealtimeContext,
  effectiveFighters: Record<string, BattleFighterRuntime>,
  state: RealtimeFighterState,
  snapshot: ReadonlyMap<string, BattlePoint>,
  timeMs: number,
): BattlePoint {
  if (!isAlive(state) || isTrapped(state, timeMs) || timeMs < state.lockedUntilMs) {
    return { x: 0, y: 0 };
  }

  const fighter = getRuntime(effectiveFighters, state.id);
  const target = state.targetId ? context.states.get(state.targetId) : undefined;
  const baseSpeed = getMovementSpeed(fighter);
  let desired = { x: 0, y: 0 };

  if (target && isAlive(target)) {
    desired = getTargetVelocity(context, state, target, baseSpeed);
  }

  const separation = getSeparationVelocity(context, state, snapshot, baseSpeed);
  const obstacleAvoidance =
    target && isAlive(target)
      ? getObstacleAvoidanceVelocity(context, state, target, snapshot, baseSpeed)
      : { x: 0, y: 0 };
  const result = {
    x: desired.x + separation.x + obstacleAvoidance.x,
    y: desired.y + separation.y + obstacleAvoidance.y,
  };

  return limitVector(result, baseSpeed);
}

function getTargetVelocity(
  context: RealtimeContext,
  state: RealtimeFighterState,
  target: RealtimeFighterState,
  baseSpeed: number,
): BattlePoint {
  const dx = target.position.x - state.position.x;
  const dy = target.position.y - state.position.y;
  const distance = Math.hypot(dx, dy);
  const direction = distance > 0.001 ? { x: dx / distance, y: dy / distance } : { x: 0, y: 0 };
  const orbitTangent = { x: -direction.y, y: direction.x };
  const tangent = { x: orbitTangent.x * state.strafeSign, y: orbitTangent.y * state.strafeSign };
  const surfaceDistance = getSurfaceDistance(context, state, target);
  const preferredSurfaceDistance = getPreferredSurfaceDistance(state, target, surfaceDistance);
  const centerGoalDistance =
    preferredSurfaceDistance +
    getRuntime(context.fighters, state.id).bodyRadius +
    getRuntime(context.fighters, target.id).bodyRadius;
  const anchor = clampPointToArena({
    x: target.position.x - direction.x * centerGoalDistance + orbitTangent.x * state.engagementOffset,
    y: target.position.y - direction.y * centerGoalDistance + orbitTangent.y * state.engagementOffset,
  });
  const anchorDx = anchor.x - state.position.x;
  const anchorDy = anchor.y - state.position.y;
  const anchorDistance = Math.hypot(anchorDx, anchorDy);
  const anchorDirection =
    anchorDistance > 0.001
      ? { x: anchorDx / anchorDistance, y: anchorDy / anchorDistance }
      : { x: 0, y: 0 };
  const band = metersToArenaDistance(0.18);

  if (surfaceDistance > preferredSurfaceDistance + band || anchorDistance > band * 1.35) {
    return {
      x: anchorDirection.x * baseSpeed,
      y: anchorDirection.y * baseSpeed,
    };
  }

  if (surfaceDistance < preferredSurfaceDistance - band) {
    return {
      x: -direction.x * baseSpeed * 0.82 + tangent.x * baseSpeed * 0.18,
      y: -direction.y * baseSpeed * 0.82 + tangent.y * baseSpeed * 0.18,
    };
  }

  const pressure = state.tactic === "press" ? 0.2 : state.tactic === "counter" ? -0.12 : 0;

  return {
    x: tangent.x * baseSpeed * 0.32 + direction.x * baseSpeed * pressure,
    y: tangent.y * baseSpeed * 0.32 + direction.y * baseSpeed * pressure,
  };
}

function getSeparationVelocity(
  context: RealtimeContext,
  state: RealtimeFighterState,
  snapshot: ReadonlyMap<string, BattlePoint>,
  baseSpeed: number,
): BattlePoint {
  let x = 0;
  let y = 0;
  const ownPosition = snapshot.get(state.id) ?? state.position;
  const ownRadius = getRuntime(context.fighters, state.id).bodyRadius;

  for (const other of context.states.values()) {
    if (other.id === state.id || (!isAlive(other) && other.defeatedAtMs === null)) {
      continue;
    }

    const otherPosition = snapshot.get(other.id) ?? other.position;
    const otherAlive = isAlive(other);
    const otherRadius = otherAlive
      ? getRuntime(context.fighters, other.id).bodyRadius
      : getDefeatedBodyRadius(context, other.id);
    const dx = ownPosition.x - otherPosition.x;
    const dy = ownPosition.y - otherPosition.y;
    const distance = Math.hypot(dx, dy);
    const padding = otherAlive ? COLLISION_PADDING : DEFEATED_BODY_PADDING;
    const minDistance = ownRadius + otherRadius + padding;
    const influence = otherAlive ? 1.75 : 2.3;

    if (distance >= minDistance * influence) {
      continue;
    }

    const direction =
      distance > 0.001
        ? { x: dx / distance, y: dy / distance }
        : { x: state.teamId === "left" ? -1 : 1, y: state.strafeSign * 0.2 };
    const strength = clamp((minDistance * influence - distance) / (minDistance * influence), 0, 1);
    const teamFactor = otherAlive
      ? other.teamId === state.teamId ? 0.86 : 1.18
      : 1.04;

    x += direction.x * baseSpeed * strength * teamFactor;
    y += direction.y * baseSpeed * strength * teamFactor;
  }

  return limitVector({ x, y }, baseSpeed * 0.96);
}

function getObstacleAvoidanceVelocity(
  context: RealtimeContext,
  state: RealtimeFighterState,
  target: RealtimeFighterState,
  snapshot: ReadonlyMap<string, BattlePoint>,
  baseSpeed: number,
): BattlePoint {
  const ownPosition = snapshot.get(state.id) ?? state.position;
  const targetPosition = snapshot.get(target.id) ?? target.position;
  const laneDx = targetPosition.x - ownPosition.x;
  const laneDy = targetPosition.y - ownPosition.y;
  const laneLength = Math.hypot(laneDx, laneDy);

  if (laneLength <= 0.001) {
    return { x: 0, y: 0 };
  }

  const laneDirection = {
    x: laneDx / laneLength,
    y: laneDy / laneLength,
  };
  let x = 0;
  let y = 0;

  for (const obstacle of context.states.values()) {
    if (
      obstacle.id === state.id ||
      obstacle.id === target.id ||
      obstacle.defeatedAtMs === null
    ) {
      continue;
    }

    const obstaclePosition = snapshot.get(obstacle.id) ?? obstacle.position;
    const projection = getPointToSegmentProjection(obstaclePosition, ownPosition, targetPosition);

    if (projection.t <= 0.05 || projection.t >= 0.92) {
      continue;
    }

    const clearance =
      getDefeatedBodyRadius(context, obstacle.id) +
      getRuntime(context.fighters, state.id).bodyRadius +
      DEFEATED_BODY_PADDING * 1.8;
    if (projection.distance >= clearance * 1.45) {
      continue;
    }

    const side =
      (obstaclePosition.x - ownPosition.x) * laneDirection.y -
      (obstaclePosition.y - ownPosition.y) * laneDirection.x;
    const preferredSide = side === 0 ? state.strafeSign : side > 0 ? -1 : 1;
    const tangent = {
      x: -laneDirection.y * preferredSide,
      y: laneDirection.x * preferredSide,
    };
    const strength = clamp((clearance * 1.45 - projection.distance) / (clearance * 1.45), 0, 1);

    x += tangent.x * baseSpeed * strength * 1.24;
    y += tangent.y * baseSpeed * strength * 1.24;
  }

  return limitVector({ x, y }, baseSpeed * 0.82);
}

function resolveCollisions(context: RealtimeContext, timeMs: number): void {
  const states = [...context.states.values()].filter(isAlive);

  for (let pass = 0; pass < 5; pass += 1) {
    let changed = false;

    for (let i = 0; i < states.length; i += 1) {
      const a = states[i];
      if (!a) {
        continue;
      }

      for (let j = i + 1; j < states.length; j += 1) {
        const b = states[j];
        if (!b) {
          continue;
        }

        const aRadius = getRuntime(context.fighters, a.id).bodyRadius;
        const bRadius = getRuntime(context.fighters, b.id).bodyRadius;
        const minDistance = aRadius + bRadius + COLLISION_PADDING;
        const dx = b.position.x - a.position.x;
        const dy = b.position.y - a.position.y;
        const distance = Math.hypot(dx, dy);

        if (distance >= minDistance) {
          continue;
        }

        const direction =
          distance > 0.001
            ? { x: dx / distance, y: dy / distance }
            : { x: a.teamId === "left" ? 1 : -1, y: a.strafeSign * 0.12 };
        const overlap = minDistance - distance;
        const aLocked = timeMs < a.lockedUntilMs || isTrapped(a, timeMs);
        const bLocked = timeMs < b.lockedUntilMs || isTrapped(b, timeMs);
        const aShare = aLocked && !bLocked ? 0.18 : !aLocked && bLocked ? 0.82 : 0.5;
        const bShare = 1 - aShare;

        a.position = clampPointToArena({
          x: a.position.x - direction.x * overlap * aShare,
          y: a.position.y - direction.y * overlap * aShare,
        });
        b.position = clampPointToArena({
          x: b.position.x + direction.x * overlap * bShare,
          y: b.position.y + direction.y * overlap * bShare,
        });
        changed = true;
      }
    }

    for (const alive of states) {
      for (const fallen of context.states.values()) {
        if (fallen.id === alive.id || fallen.defeatedAtMs === null) {
          continue;
        }

        const aliveRadius = getRuntime(context.fighters, alive.id).bodyRadius;
        const fallenRadius = getDefeatedBodyRadius(context, fallen.id);
        const minDistance = aliveRadius + fallenRadius + DEFEATED_BODY_PADDING;
        const dx = alive.position.x - fallen.position.x;
        const dy = alive.position.y - fallen.position.y;
        const distance = Math.hypot(dx, dy);

        if (distance >= minDistance) {
          continue;
        }

        const direction =
          distance > 0.001
            ? { x: dx / distance, y: dy / distance }
            : { x: alive.teamId === "left" ? -1 : 1, y: alive.strafeSign * 0.16 };
        const overlap = minDistance - distance;

        alive.position = clampPointToArena({
          x: alive.position.x + direction.x * overlap,
          y: alive.position.y + direction.y * overlap,
        });
        changed = true;
      }
    }

    if (!changed) {
      break;
    }
  }
}

function settleDefeatedBody(
  context: RealtimeContext,
  defeatedState: RealtimeFighterState,
  attackerState: RealtimeFighterState | undefined,
  impactAtMs: number,
): void {
  const from = clonePoint(defeatedState.position);
  const away = getDefeatSlideDirection(defeatedState, attackerState);
  const planned = clampPointToArena({
    x: from.x + away.x * DEFEAT_SLIDE_DISTANCE,
    y: from.y + away.y * DEFEAT_SLIDE_DISTANCE * 0.72,
  });
  const to = resolveRestingBodyPoint(
    context,
    defeatedState.id,
    planned,
    getDefeatedBodyRadius(context, defeatedState.id),
    away,
  );
  const distance = getDistance(from, to);

  if (distance > 0.0006) {
    appendMotionSegment(context.motionTracks, {
      fighterId: defeatedState.id,
      from,
      to,
      startMs: impactAtMs,
      endMs: impactAtMs + DEFEAT_SLIDE_MS,
      actionType: "move",
      rush: false,
    });
  }

  defeatedState.position = to;
  defeatedState.previousPosition = clonePoint(to);
}

function getDefeatSlideDirection(
  defeatedState: RealtimeFighterState,
  attackerState: RealtimeFighterState | undefined,
): { x: number; y: number } {
  if (attackerState) {
    const dx = defeatedState.position.x - attackerState.position.x;
    const dy = defeatedState.position.y - attackerState.position.y;
    const distance = Math.hypot(dx, dy);

    if (distance > 0.001) {
      return { x: dx / distance, y: dy / distance };
    }
  }

  return {
    x: defeatedState.teamId === "left" ? -1 : 1,
    y: defeatedState.strafeSign * 0.18,
  };
}

function resolveRestingBodyPoint(
  context: RealtimeContext,
  fighterId: string,
  point: BattlePoint,
  radius: number,
  fallbackDirection: BattlePoint,
): BattlePoint {
  let next = clonePoint(point);

  for (let pass = 0; pass < 6; pass += 1) {
    let changed = false;

    for (const other of context.states.values()) {
      if (other.id === fighterId) {
        continue;
      }

      const otherRadius =
        other.defeatedAtMs === null
          ? getRuntime(context.fighters, other.id).bodyRadius
          : getDefeatedBodyRadius(context, other.id);
      const minDistance = radius + otherRadius + DEFEATED_BODY_PADDING;
      const dx = next.x - other.position.x;
      const dy = next.y - other.position.y;
      const distance = Math.hypot(dx, dy);

      if (distance >= minDistance) {
        continue;
      }

      const direction =
        distance > 0.001
          ? { x: dx / distance, y: dy / distance }
          : normalizeFallbackDirection(fallbackDirection);
      const overlap = minDistance - distance;

      next = clampPointToArena({
        x: next.x + direction.x * overlap,
        y: next.y + direction.y * overlap,
      });
      changed = true;
    }

    if (!changed) {
      break;
    }
  }

  return next;
}

function normalizeFallbackDirection(point: BattlePoint): { x: number; y: number } {
  const length = Math.hypot(point.x, point.y);

  if (length > 0.001) {
    return { x: point.x / length, y: point.y / length };
  }

  return { x: 1, y: 0 };
}

function getDefeatedBodyRadius(context: RealtimeContext, fighterId: string): number {
  return getRuntime(context.fighters, fighterId).bodyRadius * DEFEATED_BODY_RADIUS_FACTOR;
}

function recordMotionSegments(context: RealtimeContext, timeMs: number, frameMs: number): void {
  for (const state of context.states.values()) {
    if (!isAlive(state)) {
      continue;
    }

    const distance = getDistance(state.previousPosition, state.position);
    if (distance < MOTION_RECORD_EPSILON) {
      state.velocity = { x: 0, y: 0 };
      continue;
    }

    const effectiveDistance = Math.max(distance, MOTION_RECORD_EPSILON);
    const actionType: BattleActionType =
      getEnergyState(context.energyStates, state.id).energy <=
      getEnergyState(context.energyStates, state.id).maxEnergy * LOW_ENERGY_RECOVER_RATIO
        ? "recover"
        : "move";

    appendMotionSegment(context.motionTracks, {
      fighterId: state.id,
      from: state.previousPosition,
      to: state.position,
      startMs: timeMs,
      endMs: timeMs + frameMs,
      actionType,
      rush: effectiveDistance > metersToArenaDistance(0.17) * (frameMs / 1_000),
    });

    spendMovementEnergy(
      getRuntime(context.fighters, state.id),
      getEnergyState(context.energyStates, state.id),
      distance,
      false,
      timeMs,
    );
  }
}

function createDecisions(context: RealtimeContext): BattleDecisionSnapshot[] {
  return context.fighterIds.map((fighterId) => {
    const state = context.states.get(fighterId);

    return createDecisionSnapshot(
      fighterId,
      state?.tactic ?? "balanced",
      getEnergyState(context.energyStates, fighterId),
    );
  });
}

function getPreferredSurfaceDistance(
  state: RealtimeFighterState,
  target: RealtimeFighterState,
  surfaceDistance: number,
): number {
  const javelinAttack = getJavelinAttack(state.gladiator);
  if (
    javelinAttack &&
    state.javelinsLeft > 0 &&
    !shouldUseVelesShortSword(state, surfaceDistance)
  ) {
    return metersToArenaDistance(2.65);
  }

  const netAttack = getNetAttack(state.gladiator);
  if (netAttack && !state.netThrown) {
    return normalizeReach(getCombatReach(netAttack)).preferred * 0.88;
  }

  const closeAttack = chooseAttack(state.gladiator, false);
  const reach = normalizeReach(getCombatReach(closeAttack));
  const targetRadiusBias = target.teamId === state.teamId ? 0 : metersToArenaDistance(0.06);

  return Math.max(reach.preferred * 0.82 - targetRadiusBias, metersToArenaDistance(0.22));
}

function shouldUseVelesShortSword(
  state: RealtimeFighterState,
  surfaceDistance: number,
): boolean {
  if (!isVelesGladiator(state.gladiator)) {
    return false;
  }

  if (state.javelinsLeft <= 0) {
    return true;
  }

  const javelinAttack = getJavelinAttack(state.gladiator);
  if (!javelinAttack) {
    return true;
  }

  return surfaceDistance <= getCombatReach(javelinAttack).min + metersToArenaDistance(0.16);
}

function getMovementSpeed(fighter: BattleFighterRuntime): number {
  return metersToArenaDistance(fighter.movementSpeed);
}

function getActionRecoveryMs(
  fighter: BattleFighterRuntime,
  actionType: BattleActionType,
  tactic: BattleTactic,
): number {
  const base =
    actionType === "net"
      ? randomBetween(2_250, 3_200)
      : actionType === "javelin"
        ? randomBetween(1_700, 2_650)
        : randomBetween(760, 1_340);
  const dexterityFactor = clamp(1.16 - fighter.dexterity / 205, 0.78, 1.18);
  const tacticFactor = tactic === "press" ? 0.88 : tactic === "counter" ? 1.08 : tactic === "recover" ? 1.24 : 1;

  return Math.round(base * dexterityFactor * tacticFactor);
}

function getCombatReach(attack: GladiatorAttack): AttackReach {
  const reach = normalizeReach(attack.reach);

  if (attack.cssClass === "attack-trident-thrust") {
    const max = Math.min(reach.max, metersToArenaDistance(0.78));

    return {
      min: reach.min,
      max,
      preferred: Math.min(reach.preferred, max),
    };
  }

  if (attack.cssClass === NET_ATTACK_CSS_CLASS) {
    const max = Math.min(reach.max, metersToArenaDistance(1.35));

    return {
      min: reach.min,
      max,
      preferred: Math.min(reach.preferred, max),
    };
  }

  if (attack.cssClass === JAVELIN_ATTACK_CSS_CLASS) {
    return {
      min: metersToArenaDistance(1.1),
      preferred: metersToArenaDistance(4.4),
      max: reach.max,
    };
  }

  return reach;
}

function isSurfaceDistanceInReach(surfaceDistance: number, reach: AttackReach): boolean {
  const normalized = normalizeReach(reach);

  return (
    surfaceDistance >= normalized.min - ATTACK_REACH_TOLERANCE &&
    surfaceDistance <= normalized.max
  );
}

function getAttackLungeDistance(surfaceDistance: number, reach: AttackReach): number {
  const normalized = normalizeReach(reach);

  if (surfaceDistance < normalized.min - ATTACK_REACH_TOLERANCE) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(0, surfaceDistance - Math.max(0, normalized.max - ATTACK_LUNGE_REACH_MARGIN));
}

function getSurfaceDistance(
  context: RealtimeContext,
  attacker: RealtimeFighterState,
  defender: RealtimeFighterState,
): number {
  const distance = getDistance(attacker.position, defender.position);
  const radii =
    getRuntime(context.fighters, attacker.id).bodyRadius +
    getRuntime(context.fighters, defender.id).bodyRadius;

  return Math.max(0, distance - radii);
}

function isAttackLaneBlocked(
  context: RealtimeContext,
  attacker: RealtimeFighterState,
  target: RealtimeFighterState,
): boolean {
  const laneLength = getDistance(attacker.position, target.position);
  if (laneLength <= 0.001) {
    return false;
  }

  const attackerRadius = getRuntime(context.fighters, attacker.id).bodyRadius;
  const targetRadius = getRuntime(context.fighters, target.id).bodyRadius;
  const minT = clamp(attackerRadius / laneLength, 0.08, 0.32);
  const maxT = clamp(1 - targetRadius / laneLength, 0.68, 0.92);

  for (const blocker of context.states.values()) {
    if (!isAlive(blocker) || blocker.id === attacker.id || blocker.id === target.id) {
      continue;
    }

    const clearance =
      getRuntime(context.fighters, blocker.id).bodyRadius + BODY_BLOCKING_PADDING;
    const projection = getPointToSegmentProjection(blocker.position, attacker.position, target.position);

    if (
      projection.t > minT &&
      projection.t < maxT &&
      projection.distance < clearance
    ) {
      return true;
    }
  }

  return false;
}

function getPointToSegmentProjection(
  point: BattlePoint,
  start: BattlePoint,
  end: BattlePoint,
): { distance: number; t: number } {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq <= 0.000001) {
    return { distance: getDistance(point, start), t: 0 };
  }

  const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq, 0, 1);
  const projected = {
    x: start.x + dx * t,
    y: start.y + dy * t,
  };

  return {
    distance: getDistance(point, projected),
    t,
  };
}

function getRealtimeDefenseProfile(state: RealtimeFighterState): { canBlock: boolean; blockMultiplier: number } {
  if (!isVelesGladiator(state.gladiator)) {
    return { canBlock: true, blockMultiplier: 1 };
  }

  if (state.javelinsLeft > 0 && !state.usingShortSword) {
    return { canBlock: false, blockMultiplier: 0 };
  }

  return { canBlock: true, blockMultiplier: 0.46 };
}

function resolveBattleOutcome(
  context: RealtimeContext,
  fighterIds: readonly string[],
): {
  winnerId: string;
  loserId: string;
  winnerTeamId: BattleTeamId;
  loserTeamId: BattleTeamId;
} {
  const teamScore = new Map<BattleTeamId, number>();
  for (const state of context.states.values()) {
    teamScore.set(state.teamId, (teamScore.get(state.teamId) ?? 0) + Math.max(0, state.hp));
  }

  const rankedTeams = [...teamScore.entries()].sort((a, b) => b[1] - a[1] || randomUnit() - 0.5);
  const winnerTeamId = rankedTeams[0]?.[0] ?? "left";
  const loserTeamId = rankedTeams[rankedTeams.length - 1]?.[0] ?? (winnerTeamId === "left" ? "right" : "left");
  const rankedFighters = fighterIds
    .map((fighterId) => {
      const state = context.states.get(fighterId);
      const runtime = getRuntime(context.fighters, fighterId);
      const hp = state?.hp ?? 0;

      return {
        id: fighterId,
        teamId: context.teams[fighterId] ?? "left",
        hp,
        hpRatio: hp / runtime.maxHp,
        damage: context.damageByFighter.get(fighterId) ?? 0,
        tiebreaker: randomUnit(),
      };
    })
    .sort((a, b) => b.hpRatio - a.hpRatio || b.hp - a.hp || b.damage - a.damage || b.tiebreaker - a.tiebreaker);
  const winnerId =
    rankedFighters.find((fighter) => fighter.teamId === winnerTeamId)?.id ??
    rankedFighters[0]?.id ??
    fighterIds[0]!;
  const loserId =
    [...rankedFighters].reverse().find((fighter) => fighter.teamId === loserTeamId)?.id ??
    rankedFighters[rankedFighters.length - 1]?.id ??
    fighterIds[1] ??
    winnerId;

  return {
    winnerId,
    loserId,
    winnerTeamId,
    loserTeamId,
  };
}

function getAliveTeamCount(context: RealtimeContext): number {
  const aliveTeams = new Set<BattleTeamId>();

  for (const state of context.states.values()) {
    if (isAlive(state)) {
      aliveTeams.add(state.teamId);
    }
  }

  return aliveTeams.size;
}

function isAlive(state: RealtimeFighterState): boolean {
  return state.hp > 0 && state.defeatedAtMs === null;
}

function isTrapped(state: RealtimeFighterState, timeMs: number): boolean {
  return timeMs < state.trappedUntilMs;
}

function smoothVelocity(current: BattlePoint, desired: BattlePoint, blend: number): BattlePoint {
  return {
    x: current.x + (desired.x - current.x) * blend,
    y: current.y + (desired.y - current.y) * blend,
  };
}

function limitVector(vector: BattlePoint, maxLength: number): BattlePoint {
  const length = Math.hypot(vector.x, vector.y);

  if (length <= maxLength || length <= 0.000001) {
    return vector;
  }

  return {
    x: (vector.x / length) * maxLength,
    y: (vector.y / length) * maxLength,
  };
}

function clampPointToArena(point: BattlePoint): BattlePoint {
  return {
    x: clamp(point.x, ARENA_MIN_X, ARENA_MAX_X),
    y: clamp(point.y, ARENA_MIN_Y, ARENA_MAX_Y),
  };
}

function alignToSimulationFrame(timeMs: number): number {
  return Math.ceil(timeMs / FRAME_MS) * FRAME_MS;
}

function getLastActionResolutionMs(events: readonly BattleEvent[]): number {
  if (events.length === 0) {
    return 0;
  }

  return Math.max(...events.map(getActionResolutionTimeMs));
}

function getMotionTrackEndMs(motionTracks: Record<string, readonly { readonly endMs: number }[]>): number {
  return Object.values(motionTracks).reduce((latest, track) => {
    const trackEndMs = track.reduce((trackLatest, segment) => Math.max(trackLatest, segment.endMs), 0);

    return Math.max(latest, trackEndMs);
  }, 0);
}
