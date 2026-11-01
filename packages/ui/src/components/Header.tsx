import type { DeviceStatus, Health, LiveConnection } from "../api";
import { StatusPill } from "./StatusPill";

export function Header({
  health,
  connection,
  deviceStatus,
}: {
  health: Health | null;
  connection: LiveConnection;
  deviceStatus: DeviceStatus | null;
}) {
  const serviceTone =
    health?.status === "ok" ? "ok" : health ? "warn" : "neutral";
  const connectionTone =
    connection === "live" ? "ok" : connection === "offline" ? "bad" : "warn";
  const upstream = health?.upstream;

  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-amber-600 dark:text-amber-400">
          Yunmai scale
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          yunmai-noble
        </h1>
        <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
          Live readings and measurement history
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <StatusPill
          label={connection === "live" ? "Live" : connection}
          tone={connectionTone}
        />
        <StatusPill
          label={health ? `Service ${health.status}` : "Service unknown"}
          tone={serviceTone}
        />
        {upstream?.configured ? (
          <StatusPill
            label={upstream.connected ? "Upstream connected" : "Upstream offline"}
            tone={upstream.connected ? "ok" : "bad"}
          />
        ) : null}
        {deviceStatus ? (
          <StatusPill
            label={deviceStatus.connected ? "Scale connected" : deviceStatus.bluetooth}
            tone={
              deviceStatus.connected
                ? "ok"
                : deviceStatus.bluetooth === "poweredOn"
                  ? "warn"
                  : "bad"
            }
          />
        ) : null}
      </div>
    </header>
  );
}
