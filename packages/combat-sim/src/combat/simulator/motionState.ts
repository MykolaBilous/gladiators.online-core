import type { BattleActionType, BattleMotionSegment, BattlePoint } from "../battleTypes.js";
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

export function createMotionTracks(
  fighterIds: readonly string[],
): Map<string, BattleMotionSegment[]> {
  return new Map(fighterIds.map((fighterId) => [fighterId, []]));
}

export function appendMotionSegment(
  motionTracks: Map<string, BattleMotionSegment[]>,
  segment: {
    readonly fighterId: string;
    readonly from: BattlePoint;
    readonly to: BattlePoint;
    readonly startMs: number;
    readonly endMs: number;
    readonly actionType: BattleActionType;
    readonly rush: boolean;
  },
): void {
  if (segment.endMs <= segment.startMs) {
    return;
  }

  const track = motionTracks.get(segment.fighterId);
  if (!track) {
    throw new Error(`Missing motion track for fighter: ${segment.fighterId}`);
  }

  const previous = track.at(-1);
  if (previous && previous.endMs > segment.startMs) {
    previous.to = clonePoint(segment.from);
    previous.endMs = segment.startMs;

    if (previous.endMs <= previous.startMs) {
      track.pop();
    }
  }

  track.push({
    fighterId: segment.fighterId,
    from: clonePoint(segment.from),
    to: clonePoint(segment.to),
    startMs: segment.startMs,
    endMs: segment.endMs,
    actionType: segment.actionType,
    rush: segment.rush,
  });
}

export function toMotionTrackRecord(
  fighterIds: readonly string[],
  motionTracks: ReadonlyMap<string, readonly BattleMotionSegment[]>,
): Record<string, BattleMotionSegment[]> {
  return fighterIds.reduce<Record<string, BattleMotionSegment[]>>((acc, fighterId) => {
    acc[fighterId] = (motionTracks.get(fighterId) ?? []).map((segment) => ({
      ...segment,
      from: clonePoint(segment.from),
      to: clonePoint(segment.to),
    }));

    return acc;
  }, {});
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
