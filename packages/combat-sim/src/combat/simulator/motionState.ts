import type { BattlePoint } from "../battleTypes.js";
import type { FighterMotionState } from "../battleSimulatorTypes.js";
import { clamp, clonePoint } from "./math.js";

export function interpolatePoint(from: BattlePoint, to: BattlePoint, progress: number): BattlePoint {
  return {
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress,
  };
}

export function getMotionPosition(motion: FighterMotionState, timeMs: number): BattlePoint {
  if (timeMs <= motion.startMs) {
    return clonePoint(motion.from);
  }

  if (timeMs >= motion.endMs || motion.endMs <= motion.startMs) {
    return clonePoint(motion.to);
  }

  return interpolatePoint(
    motion.from,
    motion.to,
    clamp((timeMs - motion.startMs) / (motion.endMs - motion.startMs), 0, 1),
  );
}

export function createMotionStates(
  fighterIds: readonly string[],
  startPositions: Record<string, BattlePoint>,
): Map<string, FighterMotionState> {
  return new Map(
    fighterIds.map((fighterId) => {
      const position = clonePoint(startPositions[fighterId] ?? { x: 0.5, y: 0.58 });

      return [
        fighterId,
        {
          from: position,
          to: clonePoint(position),
          startMs: 0,
          endMs: 0,
        },
      ];
    }),
  );
}

export function getFighterPosition(
  motions: Map<string, FighterMotionState>,
  fighterId: string,
  timeMs: number,
): BattlePoint {
  const motion = motions.get(fighterId);

  if (!motion) {
    throw new Error(`Missing motion state for fighter: ${fighterId}`);
  }

  return getMotionPosition(motion, timeMs);
}
