import { createArenaReach, metersToArenaDistance } from "../../config/arenaScale.js";

export const NET_ATTACK_CSS_CLASS = "attack-net-throw";
export const JAVELIN_ATTACK_CSS_CLASS = "attack-javelin-throw";
export const VELES_CLASS_ID = "veles";
export const SHIELD_CLASS_IDS = new Set(["murmillo"]);
export const JAVELIN_STARTING_COUNT = 3;
export const MAX_REACH_DISTANCE = metersToArenaDistance(6);
export const DEFAULT_STRIKE_REACH = createArenaReach(1);
export const DEFAULT_NET_REACH = createArenaReach(2);
export const DEFAULT_JAVELIN_REACH = {
  min: 0,
  preferred: metersToArenaDistance(6),
  max: MAX_REACH_DISTANCE,
};
export const MIN_REACH_WIDTH = metersToArenaDistance(0.08);
export const REACH_TOLERANCE = 0;
export const MIN_MOVEMENT_DISTANCE = metersToArenaDistance(0.06);
export const HOME_SIDE_SEPARATION = metersToArenaDistance(0.25);
export const LATERAL_ALIGNMENT_DISTANCE = metersToArenaDistance(0.1);
export const JAVELIN_ALIGNMENT_DISTANCE = metersToArenaDistance(0.7);
export const JAVELIN_SAFE_DISTANCE = metersToArenaDistance(2.45);
export const MIN_STEADY_STEP = metersToArenaDistance(0.4);
export const MAX_STEADY_STEP = metersToArenaDistance(0.75);
export const STEP_DURATION_MS = 360;
export const MOVEMENT_ENERGY_PER_STEP = 3.4;
export const ARENA_MIN_X = 0.04;
export const ARENA_MAX_X = 0.96;
export const ARENA_MIN_Y = 0.08;
export const ARENA_MAX_Y = 0.97;
