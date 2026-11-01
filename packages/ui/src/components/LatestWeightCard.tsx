import type { DeviceStatus, Measurement } from "../api";
import type { LiveWeight } from "../hooks/useDashboard";
import { formatDateTime, formatWeight } from "../lib/format";

export function LatestWeightCard({
  latest,
  live,
  deviceStatus,
}: {
  latest: Measurement | null;
  live: LiveWeight | null;
  deviceStatus: DeviceStatus | null;
}) {
  const weight = live ? live.weightKg : latest?.weightKg;
  const timestamp = live ? live.measuredAt : latest?.scaleDate;
  const device = latest?.deviceId ?? deviceStatus?.peripheralName ?? "No device";
  const user = live ? latest?.userId : latest?.userId;

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-stone-500 dark:text-stone-400">
          Latest weight
        </h2>
        {live ? (
          <span className="inline-flex items-center gap-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
            live
          </span>
        ) : null}
      </div>

      <p className="mt-4 text-5xl font-semibold tabular-nums tracking-tight">
        {weight === undefined ? "—" : formatWeight(weight)}
      </p>

      <dl className="mt-6 grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt className="text-stone-500 dark:text-stone-400">Measured</dt>
          <dd className="mt-1 font-medium">
            {timestamp ? formatDateTime(timestamp) : "No data"}
          </dd>
        </div>
        <div>
          <dt className="text-stone-500 dark:text-stone-400">User</dt>
          <dd className="mt-1 font-medium">{user ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-stone-500 dark:text-stone-400">Device</dt>
          <dd className="mt-1 truncate font-medium" title={device}>
            {device}
          </dd>
        </div>
        <div>
          <dt className="text-stone-500 dark:text-stone-400">Firmware</dt>
          <dd className="mt-1 font-medium">{latest?.firmwareVersion ?? "—"}</dd>
        </div>
      </dl>
    </section>
  );
}
