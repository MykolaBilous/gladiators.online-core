CREATE TABLE "BattleReplay" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "seed" TEXT NOT NULL,
    "battleId" TEXT NOT NULL,
    "winnerTeamId" TEXT NOT NULL,
    "loserTeamId" TEXT NOT NULL,
    "fighterIds" TEXT[] NOT NULL,
    "setup" JSONB NOT NULL,
    "plan" JSONB NOT NULL,
    "replayCreatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BattleReplay_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BattleReplay_seed_key" ON "BattleReplay"("seed");
CREATE INDEX "BattleReplay_battleId_idx" ON "BattleReplay"("battleId");
