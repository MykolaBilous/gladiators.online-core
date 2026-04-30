# Gladiators Online Core

TypeScript backend/core workspace для `Gladiators Online`. Repo містить production-ready фундамент: Fastify API, shared contracts, перенесений `combat-sim` package, Docker Compose для локальних PostgreSQL/Redis і базові перевірки.

## Структура

```text
apps/
  api/              Fastify HTTP API, Prisma schema і migrations
packages/
  shared/           Shared DTO/types/helpers
  combat-sim/       Чиста бойова симуляція, типи, roster і progression API
```

## Команди

```bash
npm install
npm run prisma:generate
npm run typecheck
npm test
npm run build
```

Запуск API після build:

```bash
npm run start -w @gladiators/api
```

Dev-запуск API напряму з TypeScript:

```bash
npm run dev -w @gladiators/api
```

Локальні PostgreSQL і Redis:

```bash
docker compose up -d postgres redis
```

Prisma:

```bash
npm run prisma:generate
npm run prisma:migrate
```

## API

- `GET /health` повертає статус сервісу.
- `GET /version` повертає назву й версію core package.
- `POST /battle-replays` зберігає battle replay payload.
- `GET /battle-replays/:seed` повертає збережений replay за seed.

Конфігурація береться з env. Стартові значення описані в `.env.example`.

## Combat sim

`@gladiators/combat-sim` експортує `createBattlePlan`, battle/replay types, arena scale helpers, gladiator classes/types, roster helpers і progression API. Пакет не імпортує DOM, CSS, Vite, Babylon, Phaser або browser API.
