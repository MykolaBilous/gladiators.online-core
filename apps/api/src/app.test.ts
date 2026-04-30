import { describe, expect, it } from "vitest";
import { CORE_SERVICE_NAME, CORE_VERSION } from "@gladiators/shared";
import type { BattleReplayRecord } from "@gladiators/shared";
import { buildApi } from "./app.js";

function createTestBattleReplayRecord(): BattleReplayRecord {
  return {
    version: 1,
    battleId: "battle-test-1",
    seed: "seed-test-1",
    createdAt: "2026-04-29T12:00:00.000Z",
    winnerTeamId: "left",
    loserTeamId: "right",
    fighterIds: ["murmillo", "retiarius"],
    setup: {
      trainingMode: "balanced",
    },
    plan: {
      id: "battle-test-1",
      seed: "seed-test-1",
    },
  };
}

describe("core API", () => {
  it("responds to GET /health", async () => {
    const app = buildApi({ logger: false });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/health",
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        status: "ok",
        service: CORE_SERVICE_NAME,
      });
      expect(typeof response.json()["timestamp"]).toBe("string");
    } finally {
      await app.close();
    }
  });

  it("responds to GET /version", async () => {
    const app = buildApi({ logger: false });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/version",
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        name: CORE_SERVICE_NAME,
        version: CORE_VERSION,
      });
    } finally {
      await app.close();
    }
  });

  it("records and loads battle replays by seed", async () => {
    const app = buildApi({ logger: false });
    const record = createTestBattleReplayRecord();

    try {
      const createResponse = await app.inject({
        method: "POST",
        url: "/battle-replays",
        payload: record,
      });

      expect(createResponse.statusCode).toBe(201);
      expect(createResponse.json()).toEqual({ record });

      const getResponse = await app.inject({
        method: "GET",
        url: `/battle-replays/${encodeURIComponent(record.seed)}`,
      });

      expect(getResponse.statusCode).toBe(200);
      expect(getResponse.json()).toEqual({ record });
    } finally {
      await app.close();
    }
  });

  it("rejects invalid battle replay payloads", async () => {
    const app = buildApi({ logger: false });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/battle-replays",
        payload: {
          seed: "missing-plan",
        },
      });

      expect(response.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it("returns 404 for unknown battle replay seeds", async () => {
    const app = buildApi({ logger: false });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/battle-replays/unknown-seed",
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: "Battle replay was not found." });
    } finally {
      await app.close();
    }
  });
});
