import { z } from "zod";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import yaml from "js-yaml";

const ConfigSchema = z.object({
  /** Public URL of the API server (used for webhook + OAuth callbacks) */
  baseUrl: z.string().url(),

  /** PostgreSQL connection string */
  databaseUrl: z.string().min(1),

  /** Redis connection string */
  redisUrl: z.string().min(1),

  /** 32-byte hex string for AES-256-GCM encryption */
  encryptionKey: z.string().length(64),

  /** Port for the API server (default: 3000) */
  port: z.number().int().positive().default(3000),

  /** Log level */
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Config = z.infer<typeof ConfigSchema>;

function loadFile(dir: string): Record<string, unknown> {
  const candidates = [
    resolve(dir, ".openbunny.json"),
    resolve(dir, ".openbunny.yaml"),
    resolve(dir, ".openbunny.yml"),
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      const raw = readFileSync(path, "utf8");
      return (path.endsWith(".json") ? JSON.parse(raw) : yaml.load(raw)) as Record<string, unknown>;
    }
  }
  return {};
}

/**
 * Parse and validate configuration from environment variables,
 * optionally merged with a .openbunny.json / .openbunny.yaml file.
 *
 * Env vars take precedence over file values.
 */
export function parseConfig(cwd = process.cwd()): Config {
  const fileValues = loadFile(cwd);

  const raw = {
    baseUrl: process.env["BASE_URL"] ?? fileValues["baseUrl"],
    databaseUrl: process.env["DATABASE_URL"] ?? fileValues["databaseUrl"],
    redisUrl: process.env["REDIS_URL"] ?? fileValues["redisUrl"],
    encryptionKey: process.env["ENCRYPTION_KEY"] ?? fileValues["encryptionKey"],
    port: process.env["PORT"] ? Number(process.env["PORT"]) : (fileValues["port"] ?? 3000),
    logLevel: process.env["LOG_LEVEL"] ?? fileValues["logLevel"] ?? "info",
  };

  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  return result.data;
}
