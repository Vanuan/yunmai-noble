import type { IngestGroup, IngestSourceStatus } from "@yunmai-noble/historian";

import { DRIVERS, isDriverName } from "./config";
import type { DriverSupervisor, DriverView } from "./supervisor";

export interface SuiteControlOptions {
  supervisor: DriverSupervisor;
  ingests: IngestGroup;
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
    available: DRIVERS,
    drivers: options.supervisor.list().map((view) => ({
      ...view,
      upstream: options.ingests.get(view.driver)?.status() ?? null,
    })),
  };
}

// Control surface for the single executable. Drivers can be started or stopped
// while it runs, so the simulator and real BLE can feed the historian at the
// same time.
export function handleSuiteRequest(
  request: Request,
  url: URL,
  options: SuiteControlOptions
): Response | null {
  if (!url.pathname.startsWith("/api/suite")) return null;

  if (url.pathname === "/api/suite") {
    if (request.method !== "GET") {
      return error(405, "method_not_allowed", "Use GET");
    }
    return json(describe(options));
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
