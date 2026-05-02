import { describe, expect, it } from "vitest";
import {
  createEmptyStatPoints,
  createBattlePlan,
  createProgressedGladiator,
  metersToArenaDistance,
  murmillo,
  retiarius,
  veles,
  type BattlePlan,
  type BattleEvent,
  type BattlePoint,
  type GladiatorClass,
} from "./index.js";

describe("createBattlePlan", () => {
  it("returns reproducible plans for the same seed", () => {
    const teams = {
      murmillo: "left",
      retiarius: "right",
      veles: "right",
    } as const;
    const seed = "arena-replay-42";
    const fighters = [murmillo, retiarius, veles];

    expect(createBattlePlan(fighters, teams, undefined, { seed })).toEqual(
      createBattlePlan(fighters, teams, undefined, { seed }),
    );
  });

  it("stores the seed on the battle plan for replay/debugging", () => {
    const plan = createBattlePlan([murmillo, retiarius], undefined, undefined, {
      seed: "debug-seed",
    });

    expect(plan.seed).toBe("debug-seed");
  });

  it("uses different deterministic ids for different seeds", () => {
    const first = createBattlePlan([murmillo, retiarius], undefined, undefined, {
      seed: "first",
    });
    const second = createBattlePlan([murmillo, retiarius], undefined, undefined, {
      seed: "second",
    });

    expect(first.id).not.toBe(second.id);
  });

  it("stores body radii and continuous motion tracks", () => {
    const plan = createBattlePlan([murmillo, retiarius, veles], {
      murmillo: "left",
      retiarius: "right",
      veles: "right",
    }, undefined, {
      seed: "motion-tracks",
    });
    const murmilloRuntime = plan.fighters.murmillo;
    const allSegments = Object.values(plan.motionTracks).flat();

    expect(murmilloRuntime?.bodyRadius).toBeGreaterThan(0);
    expect(allSegments.length).toBeGreaterThan(0);
    expect(allSegments.every((segment) => segment.endMs > segment.startMs)).toBe(true);
  });

  it("keeps movement speed fixed by class instead of stat points", () => {
    const points = createEmptyStatPoints();
    points.dexterity = 24;
    points.endurance = 24;
    const trainedMurmillo = withGladiatorId(
      createProgressedGladiator(murmillo, 12, points),
      "trained-murmillo",
    );
    const plan = createBattlePlan(
      [trainedMurmillo, withGladiatorId(retiarius, "base-retiarius")],
      { "trained-murmillo": "left", "base-retiarius": "right" },
      undefined,
      { seed: "fixed-class-movement-speed" },
    );

    expect(plan.fighters["trained-murmillo"]?.movementSpeed).toBe(murmillo.movementSpeed);
    expect(plan.fighters["base-retiarius"]?.movementSpeed).toBe(retiarius.movementSpeed);
  });

  it("stores attack maximum reach in arena-scaled meters", () => {
    const javelinAttack = veles.attacks.find(
      (attack) => attack.cssClass === "attack-javelin-throw",
    );

    expect(javelinAttack?.reach.max).toBe(metersToArenaDistance(6));
    expect(javelinAttack?.reach.max).toBeLessThan(1);
  });

  it("separates overlapping requested spawn footprints", () => {
    const plan = createBattlePlan(
      [murmillo, retiarius],
      { murmillo: "left", retiarius: "right" },
      {
        murmillo: { x: 0.5, y: 0.5 },
        retiarius: { x: 0.5, y: 0.5 },
      },
      { seed: "overlapping-spawns" },
    );
    const murmilloPosition = plan.startPositions.murmillo;
    const retiariusPosition = plan.startPositions.retiarius;
    const murmilloRuntime = plan.fighters.murmillo;
    const retiariusRuntime = plan.fighters.retiarius;

    if (!murmilloPosition || !retiariusPosition || !murmilloRuntime || !retiariusRuntime) {
      throw new Error("Expected test fighters to be present in the battle plan");
    }

    const distance = Math.hypot(
      murmilloPosition.x - retiariusPosition.x,
      murmilloPosition.y - retiariusPosition.y,
    );

    expect(distance).toBeGreaterThanOrEqual(
      murmilloRuntime.bodyRadius + retiariusRuntime.bodyRadius - 0.001,
    );
  });

  it("runs crowded 10v10 battles with simultaneous movement frames", () => {
    const { fighters, teams, startPositions } = createCrowdedBattleSetup();
    const plan = createBattlePlan(fighters, teams, startPositions, {
      seed: "crowded-10v10",
    });
    const frameCounts = new Map<number, number>();

    for (const track of Object.values(plan.motionTracks)) {
      for (const segment of track) {
        frameCounts.set(segment.startMs, (frameCounts.get(segment.startMs) ?? 0) + 1);
      }
    }

    expect(plan.events.length).toBeGreaterThan(10);
    expect([...frameCounts.values()].some((count) => count >= 12)).toBe(true);
  });

  it("spreads early melee pressure instead of dogpiling one target in 10v10", () => {
    const { fighters, teams, startPositions } = createManualGridMurmilloSetup();
    const plan = createBattlePlan(fighters, teams, startPositions, {
      seed: "ui-all-murmillo",
    });
    const targetCounts = new Map<string, number>();

    for (const event of plan.events.slice(0, 40)) {
      targetCounts.set(event.defenderId, (targetCounts.get(event.defenderId) ?? 0) + 1);
    }

    expect(targetCounts.size).toBeGreaterThanOrEqual(8);
    expect(Math.max(...targetCounts.values())).toBeLessThanOrEqual(7);
  });

  it("keeps living fighters from standing inside each other's footprint in 10v10", () => {
    const { fighters, teams, startPositions } = createCrowdedBattleSetup();
    const plan = createBattlePlan(fighters, teams, startPositions, {
      seed: "crowded-collisions",
    });
    const deathTimes = getDeathTimes(plan);

    for (let timeMs = 0; timeMs <= Math.min(plan.durationMs, 20_000); timeMs += 320) {
      const aliveIds = Object.keys(plan.fighters).filter(
        (fighterId) => (deathTimes.get(fighterId) ?? Number.POSITIVE_INFINITY) > timeMs,
      );

      for (let i = 0; i < aliveIds.length; i += 1) {
        const leftId = aliveIds[i];
        if (!leftId) {
          continue;
        }

        for (let j = i + 1; j < aliveIds.length; j += 1) {
          const rightId = aliveIds[j];
          if (!rightId) {
            continue;
          }

          const left = samplePlanPosition(plan, leftId, timeMs);
          const right = samplePlanPosition(plan, rightId, timeMs);
          const distance = getDistance(left, right);
          const minDistance =
            (plan.fighters[leftId]?.bodyRadius ?? 0) +
            (plan.fighters[rightId]?.bodyRadius ?? 0) -
            metersToArenaDistance(0.08);

          expect(distance).toBeGreaterThanOrEqual(minDistance);
        }
      }
    }
  });

  it("does not let retiarius land trident hits from unrealistic surface distance", () => {
    const plan = createBattlePlan(
      [withGladiatorId(retiarius, "retiarius-left"), withGladiatorId(murmillo, "murmillo-right")],
      { "retiarius-left": "left", "murmillo-right": "right" },
      {
        "retiarius-left": { x: 0.28, y: 0.54 },
        "murmillo-right": { x: 0.72, y: 0.54 },
      },
      { seed: "retiarius-range" },
    );
    const landedTridentEvents = plan.events.filter(
      (event) => event.attackCssClass === "attack-trident-thrust" && event.outcome !== "miss",
    );

    expect(landedTridentEvents.length).toBeGreaterThan(0);
    for (const event of landedTridentEvents) {
      const impactMs = event.timeMs + event.movement.durationMs + event.impactDelayMs;
      const attacker = samplePlanPosition(plan, event.attackerId, impactMs);
      const defender = samplePlanPosition(plan, event.defenderId, impactMs);
      const surfaceDistance =
        getDistance(attacker, defender) -
        (plan.fighters[event.attackerId]?.bodyRadius ?? 0) -
        (plan.fighters[event.defenderId]?.bodyRadius ?? 0);

      expect(surfaceDistance).toBeLessThanOrEqual(metersToArenaDistance(0.78) + metersToArenaDistance(0.06));
    }
  });

  it("keeps late 10v10 fights active after nets and fallen bodies split the arena", () => {
    const { fighters, teams, startPositions } = createCrowdedBattleSetup();

    for (const seed of ["mooklfg6-fnnou5", "late-net-check-2", "1epjtr8-3np"]) {
      const plan = createBattlePlan(fighters, teams, startPositions, { seed });

      expect(getMaxCombatGapAfterOpening(plan)).toBeLessThanOrEqual(5_200);
    }

    const matchup = createManualGridMurmilloVsRetiariusSetup();
    const matchupPlan = createBattlePlan(matchup.fighters, matchup.teams, matchup.startPositions, {
      seed: "moomo0p5-3x057j",
    });

    expect(getMaxCombatGapAfterOpening(matchupPlan)).toBeLessThanOrEqual(5_200);
  });

  it("does not let close attacks land through another living footprint", () => {
    const { fighters, teams, startPositions } = createCrowdedBattleSetup();
    const plan = createBattlePlan(fighters, teams, startPositions, {
      seed: "crowded-10v10",
    });
    const deathTimes = getDeathTimes(plan);
    const blockedCloseImpacts = plan.events
      .filter((event) => event.actionType === "strike" && event.outcome !== "miss")
      .flatMap((event) =>
        getLivingAttackLaneBlockers(plan, event, deathTimes).map((blockerId) => ({
          eventIndex: event.index,
          attack: event.attackCssClass,
          attackerId: event.attackerId,
          defenderId: event.defenderId,
          blockerId,
        })),
      );

    expect(blockedCloseImpacts).toEqual([]);
  });

  it("keeps active fighters from walking through fallen bodies in 10v10", () => {
    const { fighters, teams, startPositions } = createManualGridMurmilloSetup();
    const plan = createBattlePlan(fighters, teams, startPositions, {
      seed: "ui-all-murmillo",
    });
    const deathTimes = getDeathTimes(plan);

    for (let timeMs = 0; timeMs <= plan.durationMs; timeMs += 320) {
      const aliveIds = Object.keys(plan.fighters).filter(
        (fighterId) => (deathTimes.get(fighterId) ?? Number.POSITIVE_INFINITY) > timeMs,
      );
      const fallenIds = Object.keys(plan.fighters).filter(
        (fighterId) => (deathTimes.get(fighterId) ?? Number.POSITIVE_INFINITY) <= timeMs,
      );

      for (const aliveId of aliveIds) {
        for (const fallenId of fallenIds) {
          const alive = samplePlanPosition(plan, aliveId, timeMs);
          const fallen = samplePlanPosition(plan, fallenId, timeMs);
          const distance = getDistance(alive, fallen);
          const minDistance =
            (plan.fighters[aliveId]?.bodyRadius ?? 0) +
            (plan.fighters[fallenId]?.bodyRadius ?? 0) * 0.52 -
            metersToArenaDistance(0.08);

          expect(distance).toBeGreaterThanOrEqual(minDistance);
        }
      }
    }
  });
});

function createCrowdedBattleSetup(): {
  fighters: GladiatorClass[];
  teams: Record<string, "left" | "right">;
  startPositions: Record<string, BattlePoint>;
} {
  const bases = [murmillo, retiarius, veles];
  const fighters: GladiatorClass[] = [];
  const teams: Record<string, "left" | "right"> = {};
  const startPositions: Record<string, BattlePoint> = {};

  for (const teamId of ["left", "right"] as const) {
    for (let index = 0; index < 10; index += 1) {
      const base = bases[index % bases.length]!;
      const id = `${teamId}-${index}-${base.id}`;
      fighters.push(withGladiatorId(base, id));
      teams[id] = teamId;
      startPositions[id] = {
        x: teamId === "left" ? 0.2 + (index % 2) * 0.045 : 0.8 - (index % 2) * 0.045,
        y: 0.18 + index * 0.075,
      };
    }
  }

  return { fighters, teams, startPositions };
}

function withGladiatorId(gladiator: GladiatorClass, id: string): GladiatorClass {
  return {
    ...gladiator,
    id,
    name: `${gladiator.name} ${id}`,
    attacks: gladiator.attacks.map((attack) => ({ ...attack, reach: { ...attack.reach } })),
  };
}

function createManualGridMurmilloSetup(): {
  fighters: GladiatorClass[];
  teams: Record<string, "left" | "right">;
  startPositions: Record<string, BattlePoint>;
} {
  const spawnX = {
    left: [0.1, 0.24, 0.38],
    right: [0.9, 0.76, 0.62],
  } as const;
  const spawnY = [0.9, 0.74, 0.58, 0.42, 0.26] as const;
  const cells = [
    [1, 2],
    [1, 1],
    [1, 3],
    [0, 2],
    [2, 2],
    [0, 1],
    [2, 3],
    [0, 3],
    [2, 1],
    [1, 0],
  ] as const;
  const fighters: GladiatorClass[] = [];
  const teams: Record<string, "left" | "right"> = {};
  const startPositions: Record<string, BattlePoint> = {};

  for (const teamId of ["left", "right"] as const) {
    for (let index = 0; index < 10; index += 1) {
      const id = `${teamId}-${index}-murmillo`;
      const cell = cells[index] ?? [1, 2];

      fighters.push(withGladiatorId(murmillo, id));
      teams[id] = teamId;
      startPositions[id] = {
        x: spawnX[teamId][cell[0]] ?? spawnX[teamId][1],
        y: spawnY[cell[1]] ?? spawnY[2],
      };
    }
  }

  return { fighters, teams, startPositions };
}

function createManualGridMurmilloVsRetiariusSetup(): {
  fighters: GladiatorClass[];
  teams: Record<string, "left" | "right">;
  startPositions: Record<string, BattlePoint>;
} {
  const spawnX = {
    left: [0.1, 0.24, 0.38],
    right: [0.9, 0.76, 0.62],
  } as const;
  const spawnY = [0.9, 0.74, 0.58, 0.42, 0.26] as const;
  const cells = [
    [1, 2],
    [1, 1],
    [1, 3],
    [0, 2],
    [2, 2],
    [0, 1],
    [2, 3],
    [0, 3],
    [2, 1],
    [1, 0],
  ] as const;
  const fighters: GladiatorClass[] = [];
  const teams: Record<string, "left" | "right"> = {};
  const startPositions: Record<string, BattlePoint> = {};

  for (const teamId of ["left", "right"] as const) {
    for (let index = 0; index < 10; index += 1) {
      const base = teamId === "left" ? murmillo : retiarius;
      const id = `${teamId}-${index}-${base.id}`;
      const cell = cells[index] ?? [1, 2];

      fighters.push(withGladiatorId(base, id));
      teams[id] = teamId;
      startPositions[id] = {
        x: spawnX[teamId][cell[0]] ?? spawnX[teamId][1],
        y: spawnY[cell[1]] ?? spawnY[2],
      };
    }
  }

  return { fighters, teams, startPositions };
}

function getDeathTimes(plan: BattlePlan): Map<string, number> {
  const deathTimes = new Map<string, number>();

  for (const event of plan.events) {
    if (event.defenderHp > 0 || deathTimes.has(event.defenderId)) {
      continue;
    }

    deathTimes.set(event.defenderId, event.timeMs + event.movement.durationMs + event.impactDelayMs);
  }

  return deathTimes;
}

function getMaxCombatGapAfterOpening(plan: BattlePlan): number {
  let previousTimeMs: number | null = null;
  let maxGap = 0;

  for (const event of [...plan.events].sort((left, right) => left.timeMs - right.timeMs)) {
    if (previousTimeMs !== null) {
      maxGap = Math.max(maxGap, event.timeMs - previousTimeMs);
    }

    previousTimeMs = event.timeMs;
  }

  return maxGap;
}

function samplePlanPosition(plan: BattlePlan, fighterId: string, timeMs: number): BattlePoint {
  const track = plan.motionTracks[fighterId] ?? [];
  let current = plan.startPositions[fighterId] ?? { x: 0.5, y: 0.58 };

  for (const segment of track) {
    if (timeMs < segment.startMs) {
      return current;
    }

    if (timeMs <= segment.endMs) {
      const progress =
        segment.endMs <= segment.startMs
          ? 1
          : Math.min(Math.max((timeMs - segment.startMs) / (segment.endMs - segment.startMs), 0), 1);

      return {
        x: segment.from.x + (segment.to.x - segment.from.x) * progress,
        y: segment.from.y + (segment.to.y - segment.from.y) * progress,
      };
    }

    current = segment.to;
  }

  return current;
}

function getDistance(left: BattlePoint, right: BattlePoint): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function getLivingAttackLaneBlockers(
  plan: BattlePlan,
  event: BattleEvent,
  deathTimes: ReadonlyMap<string, number>,
): string[] {
  const impactMs = event.timeMs + event.movement.durationMs + event.impactDelayMs;
  const attacker = samplePlanPosition(plan, event.attackerId, impactMs);
  const defender = samplePlanPosition(plan, event.defenderId, impactMs);
  const attackerRuntime = plan.fighters[event.attackerId];
  const defenderRuntime = plan.fighters[event.defenderId];
  const laneLength = getDistance(attacker, defender);

  if (!attackerRuntime || !defenderRuntime || laneLength <= 0.001) {
    return [];
  }

  const minT = clamp(attackerRuntime.bodyRadius / laneLength, 0.08, 0.32);
  const maxT = clamp(1 - defenderRuntime.bodyRadius / laneLength, 0.68, 0.92);
  const blockers: string[] = [];

  for (const fighterId of Object.keys(plan.fighters)) {
    if (fighterId === event.attackerId || fighterId === event.defenderId) {
      continue;
    }

    if ((deathTimes.get(fighterId) ?? Number.POSITIVE_INFINITY) <= impactMs) {
      continue;
    }

    const blockerRuntime = plan.fighters[fighterId];
    if (!blockerRuntime) {
      continue;
    }

    const blocker = samplePlanPosition(plan, fighterId, impactMs);
    const projection = getPointToSegmentProjection(blocker, attacker, defender);
    const clearance = blockerRuntime.bodyRadius + metersToArenaDistance(0.08);

    if (projection.t > minT && projection.t < maxT && projection.distance < clearance) {
      blockers.push(fighterId);
    }
  }

  return blockers;
}

function getPointToSegmentProjection(
  point: BattlePoint,
  start: BattlePoint,
  end: BattlePoint,
): { distance: number; t: number } {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq <= 0.000001) {
    return { distance: getDistance(point, start), t: 0 };
  }

  const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq, 0, 1);
  const projected = {
    x: start.x + dx * t,
    y: start.y + dy * t,
  };

  return {
    distance: getDistance(point, projected),
    t,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
