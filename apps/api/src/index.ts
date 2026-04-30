import { buildApi } from "./app.js";
import { createPrismaBattleReplayRepository } from "./battleReplays/repository.js";
import { loadApiConfig } from "./config.js";
import { createPrismaClient } from "./prisma.js";

const config = loadApiConfig();
const prisma = createPrismaClient(config.databaseUrl);
const app = buildApi({
  battleReplayRepository: createPrismaBattleReplayRepository(prisma),
  corsOrigin: config.corsOrigin,
  logger: {
    level: config.logLevel,
  },
});

try {
  await app.listen({
    host: config.host,
    port: config.port,
  });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
