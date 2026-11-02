export const DRIVERS = ["dbus", "simulator", "noble"] as const;

export type DriverName = (typeof DRIVERS)[number];

/** Settings for the simulated scale, mirrored into SIMULATOR_* for the driver. */
export interface SimulatorConfig {
  name: string;
  weightKg: number;
  steps: number;
  intervalMs: number;
  cycleDelayMs: number;
  scanDelayMs: number;
  autoStart: boolean;
  repeat: boolean;
}

// Keep in sync with DEFAULT_OPTIONS in packages/node/src/bluetooth/simulator/
// scale.js, which applies when the driver runs outside the suite.
const SIMULATOR_DEFAULTS: SimulatorConfig = {
  name: "YUNMAI-SIM",
  weightKg: 7.5,
  steps: 8,
  intervalMs: 300,
  cycleDelayMs: 5000,
  scanDelayMs: 200,
  autoStart: false,
  repeat: false,
};

export interface SuiteConfig {
  drivers: DriverName[];
  nodeIdPrefix: string;
  restartMs: number;
  simulator: SimulatorConfig;
}

function integer(
  raw: string | undefined,
  name: string,
  fallback: number,
  min: number,
  max: number
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

export function isDriverName(value: string): value is DriverName {
  return (DRIVERS as readonly string[]).includes(value);
}

function float(
  raw: string | undefined,
  name: string,
  fallback: number,
  min: number,
  max: number
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be a number between ${min} and ${max}`);
  }
  return value;
}

function boolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

function loadSimulatorConfig(
  env: Record<string, string | undefined>
): SimulatorConfig {
  const defaults = SIMULATOR_DEFAULTS;
  return {
    name: env.SIMULATOR_NAME?.trim() || defaults.name,
    weightKg: float(env.SIMULATOR_WEIGHT_KG, "SIMULATOR_WEIGHT_KG", defaults.weightKg, 0.01, 655.35),
    steps: integer(env.SIMULATOR_STEPS, "SIMULATOR_STEPS", defaults.steps, 0, 64),
    intervalMs: integer(
      env.SIMULATOR_INTERVAL_MS,
      "SIMULATOR_INTERVAL_MS",
      defaults.intervalMs,
      1,
      60000
    ),
    cycleDelayMs: integer(
      env.SIMULATOR_CYCLE_DELAY_MS,
      "SIMULATOR_CYCLE_DELAY_MS",
      defaults.cycleDelayMs,
      0,
      600000
    ),
    scanDelayMs: integer(
      env.SIMULATOR_SCAN_DELAY_MS,
      "SIMULATOR_SCAN_DELAY_MS",
      defaults.scanDelayMs,
      0,
      60000
    ),
    autoStart: boolean(env.SIMULATOR_AUTO_START, defaults.autoStart),
    repeat: boolean(env.SIMULATOR_REPEAT, defaults.repeat),
  };
}

function parseDrivers(raw: string | undefined): DriverName[] {
  if (raw === undefined || raw.trim() === "") return ["dbus"];

  const names = raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);

  const unknown = names.filter((name) => !isDriverName(name));
  if (unknown.length > 0) {
    throw new Error(
      `SUITE_SCALES contains unknown drivers: ${unknown.join(", ")} ` +
        `(expected ${DRIVERS.join(", ")})`
    );
  }

  return Array.from(new Set(names)) as DriverName[];
}

export function loadSuiteConfig(
  env: Record<string, string | undefined> = process.env
): SuiteConfig {
  return {
    drivers: parseDrivers(env.SUITE_SCALES),
    nodeIdPrefix: env.SUITE_NODE_ID_PREFIX?.trim() || "scale",
    restartMs: integer(
      env.SUITE_DRIVER_RESTART_MS,
      "SUITE_DRIVER_RESTART_MS",
      2000,
      0,
      60000
    ),
    simulator: loadSimulatorConfig(env),
  };
}

export function driverNodeId(config: SuiteConfig, driver: DriverName): string {
  return `${config.nodeIdPrefix}-${driver}`;
}
