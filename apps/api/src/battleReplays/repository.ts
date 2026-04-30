import type { BattleReplayRecord } from "@gladiators/shared";

export interface BattleReplayRepository {
  create: (record: BattleReplayRecord) => Promise<BattleReplayRecord>;
  findBySeed: (seed: string) => Promise<BattleReplayRecord | null>;
  close?: () => Promise<void>;
}

export interface PrismaBattleReplayRow {
  version: number;
  battleId: string;
  seed: string;
  replayCreatedAt: Date;
  winnerTeamId: string;
  loserTeamId: string;
  fighterIds: string[];
  setup: unknown;
  plan: unknown;
}

export interface PrismaBattleReplayClient {
  battleReplay: {
    findUnique: (args: {
      where: { seed: string };
    }) => Promise<PrismaBattleReplayRow | null>;
    upsert: (args: {
      where: { seed: string };
      create: {
        version: number;
        battleId: string;
        seed: string;
        replayCreatedAt: Date;
        winnerTeamId: string;
        loserTeamId: string;
        fighterIds: string[];
        setup: unknown;
        plan: unknown;
      };
      update: {
        version: number;
        battleId: string;
        replayCreatedAt: Date;
        winnerTeamId: string;
        loserTeamId: string;
        fighterIds: string[];
        setup: unknown;
        plan: unknown;
      };
    }) => Promise<PrismaBattleReplayRow>;
  };
  $disconnect?: () => Promise<void>;
}

function toBattleReplayRecord(row: PrismaBattleReplayRow): BattleReplayRecord {
  return {
    version: 1,
    battleId: row.battleId,
    seed: row.seed,
    createdAt: row.replayCreatedAt.toISOString(),
    winnerTeamId: row.winnerTeamId,
    loserTeamId: row.loserTeamId,
    fighterIds: row.fighterIds,
    setup: row.setup,
    plan: row.plan,
  };
}

function toReplayDate(value: string): Date {
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? new Date() : date;
}

export function createMemoryBattleReplayRepository(
  initialRecords: readonly BattleReplayRecord[] = [],
): BattleReplayRepository {
  const recordsBySeed = new Map<string, BattleReplayRecord>(
    initialRecords.map((record) => [record.seed, record]),
  );

  return {
    async create(record) {
      recordsBySeed.set(record.seed, record);
      return record;
    },
    async findBySeed(seed) {
      return recordsBySeed.get(seed) ?? null;
    },
  };
}

export function createPrismaBattleReplayRepository(
  prisma: PrismaBattleReplayClient,
): BattleReplayRepository {
  return {
    async create(record) {
      const replayCreatedAt = toReplayDate(record.createdAt);

      const row = await prisma.battleReplay.upsert({
        where: { seed: record.seed },
        create: {
          version: record.version,
          battleId: record.battleId,
          seed: record.seed,
          replayCreatedAt,
          winnerTeamId: record.winnerTeamId,
          loserTeamId: record.loserTeamId,
          fighterIds: record.fighterIds,
          setup: record.setup,
          plan: record.plan,
        },
        update: {
          version: record.version,
          battleId: record.battleId,
          replayCreatedAt,
          winnerTeamId: record.winnerTeamId,
          loserTeamId: record.loserTeamId,
          fighterIds: record.fighterIds,
          setup: record.setup,
          plan: record.plan,
        },
      });

      return toBattleReplayRecord(row);
    },
    async findBySeed(seed) {
      const row = await prisma.battleReplay.findUnique({
        where: { seed },
      });

      return row ? toBattleReplayRecord(row) : null;
    },
    async close() {
      await prisma.$disconnect?.();
    },
  };
}
