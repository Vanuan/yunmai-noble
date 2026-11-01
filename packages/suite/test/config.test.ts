import { test } from "bun:test";
import assert from "node:assert/strict";

import { driverNodeId, driverPort, loadSuiteConfig } from "../src/config";

test("defaults to the real BLE driver", () => {
  assert.deepEqual(loadSuiteConfig({}), {
    drivers: ["dbus"],
    portBase: 8080,
    nodeIdPrefix: "scale",
    restartMs: 2000,
    simulatorControlPort: 8180,
  });
});

test("parses and deduplicates multiple drivers", () => {
  const config = loadSuiteConfig({
    SUITE_SCALES: "simulator, dbus, simulator",
    SUITE_WS_PORT_BASE: "9000",
    SUITE_NODE_ID_PREFIX: "home",
    SUITE_DRIVER_RESTART_MS: "0",
    SUITE_SIMULATOR_CONTROL_PORT: "9500",
  });

  assert.deepEqual(config.drivers, ["simulator", "dbus"]);
  assert.equal(config.portBase, 9000);
  assert.equal(config.restartMs, 0);
  assert.equal(config.simulatorControlPort, 9500);
  assert.equal(driverNodeId(config, "dbus"), "home-dbus");
  assert.equal(driverPort(config, "dbus"), 9000);
  assert.equal(driverPort(config, "simulator"), 9001);
});

test("rejects unknown drivers and invalid numbers", () => {
  assert.throws(
    () => loadSuiteConfig({ SUITE_SCALES: "dbus,bluetooth" }),
    /unknown drivers: bluetooth/
  );
  assert.throws(
    () => loadSuiteConfig({ SUITE_WS_PORT_BASE: "70000" }),
    /SUITE_WS_PORT_BASE/
  );
  assert.throws(
    () => loadSuiteConfig({ SUITE_DRIVER_RESTART_MS: "-1" }),
    /SUITE_DRIVER_RESTART_MS/
  );
  assert.throws(
    () => loadSuiteConfig({ SUITE_WS_PORT_BASE: "65500" }),
    /simulator control port/
  );
});

test("assigns a stable port to each driver", () => {
  const config = loadSuiteConfig({ SUITE_WS_PORT_BASE: "8080" });

  assert.equal(driverPort(config, "dbus"), 8080);
  assert.equal(driverPort(config, "simulator"), 8081);
  assert.equal(driverPort(config, "noble"), 8082);
});
