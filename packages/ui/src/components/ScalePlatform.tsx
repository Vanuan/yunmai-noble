function BluetoothMark({ active }: { active: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-3 w-3 ${active ? "text-stone-500" : "text-stone-300"}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <path
        d="M7 7l10 10-5 4V3l5 4L7 17"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export interface ScalePlatformProps {
  weightKg: number;
  powered: boolean;
  running: boolean;
  subscribed: boolean;
  disabled: boolean;
  onPress(): void;
}

export function ScalePlatform({
  weightKg,
  powered,
  running,
  subscribed,
  disabled,
  onPress,
}: ScalePlatformProps) {
  const display = powered ? weightKg.toFixed(2) : "--.--";

  return (
    <div className="relative mx-auto w-full max-w-[30rem]">
      <div className="pointer-events-none absolute inset-x-10 bottom-3 h-16 rounded-[50%] bg-stone-900/15 blur-2xl dark:bg-black/60" />

      <button
        type="button"
        onClick={onPress}
        disabled={disabled}
        aria-label={
          powered
            ? "Step on the simulated scale"
            : "Switch on the simulated scale"
        }
        className="group relative block aspect-square w-full overflow-hidden rounded-[2.75rem] bg-gradient-to-br from-white via-stone-50 to-stone-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),inset_0_-12px_28px_rgba(120,113,108,0.16),0_30px_60px_-24px_rgba(41,37,36,0.55)] ring-1 ring-stone-300/70 transition duration-150 hover:ring-stone-400/60 active:scale-[0.994] disabled:cursor-default disabled:opacity-90"
      >
        <span className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-white/80 via-transparent to-white/30" />
        <span className="pointer-events-none absolute inset-3 rounded-[2.25rem] border border-white/80 shadow-[inset_0_1px_1px_rgba(255,255,255,0.95),inset_0_-14px_32px_rgba(168,162,158,0.14)]" />

        <div
          className={`pointer-events-none absolute left-1/2 top-[10%] w-[58%] -translate-x-1/2 text-center transition-opacity ${
            powered ? "opacity-100" : "opacity-45"
          }`}
        >
          <p className="font-mono text-[clamp(2.1rem,7.2vw,3.6rem)] font-semibold leading-none tabular-nums tracking-[0.08em] text-stone-500 [text-shadow:0_1px_0_rgba(255,255,255,0.95),0_0_18px_rgba(120,113,108,0.35)]">
            {display}
          </p>
          <div className="mt-2 flex items-center justify-center gap-3 text-[0.55rem] font-medium uppercase tracking-[0.3em] text-stone-400">
            <span>kg</span>
            <span className="flex items-center gap-1">
              <BluetoothMark active={powered && subscribed} />
              {powered ? (subscribed ? "ready" : "offline") : "off"}
            </span>
          </div>
        </div>

        <span className="pointer-events-none absolute left-[16%] top-[27%] h-[7%] w-[27%] -rotate-[9deg] rounded-full border border-stone-300/70 bg-gradient-to-b from-white via-stone-200 to-stone-400 shadow-[inset_0_1px_1px_rgba(255,255,255,0.95),0_1px_2px_rgba(120,113,108,0.18)]" />
        <span className="pointer-events-none absolute right-[16%] top-[27%] h-[7%] w-[27%] rotate-[9deg] rounded-full border border-stone-300/70 bg-gradient-to-b from-white via-stone-200 to-stone-400 shadow-[inset_0_1px_1px_rgba(255,255,255,0.95),0_1px_2px_rgba(120,113,108,0.18)]" />
        <span className="pointer-events-none absolute bottom-[27%] left-[16%] h-[7%] w-[27%] rotate-[9deg] rounded-full border border-stone-300/70 bg-gradient-to-b from-white via-stone-200 to-stone-400 shadow-[inset_0_1px_1px_rgba(255,255,255,0.95),0_1px_2px_rgba(120,113,108,0.18)]" />
        <span className="pointer-events-none absolute right-[16%] bottom-[27%] h-[7%] w-[27%] -rotate-[9deg] rounded-full border border-stone-300/70 bg-gradient-to-b from-white via-stone-200 to-stone-400 shadow-[inset_0_1px_1px_rgba(255,255,255,0.95),0_1px_2px_rgba(120,113,108,0.18)]" />

        <span className="pointer-events-none absolute left-1/2 top-1/2 h-[13%] w-[13%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle_at_35%_30%,#ffffff_0%,#e7e5e4_30%,#a8a29e_65%,#78716c_100%)] shadow-[inset_0_1px_2px_rgba(255,255,255,0.95),inset_0_-2px_4px_rgba(68,64,60,0.35),0_3px_6px_rgba(41,37,36,0.25)] ring-1 ring-stone-400/40" />

        <span className="pointer-events-none absolute bottom-[8%] left-1/2 -translate-x-1/2 text-[0.55rem] font-semibold uppercase tracking-[0.42em] text-stone-400/80">
          yunmai
        </span>

        {running ? (
          <span className="pointer-events-none absolute inset-0 animate-pulse rounded-[2.75rem] ring-2 ring-emerald-400/40" />
        ) : null}
      </button>

      <p className="mt-4 text-center text-xs text-stone-500 dark:text-stone-400">
        {running
          ? "Weighing..."
          : powered
            ? "Tap the platform to start a weighing"
            : "Tap the platform to switch it on"}
      </p>
    </div>
  );
}
