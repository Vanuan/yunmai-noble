import { test } from "bun:test";
import assert from "node:assert/strict";

import type { IngestGroup } from "@yunmai-noble/historian";
import { loadConfig } from "@yunmai-noble/historian/config";

import { loadSuiteConfig } from "../src/config";
import { handleSuiteRequest } from "../src/control";
import type { DriverSupervisor, DriverView } from "../src/supervisor";

const CALLS: string[] = [];

function view(overrides: Partial<DriverView> = {}): DriverView {
  return {
    driver: "simulator",
    nodeId: "scale-simulator",
    url: "ws://127.0.0.1:8081",
    controlUrl: null,
    desired: false,
    state: "stopped",
    pid: null,
    restarts: 0,
    startedAt: null,
    lastExit: null,
    error: null,
    ...overrides,
  };
}

function supervisor(
  overrides: Partial<DriverView> = {},
  available: DriverView["driver"][] = ["dbus", "simulator", "noble"]
): DriverSupervisor {
  return {
    availableDrivers: () => available,
    list: () => [
      view({
        desired: true,
        state: "running",
        pid: 42,
        startedAt: "2026-11-01T10:00:00.000Z",
        ...overrides,
      }),
      view({ driver: "dbus", nodeId: "scale-dbus", url: "ws://127.0.0.1:8080" }),
    ],
    start(driver: DriverView["driver"]) {
      CALLS.push(`start:${driver}`);
      return view({ driver, desired: true, state: "starting" });
    },
    stop(driver: DriverView["driver"]) {
      CALLS.push(`stop:${driver}`);
      return view({ driver, state: "stopped" });
    },
  } as unknown as DriverSupervisor;
}

function ingests(): IngestGroup {
  return {
    get: (id: string) =>
      id === "simulator"
        ? {
            status: () => ({
              configured: true,
              connected: true,
              lastMessageAt: "2026-11-01T10:00:01.000Z",
              lastError: null,
            }),
          }
        : undefined,
  } as unknown as IngestGroup;
}

function request(method: string, path: string, body?: unknown): Request {
  return new Request(`http://127.0.0.1:3000${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function options(
  driver: Partial<DriverView> = {},
  available?: DriverView["driver"][]
) {
  return {
    supervisor: supervisor(driver, available),
    ingests: ingests(),
    configPath: "/etc/yunmai-noble/config.toml",
    suite: loadSuiteConfig({
      SUITE_SCALES: "simulator",
      SIMULATOR_STEPS: "6",
    }),
    historian: loadConfig({
      HISTORIAN_PORT: "3000",
      DATABASE_PATH: "/var/lib/yunmai-noble/historian.sqlite",
      YUNMAI_WS_URLS: "ws://user:secret@example.test/ws",
    }),
  };
}

function url(path: string): URL {
  return new URL(`http://127.0.0.1:3000${path}`);
}

test("lists drivers with their upstream status", async () => {
  const response = await handleSuiteRequest(
    request("GET", "/api/suite"),
    url("/api/suite"),
    options()
  );

  assert.ok(response);
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    available: string[];
    drivers: Array<{ driver: string; upstream: unknown }>;
  };
  assert.deepEqual(body.available, ["dbus", "simulator", "noble"]);
  assert.equal(body.drivers.length, 2);
  assert.deepEqual(body.drivers[0].upstream, {
    configured: true,
    connected: true,
    lastMessageAt: "2026-11-01T10:00:01.000Z",
    lastError: null,
  });
});

test("reports the effective settings without upstream credentials", async () => {
  const response = await handleSuiteRequest(
    request("GET", "/api/suite/settings"),
    url("/api/suite/settings"),
    options()
  );

  assert.ok(response);
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    configPath: string | null;
    historian: { port: number; upstreamUrls: string[]; databasePath: string };
    drivers: { initial: string[] };
    simulator: { steps: number; repeat: boolean };
  };

  assert.equal(body.configPath, "/etc/yunmai-noble/config.toml");
  assert.equal(body.historian.port, 3000);
  assert.equal(body.historian.databasePath, "/var/lib/yunmai-noble/historian.sqlite");
  assert.deepEqual(body.historian.upstreamUrls, ["ws://example.test/ws"]);
  assert.deepEqual(body.drivers.initial, ["simulator"]);
  assert.equal(body.simulator.steps, 6);
  assert.equal(body.simulator.repeat, false);
});

test("omits drivers the service cannot run", async () => {
  const response = await handleSuiteRequest(
    request("GET", "/api/suite"),
    url("/api/suite"),
    options({}, ["dbus", "simulator"])
  );

  assert.ok(response);
  const body = (await response.json()) as { available: string[] };
  assert.deepEqual(body.available, ["dbus", "simulator"]);
});

test("starts and stops a driver", async () => {
  CALLS.length = 0;

  for (const [action, expected] of [
    ["start", "start:simulator"],
    ["stop", "stop:simulator"],
  ] as const) {
    const response = await handleSuiteRequest(
      request("POST", `/api/suite/drivers/simulator/${action}`),
      url(`/api/suite/drivers/simulator/${action}`),
      options()
    );

    assert.ok(response);
    assert.equal(response.status, 200);
    assert.deepEqual(CALLS, [expected]);
    CALLS.length = 0;
  }
});

test("rejects unknown drivers and wrong methods", async () => {
  CALLS.length = 0;

  const unknown = await handleSuiteRequest(
    request("POST", "/api/suite/drivers/usb/start"),
    url("/api/suite/drivers/usb/start"),
    options()
  );
  assert.equal(unknown?.status, 404);
  assert.deepEqual(CALLS, []);

  const wrongMethod = await handleSuiteRequest(
    request("GET", "/api/suite/drivers/dbus/start"),
    url("/api/suite/drivers/dbus/start"),
    options()
  );
  assert.equal(wrongMethod?.status, 405);
  assert.deepEqual(CALLS, []);
});

test("proxies simulator commands to the simulator node", async () => {
  const seen: Array<{ method: string; path: string; body: string }> = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const requestUrl = new URL(request.url);
      seen.push({
        method: request.method,
        path: requestUrl.pathname,
        body: request.method === "POST" ? await request.text() : "",
      });
      return Response.json({ powered: true, running: false });
    },
  });

  try {
    const controlUrl = `http://127.0.0.1:${server.port}`;

    const state = await handleSuiteRequest(
      request("GET", "/api/suite/simulator"),
      url("/api/suite/simulator"),
      options({ controlUrl })
    );
    assert.equal(state?.status, 200);
    assert.deepEqual(await state?.json(), { powered: true, running: false });

    const weighted = await handleSuiteRequest(
      request("POST", "/api/suite/simulator/weight", { kg: 80 }),
      url("/api/suite/simulator/weight"),
      options({ controlUrl })
    );
    assert.equal(weighted?.status, 200);

    assert.deepEqual(seen, [
      { method: "GET", path: "/api/simulator", body: "" },
      { method: "POST", path: "/api/simulator/weight", body: '{"kg":80}' },
    ]);
  } finally {
    server.stop(true);
  }
});

test("reports a stopped or unreachable simulator", async () => {
  const stopped = await handleSuiteRequest(
    request("GET", "/api/suite/simulator"),
    url("/api/suite/simulator"),
    options({ state: "stopped", controlUrl: "http://127.0.0.1:1" })
  );
  assert.equal(stopped?.status, 409);

  const unreachable = await handleSuiteRequest(
    request("GET", "/api/suite/simulator"),
    url("/api/suite/simulator"),
    options({ controlUrl: "http://127.0.0.1:1" })
  );
  assert.equal(unreachable?.status, 503);
});

test("leaves unrelated routes to the historian", async () => {
  const response = await handleSuiteRequest(
    request("GET", "/api/measurements"),
    url("/api/measurements"),
    options()
  );

  assert.equal(response, null);
});
