import type { Measurement } from "../api";
import { chartPath, formatDateTime, formatWeight } from "../lib/format";

export function WeightChart({ measurements }: { measurements: Measurement[] }) {
  const recent = measurements.slice(0, 24).reverse();
  const values = recent.map((measurement) => measurement.weightKg);
  const path = chartPath(values);
  const min = values.length > 0 ? Math.min(...values) : null;
  const max = values.length > 0 ? Math.max(...values) : null;

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-stone-500 dark:text-stone-400">
          Trend
        </h2>
        {min !== null && max !== null ? (
          <p className="text-xs text-stone-500 dark:text-stone-400">
            {formatWeight(min)} – {formatWeight(max)}
          </p>
        ) : null}
      </div>

      {values.length >= 2 ? (
        <svg
          viewBox="0 0 600 180"
          className="mt-4 h-44 w-full text-amber-500"
          role="img"
          aria-label="Weight trend"
        >
          <path
            d="M12,168 L588,168"
            className="stroke-stone-200 dark:stroke-stone-700"
            strokeWidth="1"
          />
          <path
            d={path}
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <p className="mt-10 text-sm text-stone-500 dark:text-stone-400">
          Not enough measurements yet.
        </p>
      )}

      <div className="mt-2 flex justify-between text-xs text-stone-400 dark:text-stone-500">
        <span>{recent[0] ? formatDateTime(recent[0].scaleDate) : ""}</span>
        <span>
          {recent.length > 0
            ? formatDateTime(recent[recent.length - 1].scaleDate)
            : ""}
        </span>
      </div>
    </section>
  );
}
