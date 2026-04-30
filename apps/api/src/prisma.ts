import { createRequire } from "node:module";
import type { PrismaBattleReplayClient } from "./battleReplays/repository.js";

type PrismaClientConstructor = new (options: { adapter: unknown }) => PrismaBattleReplayClient;
type PrismaPgConstructor = new (options: { connectionString: string }) => unknown;

const require = createRequire(import.meta.url);

export function createPrismaClient(connectionString: string): PrismaBattleReplayClient {
  const prismaModule = require("@prisma/client") as {
    PrismaClient: PrismaClientConstructor;
  };
  const adapterModule = require("@prisma/adapter-pg") as {
    PrismaPg: PrismaPgConstructor;
  };

  return new prismaModule.PrismaClient({
    adapter: new adapterModule.PrismaPg({ connectionString }),
  });
}
