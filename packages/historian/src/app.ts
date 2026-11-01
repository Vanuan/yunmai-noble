import type { Server } from "bun";

import type { HistorianConfig } from "./config";
import { IngestClient } from "./ingest";
import { consoleLogger, type Logger } from "./logger";
import { createSseHub, type SseHub } from "./sse";
import { SqliteStore, type MeasurementStore } from "./store";
import { startHttpServer } from "./http";

export interface HistorianAppOptions {
  config: HistorianConfig;
  logger?: Logger;
  store?: MeasurementStore;
  sse?: SseHub;
  ingest?: IngestClient | null;
}

export interface HistorianApp {
  server: Server<undefined>;
  store: MeasurementStore;
  sse: SseHub;
  ingest: IngestClient | null;
  close(): Promise<void>;
}

export function startHistorian(options: HistorianAppOptions): HistorianApp {
  const { config } = options;
  const logger = options.logger ?? consoleLogger;
  const store = options.store ?? new SqliteStore(config.databasePath);
  const sse = options.sse ?? createSseHub(config.sseHeartbeatMs);

  const ingest =
    options.ingest !== undefined
      ? options.ingest
      : config.upstreamUrl
        ? new IngestClient({
            url: config.upstreamUrl,
            store,
            sse,
            deviceId: config.deviceId,
            reconnectMinMs: config.reconnectMinMs,
            reconnectMaxMs: config.reconnectMaxMs,
            logger,
          })
        : null;

  const server = startHttpServer({
    host: config.host,
    port: config.port,
    corsOrigin: config.corsOrigin,
    store,
    sse,
    ingest,
    logger,
  });

  return {
    server,
    store,
    sse,
    ingest,
    async close(): Promise<void> {
      await server.stop(true);
      ingest?.close();
      sse.close();
      store.close();
    },
  };
}
