import { describe, expect, it } from "vitest";
import {
  battleReplayRecordJsonSchema,
  CORE_SERVICE_NAME,
  CORE_VERSION,
  createHealthResponse,
  createVersionResponse,
  isBattleReplayRecord,
  parseBattleReplaySeedParams,
} from "./index.js";

describe("shared core responses", () => {
  it("creates a stable health response", () => {
    const response = createHealthResponse(new Date("2026-04-29T12:00:00.000Z"));

    expect(response).toEqual({
      status: "ok",
      service: CORE_SERVICE_NAME,
      timestamp: "2026-04-29T12:00:00.000Z",
    });
  });

  it("creates a version response", () => {
    expect(createVersionResponse()).toEqual({
      name: CORE_SERVICE_NAME,
      version: CORE_VERSION,
    });
  });

  it("validates battle replay records", () => {
    const record = {
      version: 1,
      battleId: "battle-1",
      seed: "seed-1",
      createdAt: "2026-04-29T12:00:00.000Z",
      winnerTeamId: "left",
      loserTeamId: "right",
      fighterIds: ["murmillo", "retiarius"],
      setup: { trainingMode: "balanced" },
      plan: { id: "battle-1" },
    };

    expect(isBattleReplayRecord(record)).toBe(true);
    expect(isBattleReplayRecord({ ...record, seed: "" })).toBe(false);
  });

  it("validates battle replay route params", () => {
    expect(parseBattleReplaySeedParams({ seed: "arena-42" })).toEqual({ seed: "arena-42" });
    expect(parseBattleReplaySeedParams({ seed: "" })).toBeNull();
  });

  it("exports a battle replay JSON schema for API validation", () => {
    expect(battleReplayRecordJsonSchema.required).toContain("seed");
    expect(battleReplayRecordJsonSchema.required).toContain("plan");
  });
});
