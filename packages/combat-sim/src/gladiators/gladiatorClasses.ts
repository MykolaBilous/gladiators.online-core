import { createArenaReach, metersToArenaDistance } from "../config/arenaScale.js";
import type { GladiatorClass } from "./gladiatorTypes.js";

export type {
  GladiatorAttack,
  GladiatorAttackReach,
  GladiatorClass,
  GladiatorStatKey,
  GladiatorStatMultipliers,
  GladiatorStatPoints,
  GladiatorStats,
} from "./gladiatorTypes.js";

export const murmillo: GladiatorClass = {
  id: "murmillo",
  name: "Мурміллон",
  title: "Важкий боєць",
  description:
    "Важкоозброєний гладіатор з великим щитом та коротким мечем. Повільний, але надзвичайно витривалий у бою.",
  weapon: "Гладіус (короткий меч)",
  defense: "Скутум (великий щит)",
  movementSpeed: 0.34,
  stats: { hp: 15, attack: 10, defense: 14, dexterity: 7, endurance: 15 },
  statMultipliers: {
    hp: 1.3,
    attack: 1.1,
    defense: 1.5,
    dexterity: 0.8,
    endurance: 1.3,
  },
  attacks: [
    {
      name: "Удар мечем",
      cssClass: "attack-sword-slash",
      reach: createArenaReach(0.85),
    },
    {
      name: "Удар щитом",
      cssClass: "attack-shield-bash",
      reach: createArenaReach(0.5),
    },
  ],
};

export const retiarius: GladiatorClass = {
  id: "retiarius",
  name: "Ретіарій",
  title: "Спритний мисливець",
  description:
    "Легкоозброєний гладіатор із тризубом та сіткою. Швидкий і смертоносний, але вразливий до потужних ударів.",
  weapon: "Тризуб",
  defense: "Спис (парирування)",
  movementSpeed: 0.42,
  stats: { hp: 10, attack: 13, defense: 6, dexterity: 16, endurance: 10 },
  statMultipliers: {
    hp: 1,
    attack: 1.1,
    defense: 0.7,
    dexterity: 1.5,
    endurance: 1,
  },
  attacks: [
    {
      name: "Удар тризубом",
      cssClass: "attack-trident-thrust",
      reach: createArenaReach(0.78),
    },
    {
      name: "Кидок сітки",
      cssClass: "attack-net-throw",
      reach: createArenaReach(1.35),
    },
  ],
};

export const veles: GladiatorClass = {
  id: "veles",
  name: "Веліт",
  title: "Легкий списометальник",
  description:
    "Швидкий гладіатор із трьома метальними списами та коротким мечем. Тримає максимальну дистанцію, прицілюється перед кожним кидком, а в ближньому бою переходить на короткий клинок.",
  weapon: "Три метальні списи, короткий меч",
  defense: "Ухилення зі списом, слабкий блок коротким мечем",
  movementSpeed: 0.46,
  stats: { hp: 10, attack: 12, defense: 6, dexterity: 15, endurance: 11 },
  statMultipliers: {
    hp: 0.9,
    attack: 1.2,
    defense: 0.7,
    dexterity: 1.5,
    endurance: 1,
  },
  attacks: [
    {
      name: "Кидок списа",
      cssClass: "attack-javelin-throw",
      reach: {
        min: 0,
        preferred: metersToArenaDistance(6),
        max: metersToArenaDistance(6),
      },
    },
    {
      name: "Короткий меч",
      cssClass: "attack-veles-sword",
      reach: createArenaReach(0.62),
    },
  ],
};

export const gladiatorClasses: GladiatorClass[] = [murmillo, retiarius, veles];
