import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

type Kind = "string" | "integer" | "number" | "boolean" | "string[]";

interface KeySpec {
  env: string;
  kind: Kind;
}

const TABLES: Record<string, Record<string, KeySpec>> = {
  historian: {
    host: { env: "HISTORIAN_HOST", kind: "string" },
    port: { env: "HISTORIAN_PORT", kind: "integer" },
    database_path: { env: "DATABASE_PATH", kind: "string" },
    cors_origin: { env: "CORS_ORIGIN", kind: "string" },
    sse_heartbeat_ms: { env: "SSE_HEARTBEAT_MS", kind: "integer" },
    reconnect_min_ms: { env: "RECONNECT_MIN_MS", kind: "integer" },
    reconnect_max_ms: { env: "RECONNECT_MAX_MS", kind: "integer" },
    upstream_urls: { env: "YUNMAI_WS_URLS", kind: "string[]" },
    device_id: { env: "YUNMAI_DEVICE_ID", kind: "string" },
  },
  drivers: {
    initial: { env: "SUITE_SCALES", kind: "string[]" },
    port_base: { env: "SUITE_WS_PORT_BASE", kind: "integer" },
    node_id_prefix: { env: "SUITE_NODE_ID_PREFIX", kind: "string" },
    restart_ms: { env: "SUITE_DRIVER_RESTART_MS", kind: "integer" },
    simulator_control_port: {
      env: "SUITE_SIMULATOR_CONTROL_PORT",
      kind: "integer",
    },
  },
  simulator: {
    name: { env: "SIMULATOR_NAME", kind: "string" },
    weight_kg: { env: "SIMULATOR_WEIGHT_KG", kind: "number" },
    steps: { env: "SIMULATOR_STEPS", kind: "integer" },
    interval_ms: { env: "SIMULATOR_INTERVAL_MS", kind: "integer" },
    cycle_delay_ms: { env: "SIMULATOR_CYCLE_DELAY_MS", kind: "integer" },
    scan_delay_ms: { env: "SIMULATOR_SCAN_DELAY_MS", kind: "integer" },
    auto_start: { env: "SIMULATOR_AUTO_START", kind: "boolean" },
    repeat: { env: "SIMULATOR_REPEAT", kind: "boolean" },
  },
};

export interface ConfigFileResult {
  path: string | null;
  env: Record<string, string | undefined>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function envValue(
  path: string,
  key: string,
  value: unknown,
  kind: Kind
): string {
  const label = `${path}: ${key}`;

  if (kind === "string") {
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`${label} must be a non-empty string`);
    }
    return value;
  }

  if (kind === "string[]") {
    if (
      !Array.isArray(value) ||
      value.some((item) => typeof item !== "string" || item.trim() === "")
    ) {
      throw new Error(`${label} must be an array of non-empty strings`);
    }
    return value.join(",");
  }

  if (kind === "boolean") {
    if (typeof value !== "boolean") {
      throw new Error(`${label} must be true or false`);
    }
    return value ? "true" : "false";
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a number`);
  }
  if (kind === "integer" && !Number.isInteger(value)) {
    throw new Error(`${label} must be an integer`);
  }
  return String(value);
}

function toEnv(path: string, document: unknown): Record<string, string> {
  if (!isRecord(document)) {
    throw new Error(`${path}: expected a table at the top level`);
  }

  const overrides: Record<string, string> = {};

  for (const [table, value] of Object.entries(document)) {
    const keys = TABLES[table];
    if (!keys) {
      throw new Error(
        `${path}: unknown table [${table}] ` +
          `(expected ${Object.keys(TABLES).join(", ")})`
      );
    }
    if (!isRecord(value)) {
      throw new Error(`${path}: [${table}] must be a table`);
    }

    for (const [key, raw] of Object.entries(value)) {
      const spec = keys[key];
      if (!spec) {
        throw new Error(
          `${path}: unknown key ${table}.${key} ` +
            `(expected ${Object.keys(keys).join(", ")})`
        );
      }
      overrides[spec.env] = envValue(path, `${table}.${key}`, raw, spec.kind);
    }
  }

  return overrides;
}

export function findConfigFile(
  env: Record<string, string | undefined>,
  cwd: string = process.cwd()
): string | null {
  const explicit = env.YUNMAI_CONFIG?.trim();
  if (explicit) {
    const path = resolve(cwd, explicit);
    if (!existsSync(path)) {
      throw new Error(`YUNMAI_CONFIG does not exist: ${path}`);
    }
    return path;
  }

  const local = resolve(cwd, "yunmai-noble.toml");
  if (existsSync(local)) return local;

  const configHome = env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config");
  const user = join(configHome, "yunmai-noble", "config.toml");
  return existsSync(user) ? user : null;
}

export function loadConfigFile(
  env: Record<string, string | undefined> = process.env,
  cwd: string = process.cwd()
): ConfigFileResult {
  const path = findConfigFile(env, cwd);
  if (!path) return { path: null, env };

  let document: unknown;
  try {
    document = Bun.TOML.parse(readFileSync(path, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid config file ${path}: ${message}`);
  }

  const overrides = toEnv(path, document);
  const defined = Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== undefined)
  ) as Record<string, string>;

  // Environment variables win over the file so containers can override a
  // mounted configuration without editing it.
  return { path, env: { ...overrides, ...defined } };
}

export function parseConfigArg(argv: string[]): string | null {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--config") {
      const value = argv[index + 1];
      if (!value) throw new Error("--config requires a file path");
      return value;
    }
    if (arg.startsWith("--config=")) {
      const value = arg.slice("--config=".length);
      if (!value) throw new Error("--config requires a file path");
      return value;
    }
  }
  return null;
}
