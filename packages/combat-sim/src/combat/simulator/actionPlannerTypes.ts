import type { GladiatorClass } from "../../gladiators/gladiatorTypes.js";
import type {
  BattleDecisionSnapshot,
  BattleFighterRuntime,
  BattlePoint,
  BattleTeamId,
} from "../battleTypes.js";
import type {
  AttackReach,
  FighterBrain,
  FighterEnergyState,
  FighterMotionState,
  FighterTrapState,
  PlannedAction,
} from "../battleSimulatorTypes.js";

export interface BattleSimulationResult {
  actions: PlannedAction[];
  winnerId: string;
  loserId: string;
  winnerTeamId: BattleTeamId;
  loserTeamId: BattleTeamId;
  durationMs: number;
}

export interface PendingActionResolution {
  action: PlannedAction;
  reach: AttackReach;
}

export interface BattleActionPlannerContext {
  actions: PlannedAction[];
  fighterIds: string[];
  energyStates: Map<string, FighterEnergyState>;
  currentHp: Map<string, number>;
  damageByFighter: Map<string, number>;
  motions: Map<string, FighterMotionState>;
  traps: Map<string, FighterTrapState>;
  pendingResolutions: PendingActionResolution[];
  brains: FighterBrain[];
  fighters: Record<string, BattleFighterRuntime>;
  teams: Record<string, BattleTeamId>;
  getHp: (fighterId: string) => number;
  getHpRatio: (fighterId: string) => number;
  isDefeated: (fighterId: string) => boolean;
  getAliveTeamCount: () => number;
  getDefenderHp: (fighterId: string) => number;
  recoverAllEnergy: (timeMs: number) => void;
  isTrapped: (fighterId: string, timeMs: number) => boolean;
  createDecisions: () => BattleDecisionSnapshot[];
  getBrain: (fighterId: string) => FighterBrain | undefined;
  getEnemyCandidateIds: (brain: FighterBrain) => string[];
}

export interface CreateActionPlannerContextInput {
  gladiators: readonly GladiatorClass[];
  fighters: Record<string, BattleFighterRuntime>;
  startPositions: Record<string, BattlePoint>;
  teams: Record<string, BattleTeamId>;
}
