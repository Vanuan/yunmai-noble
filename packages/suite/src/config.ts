export const DRIVERS = ["dbus", "simulator", "noble"] as const;

export type DriverName = (typeof DRIVERS)[number];

export interface SuiteConfig {
  drivers: DriverName[];
  nodeIdPrefix: string;
  restartMs: number;
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
  };
}

export function driverNodeId(config: SuiteConfig, driver: DriverName): string {
  return `${config.nodeIdPrefix}-${driver}`;
}
