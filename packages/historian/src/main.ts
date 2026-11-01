import { startHistorian, type HistorianApp } from "./app";
import { loadConfig, type HistorianConfig } from "./config";
import { consoleLogger } from "./logger";

let shuttingDown = false;

async function main(): Promise<void> {
  let config: HistorianConfig;
  try {
    config = loadConfig();
  } catch (error) {
    consoleLogger.error(
      "historian: invalid configuration: " +
        (error instanceof Error ? error.message : String(error))
    );
    process.exit(1);
  }

  let app: HistorianApp;
  try {
    app = startHistorian({ config });
  } catch (error) {
    consoleLogger.error(
      "historian: failed to start: " +
        (error instanceof Error ? error.message : String(error))
    );
    process.exit(1);
  }

  consoleLogger.log(
    `historian: listening on http://${config.host}:${app.server.port}`
  );
  consoleLogger.log(
    config.upstreamUrl
      ? `historian: upstream ${config.upstreamUrl}`
      : "historian: upstream disabled (YUNMAI_WS_URL is unset)"
  );

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    consoleLogger.log(`historian: stopping (${signal})`);
    await app.close();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

void main();
