export type BattleOutcome = "hit" | "block" | "miss";
export type BattleActionType = "strike" | "net" | "javelin" | "move" | "recover";
export type BattleTactic = "press" | "balanced" | "counter" | "recover";
export type BattleTeamId = "left" | "right";

export interface BattlePoint {
  x: number;
  y: number;
}

export interface BattleMovement {
  attackerFrom: BattlePoint;
  defenderFrom: BattlePoint;
  attackerTo: BattlePoint;
  defenderTo: BattlePoint;
  durationMs: number;
  attackerDurationMs: number;
  defenderDurationMs: number;
  rush: boolean;
  defenderRush: boolean;
  distance: number;
}

export interface BattleMotionSegment {
  fighterId: string;
  from: BattlePoint;
  to: BattlePoint;
  startMs: number;
  endMs: number;
  actionType: BattleActionType;
  rush: boolean;
}

export interface BattleNetTrap {
  escaped: boolean;
  durationMs: number;
  releaseTimeMs: number;
}

export interface BattleCounterAttack {
  attackerId: string;
  defenderId: string;
  attackName: string;
  attackCssClass: string;
  impactDelayMs: number;
  canceled: boolean;
}

export interface BattleFatigueSnapshot {
  fighterId: string;
  energyPercent: number;
  winded: boolean;
  recoveryUntilMs: number;
}

export interface BattleDecisionSnapshot {
  fighterId: string;
  tactic: BattleTactic;
  energyPercent: number;
}

export interface BattleFighterRuntime {
  id: string;
  name: string;
  maxHp: number;
  maxEnergy: number;
  recoveryRate: number;
  attack: number;
  defense: number;
  movementSpeed: number;
  dexterity: number;
  endurance: number;
  mobility: number;
  focus: number;
  stamina: number;
  aggression: number;
  bodyRadius: number;
}

export interface BattleEvent {
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

export interface BattlePlan {
  id: string;
  seed: string;
  durationMs: number;
  winnerId: string;
  loserId: string;
  winnerTeamId: BattleTeamId;
  loserTeamId: BattleTeamId;
  teams: Record<string, BattleTeamId>;
  fighters: Record<string, BattleFighterRuntime>;
  startPositions: Record<string, BattlePoint>;
  motionTracks: Record<string, BattleMotionSegment[]>;
  events: BattleEvent[];
}
