import type { GladiatorClass, GladiatorStatPoints } from "./gladiatorTypes.js";
import { gladiatorClasses, murmillo, retiarius } from "./gladiatorClasses.js";
import {
  addStatPoints,
  createEmptyStatPoints,
  createProgressedGladiator,
  createRandomLevelZeroPoints,
  getAutoBonusPoints,
  MIN_GLADIATOR_LEVEL,
} from "./gladiatorProgression.js";

export type TeamId = "left" | "right";

export const TEAM_IDS: readonly TeamId[] = ["left", "right"] as const;

export const TEAM_LABELS: Record<TeamId, string> = {
  left: "Ліва команда",
  right: "Права команда",
};

export const MIN_TEAM_SIZE = 1;
export const MAX_TEAM_SIZE = 10;

export type TrainingMode = "auto" | "manual";

export interface RosterSlot {
  instanceId: string;
  teamId: TeamId;
  teamSlot: number;
  classId: string;
  displayName: string;
  level: number;
  levelZeroPoints: GladiatorStatPoints;
  manualBonusPoints: GladiatorStatPoints;
}

export interface Roster {
  left: RosterSlot[];
  right: RosterSlot[];
}

export interface RuntimeGladiator extends GladiatorClass {
  classId: string;
  teamId: TeamId;
  displayName: string;
  instanceId: string;
  level: number;
}

const fighterNamePool = [
  "Север",
  "Варрон",
  "Корвін",
  "Тиберій",
  "Марцелл",
  "Децим",
  "Аттій",
  "Флавій",
  "Аврелій",
  "Кассій",
  "Луцій",
  "Марк",
  "Гай",
  "Квінт",
  "Публій",
  "Секст",
  "Тит",
  "Лівій",
  "Леонід",
  "Дамон",
  "Філон",
  "Нікандр",
  "Деметрій",
  "Лісандр",
  "Клеон",
  "Орест",
  "Ахілл",
  "Гектор",
  "Персей",
  "Евандр",
];

export function getGladiatorClass(classId: string): GladiatorClass {
  const found = gladiatorClasses.find((item) => item.id === classId);

  if (!found) {
    throw new Error(`Unknown gladiator class: ${classId}`);
  }

  return found;
}

export function listGladiatorClasses(): readonly GladiatorClass[] {
  return gladiatorClasses;
}

export function createInstanceId(teamId: TeamId, slot: number): string {
  return `${teamId}-${slot}`;
}

function pickUnusedName(usedNames: ReadonlySet<string>, fallback: string): string {
  const available = fighterNamePool.filter((name) => !usedNames.has(name));
  const pool = available.length > 0 ? available : fighterNamePool;
  const index = Math.floor(Math.random() * pool.length);

  return pool[index] ?? fallback;
}

export function collectUsedNames(roster: Roster): Set<string> {
  const used = new Set<string>();

  for (const team of TEAM_IDS) {
    for (const slot of roster[team]) {
      used.add(slot.displayName);
    }
  }

  return used;
}

export function createSlot(
  teamId: TeamId,
  slotIndex: number,
  classId: string,
  usedNames: ReadonlySet<string>,
): RosterSlot {
  const klass = getGladiatorClass(classId);

  return {
    instanceId: createInstanceId(teamId, slotIndex),
    teamId,
    teamSlot: slotIndex,
    classId: klass.id,
    displayName: pickUnusedName(usedNames, klass.name),
    level: MIN_GLADIATOR_LEVEL,
    levelZeroPoints: createRandomLevelZeroPoints(),
    manualBonusPoints: createEmptyStatPoints(),
  };
}

export function createAutoRoster(): Roster {
  const used = new Set<string>();
  const leftSlot = createSlot("left", 0, murmillo.id, used);
  used.add(leftSlot.displayName);
  const rightSlot = createSlot("right", 0, retiarius.id, used);

  return {
    left: [leftSlot],
    right: [rightSlot],
  };
}

export function createManualDefaultRoster(): Roster {
  return createAutoRoster();
}

export function reindexSlots(slots: RosterSlot[], teamId: TeamId): RosterSlot[] {
  return slots.map((slot, index) => ({
    ...slot,
    teamId,
    teamSlot: index,
    instanceId: createInstanceId(teamId, index),
  }));
}

export function setTeamSize(
  roster: Roster,
  teamId: TeamId,
  size: number,
  defaultClassId: string,
): Roster {
  const clamped = Math.max(MIN_TEAM_SIZE, Math.min(MAX_TEAM_SIZE, Math.floor(size)));
  const current = roster[teamId];
  const used = collectUsedNames(roster);
  const next = current.slice(0, clamped);

  while (next.length < clamped) {
    const slot = createSlot(teamId, next.length, defaultClassId, used);
    used.add(slot.displayName);
    next.push(slot);
  }

  return {
    ...roster,
    [teamId]: reindexSlots(next, teamId),
  };
}

export function setSlotClass(
  roster: Roster,
  teamId: TeamId,
  slotIndex: number,
  classId: string,
): Roster {
  const klass = getGladiatorClass(classId);
  const team = roster[teamId].map((slot, index) =>
    index === slotIndex ? { ...slot, classId: klass.id } : slot,
  );

  return { ...roster, [teamId]: team };
}

export function getAllSlots(roster: Roster): RosterSlot[] {
  return [...roster.left, ...roster.right];
}

export function getSlotByInstanceId(
  roster: Roster,
  instanceId: string,
): RosterSlot | undefined {
  return getAllSlots(roster).find((slot) => slot.instanceId === instanceId);
}

export function getAllocatedBonusPoints(
  slot: RosterSlot,
  mode: TrainingMode,
): GladiatorStatPoints {
  const klass = getGladiatorClass(slot.classId);

  return mode === "auto"
    ? getAutoBonusPoints(klass, slot.level)
    : slot.manualBonusPoints;
}

export function getConfiguredStatPoints(
  slot: RosterSlot,
  mode: TrainingMode,
): GladiatorStatPoints {
  return addStatPoints(slot.levelZeroPoints, getAllocatedBonusPoints(slot, mode));
}

export function buildRuntimeGladiator(
  slot: RosterSlot,
  mode: TrainingMode,
): RuntimeGladiator {
  const klass = getGladiatorClass(slot.classId);
  const progressed = createProgressedGladiator(
    klass,
    slot.level,
    getConfiguredStatPoints(slot, mode),
  );

  return {
    ...progressed,
    id: slot.instanceId,
    classId: klass.id,
    teamId: slot.teamId,
    displayName: slot.displayName,
    instanceId: slot.instanceId,
    level: slot.level,
  };
}

export function buildRuntimeGladiators(
  roster: Roster,
  mode: TrainingMode,
): RuntimeGladiator[] {
  return getAllSlots(roster).map((slot) => buildRuntimeGladiator(slot, mode));
}

export function buildTeamMap(
  roster: Roster,
): Record<string, TeamId> {
  const teams: Record<string, TeamId> = {};

  for (const team of TEAM_IDS) {
    for (const slot of roster[team]) {
      teams[slot.instanceId] = team;
    }
  }

  return teams;
}
