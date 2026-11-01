import { test } from "bun:test";
import assert from "node:assert/strict";

import { driverNodeId, loadSuiteConfig } from "../src/config";

test("defaults to the real BLE driver", () => {
  assert.deepEqual(loadSuiteConfig({}), {
    drivers: ["dbus"],
    nodeIdPrefix: "scale",
    restartMs: 2000,
  });
});

test("parses and deduplicates multiple drivers", () => {
  const config = loadSuiteConfig({
    SUITE_SCALES: "simulator, dbus, simulator",
    SUITE_NODE_ID_PREFIX: "home",
    SUITE_DRIVER_RESTART_MS: "0",
  });

  assert.deepEqual(config.drivers, ["simulator", "dbus"]);
  assert.equal(config.restartMs, 0);
  assert.equal(driverNodeId(config, "dbus"), "home-dbus");
});

test("rejects unknown drivers and invalid numbers", () => {
  assert.throws(
    () => loadSuiteConfig({ SUITE_SCALES: "dbus,bluetooth" }),
    /unknown drivers: bluetooth/
  );
  assert.throws(
    () => loadSuiteConfig({ SUITE_DRIVER_RESTART_MS: "-1" }),
    /SUITE_DRIVER_RESTART_MS/
  );
  assert.throws(
    () => loadSuiteConfig({ SUITE_DRIVER_RESTART_MS: "many" }),
    /SUITE_DRIVER_RESTART_MS/
  );
});
