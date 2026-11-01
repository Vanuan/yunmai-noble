import type { Measurement } from "../api";
import { formatDateTime, formatWeight, measurementKey } from "../lib/format";

export function HistoryList({ measurements }: { measurements: Measurement[] }) {
  const visible = measurements.slice(0, 20);

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-stone-500 dark:text-stone-400">
          History
        </h2>
        <span className="text-xs text-stone-400 dark:text-stone-500">
          {measurements.length} readings
        </span>
      </div>

      {visible.length === 0 ? (
        <p className="mt-8 text-sm text-stone-500 dark:text-stone-400">
          No measurements yet. Step on the scale to get started.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-stone-100 dark:divide-stone-800">
          {visible.map((measurement) => (
            <li
              key={measurementKey(measurement)}
              className="flex items-center justify-between gap-4 py-3"
            >
              <div className="min-w-0">
                <p className="font-medium tabular-nums">
                  {formatWeight(measurement.weightKg)}
                </p>
                <p className="mt-0.5 truncate text-xs text-stone-500 dark:text-stone-400">
                  {formatDateTime(measurement.scaleDate)}
                  {" · "}user {measurement.userId}
                  {" · "}
                  {measurement.deviceId}
                </p>
              </div>
              {measurement.historical ? (
                <span className="shrink-0 rounded-full bg-stone-100 px-2 py-1 text-[11px] font-medium text-stone-500 dark:bg-stone-800 dark:text-stone-400">
                  historical
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
