export interface ApiConfig {
  host: string;
  port: number;
  logLevel: string;
  nodeEnv: string;
  corsOrigin: string | false;
  databaseUrl: string;
}

const DEFAULT_DATABASE_URL =
  "postgresql://gladiators:gladiators@localhost:5432/gladiators_online";

export function parsePort(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const port = Number.parseInt(value, 10);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid API_PORT value: ${value}`);
  }

  return port;
}

export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return {
    host: env["API_HOST"] ?? "0.0.0.0",
    port: parsePort(env["API_PORT"], 3000),
    logLevel: env["LOG_LEVEL"] ?? "info",
    nodeEnv: env["NODE_ENV"] ?? "development",
    corsOrigin:
      env["CORS_ORIGIN"] === "false" ? false : (env["CORS_ORIGIN"] ?? "http://localhost:5173"),
    databaseUrl: env["DATABASE_URL"] ?? DEFAULT_DATABASE_URL,
  };
}
