export const CORE_SERVICE_NAME = "gladiators-online-core" as const;
export const CORE_VERSION = "0.1.0" as const;

export interface HealthResponse {
  status: "ok";
  service: typeof CORE_SERVICE_NAME;
  timestamp: string;
}

export interface VersionResponse {
  name: typeof CORE_SERVICE_NAME;
  version: typeof CORE_VERSION;
}

export interface BattleReplayRecord {
  version: 1;
  battleId: string;
  seed: string;
  createdAt: string;
  winnerTeamId: string;
  loserTeamId: string;
  fighterIds: string[];
  setup: unknown;
  plan: unknown;
}

export interface BattleReplayResponse {
  record: BattleReplayRecord;
}

export interface BattleReplayErrorResponse {
  error: string;
}

export interface BattleReplaySeedParams {
  seed: string;
}

export const battleReplayRecordJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "version",
    "battleId",
    "seed",
    "createdAt",
    "winnerTeamId",
    "loserTeamId",
    "fighterIds",
    "setup",
    "plan",
  ],
  properties: {
    version: { const: 1 },
    battleId: { type: "string", minLength: 1 },
    seed: { type: "string", minLength: 1 },
    createdAt: { type: "string", minLength: 1 },
    winnerTeamId: { type: "string", minLength: 1 },
    loserTeamId: { type: "string", minLength: 1 },
    fighterIds: {
      type: "array",
      minItems: 1,
      items: { type: "string", minLength: 1 },
    },
    setup: { type: "object" },
    plan: { type: "object" },
  },
} as const;

export const battleReplayResponseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["record"],
  properties: {
    record: battleReplayRecordJsonSchema,
  },
} as const;

export const battleReplayErrorResponseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["error"],
  properties: {
    error: { type: "string" },
  },
} as const;

export const battleReplaySeedParamsJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["seed"],
  properties: {
    seed: { type: "string", minLength: 1 },
  },
} as const;

export function createHealthResponse(now = new Date()): HealthResponse {
  return {
    status: "ok",
    service: CORE_SERVICE_NAME,
    timestamp: now.toISOString(),
  };
}

export function createVersionResponse(): VersionResponse {
  return {
    name: CORE_SERVICE_NAME,
    version: CORE_VERSION,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);
}

export function isBattleReplayRecord(value: unknown): value is BattleReplayRecord {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value["version"] === 1 &&
    isNonEmptyString(value["battleId"]) &&
    isNonEmptyString(value["seed"]) &&
    isNonEmptyString(value["createdAt"]) &&
    isNonEmptyString(value["winnerTeamId"]) &&
    isNonEmptyString(value["loserTeamId"]) &&
    isNonEmptyStringArray(value["fighterIds"]) &&
    isRecord(value["setup"]) &&
    isRecord(value["plan"])
  );
}

export function parseBattleReplayRecord(value: unknown): BattleReplayRecord | null {
  return isBattleReplayRecord(value) ? value : null;
}

export function parseBattleReplaySeedParams(value: unknown): BattleReplaySeedParams | null {
  if (!isRecord(value) || !isNonEmptyString(value["seed"])) {
    return null;
  }

  return {
    seed: value["seed"],
  };
}
