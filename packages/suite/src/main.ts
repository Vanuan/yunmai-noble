#!/usr/bin/env bun
import { startHistorian, type HistorianApp } from "@yunmai-noble/historian";
import { loadConfig } from "@yunmai-noble/historian/config";
import { consoleLogger } from "@yunmai-noble/historian/logger";

import { loadSuiteConfig } from "./config";
import { handleSuiteRequest } from "./control";
import { DriverSupervisor } from "./supervisor";
import { ensureUiBuild } from "./ui";

let shuttingDown = false;

async function main(): Promise<void> {
  const suiteConfig = loadSuiteConfig();
  const historianConfig = loadConfig({
    ...process.env,
    DATABASE_PATH: process.env.DATABASE_PATH ?? "./data/historian.sqlite",
  });

  ensureUiBuild(Bun.which("bun") ?? process.execPath, consoleLogger);

  let app!: HistorianApp;
  let supervisor!: DriverSupervisor;

  app = startHistorian({
    config: historianConfig,
    control: (request, url) =>
      handleSuiteRequest(request, url, {
        supervisor,
        ingests: app.ingests,
      }),
  });

  supervisor = new DriverSupervisor({
    config: suiteConfig,
    logger: consoleLogger,
    onStart: (view) => {
      app.ingests.add({
        id: view.driver,
        url: view.url,
        deviceId: view.nodeId,
        reconnectMinMs: historianConfig.reconnectMinMs,
        reconnectMaxMs: historianConfig.reconnectMaxMs,
      });
      consoleLogger.log(
        `suite: ${view.driver} on ${view.url} as ${view.nodeId}`
      );
    },
    onStop: (view) => {
      app.ingests.remove(view.driver);
      consoleLogger.log(`suite: ${view.driver} stopped`);
    },
  });

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    consoleLogger.log(`suite: stopping (${signal})`);
    await supervisor.stopAll();
    await app.close();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  consoleLogger.log(
    `suite: listening on http://${historianConfig.host}:${app.server.port}`
  );
  consoleLogger.log(
    `suite: drivers ${suiteConfig.drivers.join(", ") || "none"}; ` +
      `control at /api/suite`
  );
}

void main().catch((error: unknown) => {
  consoleLogger.error(
    `suite: failed to start: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exit(1);
});
