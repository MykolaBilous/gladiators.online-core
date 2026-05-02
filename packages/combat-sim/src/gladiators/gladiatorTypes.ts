export interface GladiatorStats {
  hp: number;
  attack: number;
  defense: number;
  dexterity: number;
  endurance: number;
}

export type GladiatorStatKey = keyof GladiatorStats;

export type GladiatorStatPoints = Record<GladiatorStatKey, number>;

export type GladiatorStatMultipliers = Record<GladiatorStatKey, number>;

export interface GladiatorAttackReach {
  min: number;
  preferred: number;
  max: number;
}

export interface GladiatorAttack {
  name: string;
  cssClass: string;
  reach: GladiatorAttackReach;
}

export interface GladiatorClass {
  id: string;
  name: string;
  title: string;
  description: string;
  weapon: string;
  defense: string;
  movementSpeed: number;
  stats: GladiatorStats;
  statMultipliers: GladiatorStatMultipliers;
  attacks: GladiatorAttack[];
}
