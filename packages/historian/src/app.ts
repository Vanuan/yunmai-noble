import type { Server } from "bun";

import type { HistorianConfig } from "./config";
import { createIngestGroup, IngestClient, type IngestGroup } from "./ingest";
import { consoleLogger, type Logger } from "./logger";
import { createSseHub, type SseHub } from "./sse";
import { SqliteStore, type MeasurementStore } from "./store";
import { startHttpServer, type ControlHandler } from "./http";

export interface HistorianAppOptions {
  config: HistorianConfig;
  logger?: Logger;
  store?: MeasurementStore;
  sse?: SseHub;
  ingest?: IngestClient | null;
  control?: ControlHandler;
}

export interface HistorianApp {
  server: Server<undefined>;
  store: MeasurementStore;
  sse: SseHub;
  ingests: IngestGroup;
  close(): Promise<void>;
}

export type { IngestGroup, IngestSourceStatus } from "./ingest";
export type { ControlHandler } from "./http";

export function startHistorian(options: HistorianAppOptions): HistorianApp {
  const { config } = options;
  const logger = options.logger ?? consoleLogger;
  const store = options.store ?? new SqliteStore(config.databasePath);
  const sse = options.sse ?? createSseHub(config.sseHeartbeatMs);
  const ingests = createIngestGroup({ store, sse, logger });

  if (options.ingest) {
    ingests.addClient("injected", "", options.ingest);
  } else if (options.ingest === undefined) {
    for (const url of config.upstreamUrls) {
      ingests.add({
        id: url,
        url,
        deviceId: config.deviceId,
        reconnectMinMs: config.reconnectMinMs,
        reconnectMaxMs: config.reconnectMaxMs,
      });
    }
  }

  const server = startHttpServer({
    host: config.host,
    port: config.port,
    corsOrigin: config.corsOrigin,
    store,
    sse,
    ingests,
    logger,
    control: options.control,
  });

  return {
    server,
    store,
    sse,
    ingests,
    async close(): Promise<void> {
      await server.stop(true);
      ingests.close();
      sse.close();
      store.close();
    },
  };
}
