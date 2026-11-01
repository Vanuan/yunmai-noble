import { useCallback, useEffect, useRef, useState } from "react";

import {
  fetchSimulator,
  simulatorCommand,
  startSimulatorDriver,
  type ApiError,
  type SimulatorState,
} from "../api";
import { formatWeight } from "../lib/format";
import { ErrorBanner } from "./ErrorBanner";
import { StatusPill } from "./StatusPill";

type PanelMode = "loading" | "ready" | "stopped" | "unavailable";

function isApiError(reason: unknown): reason is ApiError {
  return reason instanceof Error && typeof (reason as ApiError).status === "number";
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

export function SimulatorPanel({ liveWeightKg }: { liveWeightKg: number | null }) {
  const [simulator, setSimulator] = useState<SimulatorState | null>(null);
  const [mode, setMode] = useState<PanelMode>("loading");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [weight, setWeight] = useState("7.5");
  const [user, setUser] = useState("1");
  const weightEditing = useRef(false);
  const userEditing = useRef(false);

  const apply = useCallback((state: SimulatorState) => {
    setSimulator(state);
    setMode("ready");
    setError(null);
    if (!weightEditing.current) setWeight(String(state.weightKg));
    if (!userEditing.current) setUser(String(state.user));
  }, []);

  const refresh = useCallback(async () => {
    try {
      apply(await fetchSimulator());
    } catch (reason) {
      if (isApiError(reason) && reason.status === 409) {
        setMode("stopped");
        setSimulator(null);
        setError(null);
        return;
      }
      setMode("unavailable");
      setError(message(reason));
    }
  }, [apply]);

  useEffect(() => {
    let active = true;
    const poll = () => {
      if (active) void refresh();
    };
    poll();
    const timer = setInterval(poll, 1500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [refresh]);

  async function run(command: () => Promise<SimulatorState>): Promise<void> {
    setBusy(true);
    try {
      apply(await command());
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }

  async function startDriver(): Promise<void> {
    setBusy(true);
    setMode("loading");
    try {
      await startSimulatorDriver();
      setError(null);
    } catch (reason) {
      setMode("stopped");
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }

  function submitWeight(): void {
    weightEditing.current = false;
    const kg = Number(weight);
    if (!Number.isFinite(kg) || kg <= 0 || kg > 655.35) {
      setError("Weight must be between 0 and 655.35 kg");
      if (simulator) setWeight(String(simulator.weightKg));
      return;
    }
    void run(() => simulatorCommand("weight", { kg }));
  }

  function submitUser(): void {
    userEditing.current = false;
    const id = Number(user);
    if (!Number.isInteger(id) || id < 0 || id > 0xffffffff) {
      setError("User must be a non-negative integer");
      if (simulator) setUser(String(simulator.user));
      return;
    }
    void run(() => simulatorCommand("user", { id }));
  }

  if (mode === "stopped" || mode === "unavailable" || !simulator) {
    return (
      <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-stone-500 dark:text-stone-400">
            Simulator scale
          </h2>
          <StatusPill
            label={mode === "stopped" ? "driver stopped" : mode}
            tone={mode === "unavailable" ? "bad" : "neutral"}
          />
        </div>

        <p className="mt-4 text-sm text-stone-500 dark:text-stone-400">
          {mode === "stopped"
            ? "Start the simulator driver to drive a virtual scale from this page."
            : mode === "loading"
              ? "Looking for the simulator..."
              : "The simulator control surface is not available."}
        </p>

        {error ? <div className="mt-4"><ErrorBanner message={error} /></div> : null}

        <div className="mt-4 flex gap-2">
          {mode === "stopped" ? (
            <button
              type="button"
              onClick={() => void startDriver()}
              disabled={busy}
              className="rounded-lg bg-stone-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
            >
              Start simulator driver
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium dark:border-stone-700"
          >
            Retry
          </button>
        </div>
      </section>
    );
  }

  const display =
    liveWeightKg ?? simulator.lastWeightKg ?? simulator.weightKg;
  const status = simulator.running
    ? "measuring"
    : simulator.powered
      ? "ready"
      : "off";

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-stone-500 dark:text-stone-400">
            Simulator scale
          </h2>
          <p className="mt-1 text-xs text-stone-400 dark:text-stone-500">
            {simulator.steps} steps · {simulator.intervalMs} ms · repeat{" "}
            {simulator.repeat ? "on" : "off"} · {simulator.history} in history
          </p>
        </div>
        <StatusPill
          label={status}
          tone={
            simulator.running
              ? "ok"
              : simulator.powered
                ? "neutral"
                : "warn"
          }
        />
      </div>

      {error ? <div className="mt-4"><ErrorBanner message={error} /></div> : null}

      <div className="mt-5 flex flex-col items-center gap-6 sm:flex-row sm:items-center">
        <div className="w-full rounded-2xl bg-stone-900 p-5 text-center font-mono text-emerald-300 shadow-inner dark:bg-black">
          <p className="text-4xl font-semibold tabular-nums tracking-tight sm:text-5xl">
            {formatWeight(display)}
          </p>
          <p className="mt-2 text-xs uppercase tracking-[0.2em] text-emerald-500/70">
            {simulator.running ? "weighing" : "last reading"}
          </p>
        </div>

        <button
          type="button"
          onClick={() => void run(() => simulatorCommand("start"))}
          disabled={
            busy ||
            !simulator.powered ||
            !simulator.subscribed ||
            simulator.running
          }
          className="h-32 w-32 shrink-0 rounded-full bg-amber-500 text-sm font-semibold uppercase tracking-wide text-stone-950 shadow-md transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 sm:h-36 sm:w-36"
        >
          {simulator.running ? "Weighing..." : "Step on"}
        </button>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="flex items-center justify-between gap-3 rounded-xl border border-stone-200 px-4 py-3 dark:border-stone-800">
          <div>
            <p className="text-sm font-medium">Power</p>
            <p className="text-xs text-stone-500 dark:text-stone-400">
              {simulator.powered ? "scale is on" : "scale is off"}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={simulator.powered}
            aria-label="Simulator scale power"
            onClick={() =>
              void run(() =>
                simulatorCommand("power", { on: !simulator.powered })
              )
            }
            disabled={busy}
            className={`relative h-7 w-12 rounded-full transition ${
              simulator.powered
                ? "bg-emerald-500"
                : "bg-stone-300 dark:bg-stone-700"
            } disabled:opacity-50`}
          >
            <span
              className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${
                simulator.powered ? "left-6" : "left-1"
              }`}
            />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <label className="flex-1 text-xs font-medium text-stone-500 dark:text-stone-400">
            Weight (kg)
            <input
              type="number"
              min="0.1"
              max="655.35"
              step="0.01"
              value={weight}
              onFocus={() => {
                weightEditing.current = true;
              }}
              onChange={(event) => setWeight(event.target.value)}
              onBlur={submitWeight}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm tabular-nums text-stone-900 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100"
            />
          </label>
          <label className="w-24 text-xs font-medium text-stone-500 dark:text-stone-400">
            User
            <input
              type="number"
              min="0"
              step="1"
              value={user}
              onFocus={() => {
                userEditing.current = true;
              }}
              onChange={(event) => setUser(event.target.value)}
              onBlur={submitUser}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm tabular-nums text-stone-900 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100"
            />
          </label>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void run(() => simulatorCommand("stop"))}
          disabled={busy || !simulator.running}
          className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium disabled:opacity-40 dark:border-stone-700"
        >
          Step off
        </button>
        <button
          type="button"
          onClick={() => void run(() => simulatorCommand("history"))}
          disabled={busy || !simulator.powered}
          className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium disabled:opacity-40 dark:border-stone-700"
        >
          Replay history
        </button>
      </div>

      {!simulator.subscribed ? (
        <p className="mt-3 text-xs text-stone-400 dark:text-stone-500">
          Waiting for the node to subscribe to the simulated scale...
        </p>
      ) : null}
    </section>
  );
}
