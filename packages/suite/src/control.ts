import type { IngestGroup, IngestSourceStatus } from "@yunmai-noble/historian";
import type { HistorianConfig } from "@yunmai-noble/historian/config";

import { DRIVERS, isDriverName, type SuiteConfig } from "./config";
import type { DriverSupervisor, DriverView } from "./supervisor";

export interface SuiteControlOptions {
  supervisor: DriverSupervisor;
  ingests: IngestGroup;
  configPath: string | null;
  suite: SuiteConfig;
  historian: HistorianConfig;
}

interface DriverResponse extends DriverView {
  upstream: IngestSourceStatus["status"] | null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function error(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, status);
}

function describe(options: SuiteControlOptions): {
  available: readonly string[];
  drivers: DriverResponse[];
} {
  return {
    available: options.supervisor.availableDrivers(),
    drivers: options.supervisor.list().map((view) => ({
      ...view,
      upstream: options.ingests.get(view.driver)?.status() ?? null,
    })),
  };
}

/** Drop credentials from upstream URLs before they reach a UI. */
function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return raw;
  }
}

// Effective configuration: the values the running process resolved from the
// config file, the environment, and the built-in defaults. Passwords in upstream
// URLs are stripped because this is served to any API client.
function settings(options: SuiteControlOptions): unknown {
  const { historian, suite } = options;

  return {
    configPath: options.configPath,
    historian: {
      host: historian.host,
      port: historian.port,
      databasePath: historian.databasePath,
      corsOrigin: historian.corsOrigin,
      sseHeartbeatMs: historian.sseHeartbeatMs,
      reconnectMinMs: historian.reconnectMinMs,
      reconnectMaxMs: historian.reconnectMaxMs,
      upstreamUrls: historian.upstreamUrls.map(redactUrl),
      deviceId: historian.deviceId,
    },
    drivers: {
      initial: suite.drivers,
      nodeIdPrefix: suite.nodeIdPrefix,
      restartMs: suite.restartMs,
    },
    simulator: { ...suite.simulator },
  };
}

async function proxySimulator(
  request: Request,
  url: URL,
  options: SuiteControlOptions
): Promise<Response> {
  const driver = options.supervisor
    .list()
    .find((entry) => entry.driver === "simulator");

  if (
    !driver ||
    !driver.controlUrl ||
    (driver.state !== "running" && driver.state !== "starting")
  ) {
    return error(
      409,
      "simulator_not_running",
      "The simulator driver is not running"
    );
  }

  const path =
    url.pathname.replace("/api/suite/simulator", "/api/simulator") +
    url.search;
  const init: RequestInit = { method: request.method };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.headers = { "Content-Type": "application/json" };
    init.body = (await request.text()) || "{}";
  }

  try {
    const response = await fetch(`${driver.controlUrl}${path}`, init);
    return new Response(await response.text(), {
      status: response.status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch {
    return error(
      503,
      "simulator_unavailable",
      "Simulator control is not reachable"
    );
  }
}

// Control surface for the single executable. Drivers can be started or stopped
// while it runs, so the simulator and real BLE can feed the historian at the
// same time. Simulator-specific routes are proxied to the simulator node.
export async function handleSuiteRequest(
  request: Request,
  url: URL,
  options: SuiteControlOptions
): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/suite")) return null;

  if (url.pathname === "/api/suite") {
    if (request.method !== "GET") {
      return error(405, "method_not_allowed", "Use GET");
    }
    return json(describe(options));
  }

  if (url.pathname === "/api/suite/settings") {
    if (request.method !== "GET") {
      return error(405, "method_not_allowed", "Use GET");
    }
    return json(settings(options));
  }

  if (
    url.pathname === "/api/suite/simulator" ||
    url.pathname.startsWith("/api/suite/simulator/")
  ) {
    return proxySimulator(request, url, options);
  }

  const match = url.pathname.match(
    /^\/api\/suite\/drivers\/([a-z]+)\/(start|stop)$/
  );
  if (!match) {
    return error(404, "not_found", "Not found");
  }

  if (request.method !== "POST") {
    return error(405, "method_not_allowed", "Use POST");
  }

  const driver = match[1];
  if (!isDriverName(driver)) {
    return error(
      404,
      "unknown_driver",
      `Unknown driver "${driver}" (expected ${DRIVERS.join(", ")})`
    );
  }

  if (match[2] === "start") {
    options.supervisor.start(driver);
  } else {
    options.supervisor.stop(driver);
  }

  return json(describe(options));
}
