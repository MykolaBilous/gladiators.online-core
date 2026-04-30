import type { BattlePlan, BattlePoint } from "./battleTypes.js";
import type { Roster, TeamId, TrainingMode } from "../gladiators/roster.js";

export interface BattleReplaySpawnCell {
  column: number;
  row: number;
}

export interface BattleReplaySetup {
  trainingMode: TrainingMode;
  roster: Roster;
  spawnPositions: Record<string, BattlePoint>;
  manualSpawnPlacements: Partial<Record<string, BattleReplaySpawnCell>>;
  teamSpawnSeeds: Record<TeamId, number>;
}

export interface BattleReplayRecord {
  version: 1;
  battleId: string;
  seed: string;
  createdAt: string;
  winnerTeamId: string;
  loserTeamId: string;
  fighterIds: string[];
  setup: BattleReplaySetup;
  plan: BattlePlan;
}
