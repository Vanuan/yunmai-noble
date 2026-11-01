import { SimulatorPanel } from "../components/SimulatorPanel";
import { useLiveWeight } from "../hooks/useLiveWeight";

export function SimulatorApp() {
  const live = useLiveWeight();

  return (
    <div className="min-h-full bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 lg:py-12">
        <header>
          <a
            href="/"
            className="text-xs font-medium text-amber-600 hover:underline dark:text-amber-400"
          >
            &larr; Dashboard
          </a>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            Virtual scale
          </h1>
          <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
            Drives the simulator driver through the suite control API.
          </p>
        </header>

        <SimulatorPanel liveWeightKg={live} />

        <footer className="mt-auto pt-4 text-xs text-stone-400 dark:text-stone-500">
          Runs against <code>/api/suite/simulator</code>.
        </footer>
      </div>
    </div>
  );
}
