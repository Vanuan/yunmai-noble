import type { Measurement } from "../api";

export function formatWeight(weightKg: number): string {
  return `${weightKg.toFixed(2)} kg`;
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function measurementKey(
  measurement: Pick<
    Measurement,
    "deviceId" | "scaleDate" | "userId" | "weightKg"
  >
): string {
  return [
    measurement.deviceId,
    measurement.scaleDate,
    measurement.userId,
    measurement.weightKg,
  ].join("|");
}

export function mergeMeasurement(
  measurements: Measurement[],
  measurement: Measurement
): Measurement[] {
  const key = measurementKey(measurement);
  const next = measurements.filter((item) => measurementKey(item) !== key);
  next.push(measurement);
  next.sort((left, right) => {
    const byDate = right.scaleDate.localeCompare(left.scaleDate);
    return byDate !== 0 ? byDate : right.id - left.id;
  });
  return next.slice(0, 100);
}

export function chartPath(
  values: number[],
  width = 600,
  height = 180,
  padding = 12
): string {
  if (values.length === 0) return "";

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const step = (width - padding * 2) / Math.max(1, values.length - 1);

  return values
    .map((value, index) => {
      const x = padding + index * step;
      const y =
        span === 0
          ? height / 2
          : height - padding - ((value - min) / span) * (height - padding * 2);
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}
