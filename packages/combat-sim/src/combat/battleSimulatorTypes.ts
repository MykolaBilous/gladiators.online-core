import type { GladiatorAttack, GladiatorClass } from "../gladiators/gladiatorTypes.js";
import type {
  BattleActionType,
  BattleCounterAttack,
  BattleDecisionSnapshot,
  BattleFatigueSnapshot,
  BattleMovement,
  BattleNetTrap,
  BattleOutcome,
  BattlePoint,
  BattleTactic,
} from "./battleTypes.js";

export interface PlannedAction {
  index: number;
  timeMs: number;
  attackerId: string;
  defenderId: string;
  attackName: string;
  attackCssClass: string;
  actionType: BattleActionType;
  outcome: BattleOutcome;
  critical: boolean;
  damage: number;
  defenderHp: number;
  movement: BattleMovement;
  impactDelayMs: number;
  fatigue: BattleFatigueSnapshot[];
  decisions: BattleDecisionSnapshot[];
  counterAttack?: BattleCounterAttack;
  netTrap?: BattleNetTrap;
}

export interface FighterEnergyState {
  energy: number;
  maxEnergy: number;
  recoveryUntilMs: number;
  lastUpdatedMs: number;
}

export interface FighterMotionState {
  from: BattlePoint;
  to: BattlePoint;
  startMs: number;
  endMs: number;
}

export interface FighterTrapState {
  trappedFromMs: number;
  trappedUntilMs: number;
  trapperId: string;
}

export interface PlannedTrapWindow {
  fighterId: string;
  fromMs: number;
  untilMs: number;
}

export interface FighterBrain {
  id: string;
  gladiator: GladiatorClass;
  nextDecisionMs: number;
  tactic: BattleTactic;
  targetId: string | null;
  netThrown: boolean;
  javelinsLeft: number;
  usingShortSword: boolean;
}

export type TimedBattleAction = Pick<
  PlannedAction,
  "timeMs" | "movement" | "actionType" | "impactDelayMs" | "index"
>;

export type AttackReach = GladiatorAttack["reach"];
