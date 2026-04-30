import { describe, expect, it } from "vitest";
import { createBattlePlan, murmillo, retiarius, veles } from "./index.js";

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
});
