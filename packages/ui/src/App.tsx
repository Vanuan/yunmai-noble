import { ErrorBanner } from "./components/ErrorBanner";
import { Header } from "./components/Header";
import { HistoryList } from "./components/HistoryList";
import { LatestWeightCard } from "./components/LatestWeightCard";
import { SimulatorPanel } from "./components/SimulatorPanel";
import { WeightChart } from "./components/WeightChart";
import { useDashboard } from "./hooks/useDashboard";

export function App() {
  const {
    measurements,
    latest,
    live,
    health,
    deviceStatus,
    connection,
    error,
    loading,
  } = useDashboard();

  return (
    <div className="min-h-full bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
      <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 lg:py-12">
        <Header
          health={health}
          connection={connection}
          deviceStatus={deviceStatus}
        />

        {error ? <ErrorBanner message={error} /> : null}
        {loading ? (
          <p className="text-sm text-stone-500 dark:text-stone-400">
            Loading history...
          </p>
        ) : null}

        <main className="grid gap-6 lg:grid-cols-5">
          <div className="flex flex-col gap-6 lg:col-span-3">
            <LatestWeightCard
              latest={latest}
              live={live}
              deviceStatus={deviceStatus}
            />
            <WeightChart measurements={measurements} />
            <SimulatorPanel liveWeightKg={live?.weightKg ?? null} />
          </div>
          <div className="lg:col-span-2">
            <HistoryList measurements={measurements} />
          </div>
        </main>

        <footer className="mt-auto pt-4 text-xs text-stone-400 dark:text-stone-500">
          Weight historian · updates live while this page is open
        </footer>
      </div>
    </div>
  );
}
