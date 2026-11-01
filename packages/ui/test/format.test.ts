import { test } from "bun:test";
import assert from "node:assert/strict";

import type { Measurement } from "../src/api";
import {
  chartPath,
  formatWeight,
  measurementKey,
  mergeMeasurement,
} from "../src/lib/format";

function measurement(overrides: Partial<Measurement> = {}): Measurement {
  return {
    id: 1,
    deviceId: "scale-1",
    scaleDate: "2026-11-01T10:00:00.000Z",
    receivedAt: "2026-11-01T10:00:01.000Z",
    userId: 1,
    weightKg: 74.1,
    resistance: 0,
    fatPercentage: 0,
    historical: false,
    firmwareVersion: 1,
    ...overrides,
  };
}

test("formats weight with two decimals", () => {
  assert.equal(formatWeight(74.1), "74.10 kg");
  assert.equal(formatWeight(100), "100.00 kg");
});

test("builds a stable measurement key", () => {
  assert.equal(
    measurementKey(measurement()),
    "scale-1|2026-11-01T10:00:00.000Z|1|74.1"
  );
});

test("merges a measurement, replacing duplicates and sorting newest first", () => {
  const older = measurement({
    id: 1,
    scaleDate: "2026-11-01T09:00:00.000Z",
    weightKg: 73.8,
  });
  const newer = measurement({
    id: 2,
    scaleDate: "2026-11-01T11:00:00.000Z",
    weightKg: 74.2,
  });

  const merged = mergeMeasurement([older], newer);
  assert.deepEqual(
    merged.map((item) => item.id),
    [2, 1]
  );

  const replaced = mergeMeasurement([older], { ...older, id: 3 });
  assert.equal(replaced.length, 1);
  assert.equal(replaced[0].id, 3);
});

test("keeps the merged history capped at 100 readings", () => {
  const history = Array.from({ length: 100 }, (_, index) =>
    measurement({
      id: index,
      scaleDate: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    })
  );
  const merged = mergeMeasurement(
    history,
    measurement({
      id: 100,
      scaleDate: "2027-01-01T00:00:00.000Z",
    })
  );

  assert.equal(merged.length, 100);
  assert.equal(merged[0].id, 100);
});

test("renders an empty chart for no values", () => {
  assert.equal(chartPath([]), "");
});

test("renders a flat line for a single value", () => {
  assert.equal(chartPath([70]), "M12.00,90.00");
});

test("maps values across the full chart box", () => {
  assert.equal(chartPath([70, 71]), "M12.00,168.00 L588.00,12.00");
});
