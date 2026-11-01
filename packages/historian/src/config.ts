import { z } from "zod";

const EnvSchema = z.object({
  HISTORIAN_HOST: z.string().default("0.0.0.0"),
  HISTORIAN_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_PATH: z.string().default("/data/historian.sqlite"),
  YUNMAI_WS_URL: z.string().optional(),
  YUNMAI_WS_URLS: z.string().optional(),
  YUNMAI_DEVICE_ID: z.string().default("yunmai-noble"),
  RECONNECT_MIN_MS: z.coerce.number().int().min(10).default(1000),
  RECONNECT_MAX_MS: z.coerce.number().int().min(100).default(30000),
  CORS_ORIGIN: z.string().default("*"),
  SSE_HEARTBEAT_MS: z.coerce.number().int().min(1000).default(15000),
});

export interface HistorianConfig {
  host: string;
  port: number;
  databasePath: string;
  upstreamUrls: string[];
  deviceId: string;
  reconnectMinMs: number;
  reconnectMaxMs: number;
  corsOrigin: string;
  sseHeartbeatMs: number;
}

function parseUpstreams(
  env: Record<string, string | undefined>
): string[] {
  const urls = [env.YUNMAI_WS_URL, env.YUNMAI_WS_URLS]
    .filter((value): value is string => typeof value === "string")
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  for (const url of urls) {
    if (!/^wss?:\/\//i.test(url)) {
      throw new Error("YUNMAI_WS_URL(S) must start with ws:// or wss://");
    }
  }

  return Array.from(new Set(urls));
}

export function loadConfig(
  env: Record<string, string | undefined> = process.env
): HistorianConfig {
  const parsed = EnvSchema.parse(env);

  if (parsed.RECONNECT_MAX_MS < parsed.RECONNECT_MIN_MS) {
    throw new Error("RECONNECT_MAX_MS must be greater than RECONNECT_MIN_MS");
  }

  return {
    host: parsed.HISTORIAN_HOST,
    port: parsed.HISTORIAN_PORT,
    databasePath: parsed.DATABASE_PATH,
    upstreamUrls: parseUpstreams(env),
    deviceId: parsed.YUNMAI_DEVICE_ID,
    reconnectMinMs: parsed.RECONNECT_MIN_MS,
    reconnectMaxMs: parsed.RECONNECT_MAX_MS,
    corsOrigin: parsed.CORS_ORIGIN,
    sseHeartbeatMs: parsed.SSE_HEARTBEAT_MS,
  };
}
