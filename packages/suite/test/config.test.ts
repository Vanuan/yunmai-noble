import { test } from "bun:test";
import assert from "node:assert/strict";

import { driverNodeId, loadSuiteConfig } from "../src/config";

test("defaults to the real BLE driver", () => {
  assert.deepEqual(loadSuiteConfig({}), {
    drivers: ["dbus"],
    nodeIdPrefix: "scale",
    restartMs: 2000,
    simulator: {
      name: "YUNMAI-SIM",
      weightKg: 72.4,
      steps: 8,
      intervalMs: 300,
      cycleDelayMs: 5000,
      scanDelayMs: 200,
      autoStart: false,
      repeat: false,
    },
  });
});

test("reads the simulator settings the driver receives", () => {
  const config = loadSuiteConfig({
    SUITE_SCALES: "simulator",
    SIMULATOR_WEIGHT_KG: "72.4",
    SIMULATOR_STEPS: "6",
    SIMULATOR_INTERVAL_MS: "200",
    SIMULATOR_CYCLE_DELAY_MS: "4000",
    SIMULATOR_REPEAT: "true",
  });

  assert.equal(config.simulator.weightKg, 72.4);
  assert.equal(config.simulator.steps, 6);
  assert.equal(config.simulator.intervalMs, 200);
  assert.equal(config.simulator.cycleDelayMs, 4000);
  assert.equal(config.simulator.repeat, true);
  assert.equal(config.simulator.autoStart, false);
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
