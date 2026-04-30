import type { GladiatorAttack, GladiatorClass } from "../../gladiators/gladiatorTypes.js";
import type { BattlePoint } from "../battleTypes.js";
import {
  JAVELIN_ATTACK_CSS_CLASS,
  NET_ATTACK_CSS_CLASS,
  SHIELD_CLASS_IDS,
  VELES_CLASS_ID,
} from "./constants.js";

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

export const clonePoint = (point: BattlePoint): BattlePoint => ({ x: point.x, y: point.y });

export const getDistance = (a: BattlePoint, b: BattlePoint): number =>
  Math.hypot(a.x - b.x, a.y - b.y);

export function getGladiatorClassId(gladiator: GladiatorClass): string {
  return (gladiator as GladiatorClass & { classId?: string }).classId ?? gladiator.id;
}

export function isVelesGladiator(gladiator: GladiatorClass): boolean {
  return getGladiatorClassId(gladiator) === VELES_CLASS_ID;
}

export function canShieldBlockProjectiles(gladiator: GladiatorClass): boolean {
  return SHIELD_CLASS_IDS.has(getGladiatorClassId(gladiator));
}

export function isProjectileAttack(attack: GladiatorAttack): boolean {
  return attack.cssClass === NET_ATTACK_CSS_CLASS || attack.cssClass === JAVELIN_ATTACK_CSS_CLASS;
}
