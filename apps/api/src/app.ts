import cors from "@fastify/cors";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import {
  battleReplayRecordJsonSchema,
  battleReplaySeedParamsJsonSchema,
  createHealthResponse,
  createVersionResponse,
  parseBattleReplayRecord,
  parseBattleReplaySeedParams,
} from "@gladiators/shared";
import {
  createMemoryBattleReplayRepository,
  type BattleReplayRepository,
} from "./battleReplays/repository.js";

type CorsOrigin = boolean | string | RegExp | Array<string | RegExp>;

export interface BuildApiOptions extends FastifyServerOptions {
  battleReplayRepository?: BattleReplayRepository;
  corsOrigin?: CorsOrigin;
}

export function buildApi(options: BuildApiOptions = {}): FastifyInstance {
  const {
    battleReplayRepository = createMemoryBattleReplayRepository(),
    corsOrigin,
    ...fastifyOptions
  } = options;
  const app = Fastify(fastifyOptions);

  if (corsOrigin !== undefined && corsOrigin !== false) {
    void app.register(cors, {
      origin: corsOrigin,
    });
  }

  app.get("/health", async () => createHealthResponse());
  app.get("/version", async () => createVersionResponse());

  app.post(
    "/battle-replays",
    {
      schema: {
        body: battleReplayRecordJsonSchema,
      },
    },
    async (request, reply) => {
      const record = parseBattleReplayRecord(request.body);

      if (!record) {
        return reply.code(400).send({ error: "Invalid battle replay payload." });
      }

      const savedRecord = await battleReplayRepository.create(record);

      return reply.code(201).send({ record: savedRecord });
    },
  );

  app.get(
    "/battle-replays/:seed",
    {
      schema: {
        params: battleReplaySeedParamsJsonSchema,
      },
    },
    async (request, reply) => {
      const params = parseBattleReplaySeedParams(request.params);

      if (!params) {
        return reply.code(400).send({ error: "Battle replay seed is required." });
      }

      const record = await battleReplayRepository.findBySeed(params.seed);

      if (!record) {
        return reply.code(404).send({ error: "Battle replay was not found." });
      }

      return reply.send({ record });
    },
  );

  app.addHook("onClose", async () => {
    await battleReplayRepository.close?.();
  });

  return app;
}
