import { test } from "bun:test";
import assert from "node:assert/strict";

import type { IngestGroup } from "@yunmai-noble/historian";

import { handleSuiteRequest } from "../src/control";
import type { DriverSupervisor, DriverView } from "../src/supervisor";

const CALLS: string[] = [];

function view(overrides: Partial<DriverView> = {}): DriverView {
  return {
    driver: "simulator",
    nodeId: "scale-simulator",
    url: "ws://127.0.0.1:8081",
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

function supervisor(): DriverSupervisor {
  return {
    list: () => [
      view({
        desired: true,
        state: "running",
        pid: 42,
        startedAt: "2026-11-01T10:00:00.000Z",
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

function request(method: string, path: string): Request {
  return new Request(`http://127.0.0.1:3000${path}`, { method });
}

function options() {
  return { supervisor: supervisor(), ingests: ingests() };
}

test("lists drivers with their upstream status", async () => {
  const response = handleSuiteRequest(
    request("GET", "/api/suite"),
    new URL("http://127.0.0.1:3000/api/suite"),
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

test("starts and stops a driver", async () => {
  CALLS.length = 0;

  for (const [action, expected] of [
    ["start", "start:simulator"],
    ["stop", "stop:simulator"],
  ] as const) {
    const response = handleSuiteRequest(
      request("POST", `/api/suite/drivers/simulator/${action}`),
      new URL(`http://127.0.0.1:3000/api/suite/drivers/simulator/${action}`),
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

  const unknown = handleSuiteRequest(
    request("POST", "/api/suite/drivers/usb/start"),
    new URL("http://127.0.0.1:3000/api/suite/drivers/usb/start"),
    options()
  );
  assert.equal(unknown?.status, 404);
  assert.deepEqual(CALLS, []);

  const wrongMethod = handleSuiteRequest(
    request("GET", "/api/suite/drivers/dbus/start"),
    new URL("http://127.0.0.1:3000/api/suite/drivers/dbus/start"),
    options()
  );
  assert.equal(wrongMethod?.status, 405);
  assert.deepEqual(CALLS, []);
});

test("leaves unrelated routes to the historian", () => {
  const response = handleSuiteRequest(
    request("GET", "/api/measurements"),
    new URL("http://127.0.0.1:3000/api/measurements"),
    options()
  );

  assert.equal(response, null);
});
