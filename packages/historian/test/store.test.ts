import { test } from "bun:test";
import assert from "node:assert/strict";

import {
  SqliteStore,
  type MeasurementInput,
} from "../src/store";

function input(overrides: Partial<MeasurementInput> = {}): MeasurementInput {
  return {
    deviceId: "pi-scale-1",
    measuredAt: "2026-11-01T10:00:00.000Z",
    userId: 1,
    weightX100: 741,
    resistance: 0,
    fatPercentage: 0,
    historical: false,
    firmwareVersion: 1,
    receivedAt: "2026-11-01T10:00:01.000Z",
    ...overrides,
  };
}

test("inserts measurements and ignores duplicates", () => {
  const store = new SqliteStore(":memory:");
  try {
    assert.equal(store.insert(input()), true);
    assert.equal(store.insert(input()), false);
    assert.equal(store.insert(input({ historical: true })), false);
    assert.equal(store.list({ limit: 10 }).length, 1);
  } finally {
    store.close();
  }
});

test("lists measurements with filters, ordering, and limits", () => {
  const store = new SqliteStore(":memory:");
  try {
    store.insert(input({ measuredAt: "2026-11-01T10:00:00.000Z", userId: 1, weightX100: 741 }));
    store.insert(input({ measuredAt: "2026-11-01T11:00:00.000Z", userId: 2, weightX100: 750 }));
    store.insert(input({ measuredAt: "2026-11-01T12:00:00.000Z", userId: 1, weightX100: 760 }));

    assert.deepEqual(
      store.list({ limit: 10 }).map((row) => row.weightX100),
      [760, 750, 741]
    );
    assert.deepEqual(
      store.list({ limit: 10, userId: 1 }).map((row) => row.weightX100),
      [760, 741]
    );
    assert.deepEqual(
      store
        .list({
          limit: 10,
          from: "2026-11-01T10:30:00.000Z",
          to: "2026-11-01T11:30:00.000Z",
        })
        .map((row) => row.weightX100),
      [750]
    );
    assert.deepEqual(
      store
        .list({ limit: 10, before: "2026-11-01T12:00:00.000Z" })
        .map((row) => row.weightX100),
      [750, 741]
    );
    assert.deepEqual(
      store.list({ limit: 1 }).map((row) => row.weightX100),
      [760]
    );
  } finally {
    store.close();
  }
});

test("returns the latest measurement", () => {
  const store = new SqliteStore(":memory:");
  try {
    store.insert(input({ measuredAt: "2026-11-01T10:00:00.000Z", userId: 1 }));
    store.insert(input({ measuredAt: "2026-11-01T12:00:00.000Z", userId: 2 }));
    store.insert(input({ measuredAt: "2026-11-01T11:00:00.000Z", userId: 1 }));

    assert.equal(store.latest()?.userId, 2);
    assert.equal(
      store.latest(1)?.scaleDate,
      Math.floor(Date.parse("2026-11-01T11:00:00.000Z") / 1000)
    );
    assert.equal(store.latest(9), null);
  } finally {
    store.close();
  }
});

test("records the model a driver reports", () => {
  const store = new SqliteStore(":memory:");
  try {
    store.insert(input());
    store.setDeviceModel("pi-scale-1", "YUNMAI-SIM", "2026-11-01T10:05:00.000Z");

    const device = store.devices()[0];
    assert.equal(device.model, "YUNMAI-SIM");
    // A status message is not a weighing, so the sighting does not move.
    assert.equal(device.lastSeenAt, "2026-11-01T10:00:01.000Z");
    assert.equal(device.firmwareVersion, 1);

    store.setDeviceModel("unknown-scale", "YUNMAI-MINI", "2026-11-01T10:06:00.000Z");
    assert.equal(
      store.devices().find((entry) => entry.id === "unknown-scale")?.model,
      "YUNMAI-MINI"
    );
  } finally {
    store.close();
  }
});

test("clears every measurement but keeps devices", () => {
  const store = new SqliteStore(":memory:");
  try {
    store.insert(input());
    store.insert(input({ measuredAt: "2026-11-01T11:00:00.000Z", weightX100: 750 }));

    assert.equal(store.clear(), 2);
    assert.equal(store.list({ limit: 10 }).length, 0);
    assert.equal(store.latest(), null);
    assert.equal(store.devices().length, 1);
    assert.equal(store.clear(), 0);
  } finally {
    store.close();
  }
});

test("lists devices with the most recent sighting", () => {
  const store = new SqliteStore(":memory:");
  try {
    store.insert(
      input({
        deviceId: "pi-scale-1",
        receivedAt: "2026-11-01T10:00:01.000Z",
      })
    );
    store.insert(
      input({
        deviceId: "pi-scale-1",
        measuredAt: "2026-11-01T11:00:00.000Z",
        receivedAt: "2026-11-01T11:00:01.000Z",
        weightX100: 750,
      })
    );
    store.insert(
      input({
        deviceId: "pi-scale-2",
        receivedAt: "2026-11-01T12:00:01.000Z",
        weightX100: 760,
      })
    );

    const devices = store.devices();
    assert.equal(devices.length, 2);
    assert.equal(devices[0].id, "pi-scale-2");
    assert.equal(devices[1].id, "pi-scale-1");
    assert.equal(devices[1].lastSeenAt, "2026-11-01T11:00:01.000Z");
  } finally {
    store.close();
  }
});
