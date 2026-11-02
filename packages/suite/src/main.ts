#!/usr/bin/env bun
import { startHistorian, type HistorianApp } from "@yunmai-noble/historian";
import { loadConfig } from "@yunmai-noble/historian/config";
import { consoleLogger } from "@yunmai-noble/historian/logger";

import { loadSuiteConfig } from "./config";
import { loadConfigFile, parseConfigArg } from "./config-file";
import { handleSuiteRequest } from "./control";
import { DriverSupervisor } from "./supervisor";
import { ensureUiBuild } from "./ui";

let shuttingDown = false;

async function main(): Promise<void> {
  const cliConfig = parseConfigArg(process.argv.slice(2));
  const configFile = loadConfigFile(
    cliConfig ? { ...process.env, YUNMAI_CONFIG: cliConfig } : process.env
  );
  const suiteConfig = loadSuiteConfig(configFile.env);
  const historianConfig = loadConfig({
    ...configFile.env,
    DATABASE_PATH: configFile.env.DATABASE_PATH ?? "./data/historian.sqlite",
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
        configPath: configFile.path,
        suite: suiteConfig,
        historian: historianConfig,
      }),
  });

  supervisor = new DriverSupervisor({
    config: suiteConfig,
    env: configFile.env,
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
    onStop: (view, reason) => {
      app.ingests.remove(view.driver);
      consoleLogger.log(
        reason === "exited"
          ? `suite: ${view.driver} upstream detached`
          : `suite: ${view.driver} stopped`
      );
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
  process.on("SIGHUP", () => {
    void shutdown("SIGHUP");
  });

  const displayHost =
    historianConfig.host === "0.0.0.0" || historianConfig.host === "::"
      ? "127.0.0.1"
      : historianConfig.host;

  consoleLogger.log(
    `suite: dashboard http://${displayHost}:${app.server.port}/`
  );
  consoleLogger.log(
    `suite: simulator http://${displayHost}:${app.server.port}/simulator/`
  );
  consoleLogger.log(
    `suite: drivers ${suiteConfig.drivers.join(", ") || "none"}; ` +
      `control at /api/suite`
  );
  if (configFile.path) {
    consoleLogger.log(`suite: config ${configFile.path}`);
  }
}

void main().catch((error: unknown) => {
  consoleLogger.error(
    `suite: failed to start: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exit(1);
});
