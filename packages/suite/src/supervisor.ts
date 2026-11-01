import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type { Logger } from "@yunmai-noble/historian/logger";

import {
  DRIVERS,
  driverNodeId,
  driverPort,
  type DriverName,
  type SuiteConfig,
} from "./config";

const NODE_SCRIPT = fileURLToPath(
  new URL("../../node/ble.js", import.meta.url)
);
const NODE_DIR = dirname(NODE_SCRIPT);

type Child = ReturnType<typeof Bun.spawn>;

export type DriverState =
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "restarting"
  | "failed";

export interface DriverView {
  driver: DriverName;
  nodeId: string;
  url: string;
  desired: boolean;
  state: DriverState;
  pid: number | null;
  restarts: number;
  startedAt: string | null;
  lastExit: {
    code: number | null;
    signal: NodeJS.Signals | number | null;
    at: string;
  } | null;
  error: string | null;
}

interface DriverRecord {
  driver: DriverName;
  nodeId: string;
  url: string;
  desired: boolean;
  state: DriverState;
  pid: number | null;
  restarts: number;
  startedAt: string | null;
  lastExit: DriverView["lastExit"];
  error: string | null;
  child: Child | null;
  restartTimer: ReturnType<typeof setTimeout> | null;
  upstreamActive: boolean;
}

export interface SupervisorOptions {
  config: SuiteConfig;
  logger: Logger;
  onStart?: (view: DriverView) => void;
  onStop?: (view: DriverView) => void;
  bunRuntime?: string;
  nodeRuntime?: string | null;
}

function unref(timer: ReturnType<typeof setTimeout>): void {
  (timer as unknown as { unref?: () => void }).unref?.();
}

// Supervises one node process per scale driver. Every driver speaks the same
// v1 WebSocket contract, so the historian can follow any combination of them
// and drivers can be started or stopped while the suite is running.
export class DriverSupervisor {
  private readonly config: SuiteConfig;
  private readonly logger: Logger;
  private readonly onStart?: (view: DriverView) => void;
  private readonly onStop?: (view: DriverView) => void;
  private readonly bunRuntime: string;
  private readonly nodeRuntime: string | null;
  private readonly records = new Map<DriverName, DriverRecord>();

  constructor(options: SupervisorOptions) {
    this.config = options.config;
    this.logger = options.logger;
    this.onStart = options.onStart;
    this.onStop = options.onStop;
    this.bunRuntime =
      options.bunRuntime ?? Bun.which("bun") ?? process.execPath;
    this.nodeRuntime =
      options.nodeRuntime !== undefined
        ? options.nodeRuntime
        : Bun.which("node");

    for (const driver of DRIVERS) {
      this.records.set(driver, {
        driver,
        nodeId: driverNodeId(this.config, driver),
        url: `ws://127.0.0.1:${driverPort(this.config, driver)}`,
        desired: false,
        state: "stopped",
        pid: null,
        restarts: 0,
        startedAt: null,
        lastExit: null,
        error: null,
        child: null,
        restartTimer: null,
        upstreamActive: false,
      });
    }

    for (const driver of this.config.drivers) {
      this.start(driver);
    }
  }

  list(): DriverView[] {
    return DRIVERS.map((driver) => this.view(this.require(driver)));
  }

  start(driver: DriverName): DriverView {
    const record = this.require(driver);
    record.desired = true;

    if (record.child) return this.view(record);

    this.clearRestart(record);
    this.spawn(record);
    return this.view(record);
  }

  stop(driver: DriverName): DriverView {
    const record = this.require(driver);
    record.desired = false;
    this.clearRestart(record);

    if (!record.child) {
      record.state = "stopped";
      this.notifyStop(record);
      return this.view(record);
    }

    record.state = "stopping";
    const child = record.child;
    child.kill("SIGINT");

    const timer = setTimeout(() => {
      if (record.child === child) child.kill("SIGKILL");
    }, 2000);
    unref(timer);

    return this.view(record);
  }

  async stopAll(): Promise<void> {
    await Promise.allSettled(
      this.list().map(({ driver }) => this.stopAndWait(driver))
    );
  }

  private async stopAndWait(driver: DriverName): Promise<void> {
    const record = this.require(driver);
    record.desired = false;
    this.clearRestart(record);

    const child = record.child;
    if (!child) {
      record.state = "stopped";
      this.notifyStop(record);
      return;
    }

    record.state = "stopping";
    child.kill("SIGINT");

    const timer = setTimeout(() => {
      if (record.child === child) child.kill("SIGKILL");
    }, 2000);
    try {
      await child.exited;
    } finally {
      clearTimeout(timer);
    }
  }

  private spawn(record: DriverRecord): void {
    const runtime =
      record.driver === "noble" ? this.nodeRuntime : this.bunRuntime;

    if (!runtime) {
      record.state = "failed";
      record.desired = false;
      record.error = "BLE_DRIVER=noble requires node on PATH";
      this.notifyStop(record);
      return;
    }

    record.state = "starting";
    record.error = null;

    let child: Child;
    try {
      child = Bun.spawn({
        cmd: [runtime, NODE_SCRIPT],
        cwd: NODE_DIR,
        env: {
          ...process.env,
          BLE_DRIVER: record.driver,
          NODE_ID: record.nodeId,
          WS_PORT: String(driverPort(this.config, record.driver)),
        },
        stdout: "inherit",
        stderr: "inherit",
        onExit: (_child, code, signal) => {
          this.handleExit(record, _child, code, signal);
        },
      });
    } catch (error) {
      record.state = "failed";
      record.desired = false;
      record.error = error instanceof Error ? error.message : String(error);
      this.notifyStop(record);
      return;
    }

    record.child = child;

    // onExit may run before Bun.spawn returns.
    if (child.exitCode !== null) {
      if (record.child === child) record.child = null;
      return;
    }

    record.pid = child.pid;
    record.state = "running";
    record.startedAt = new Date().toISOString();
    this.notifyStart(record);
  }

  private handleExit(
    record: DriverRecord,
    child: Child,
    code: number | null,
    signal: NodeJS.Signals | number | null
  ): void {
    if (record.child === child) record.child = null;
    record.pid = null;
    record.lastExit = {
      code,
      signal,
      at: new Date().toISOString(),
    };

    if (!record.desired) {
      record.state = "stopped";
      this.notifyStop(record);
      return;
    }

    if (this.config.restartMs <= 0) {
      record.state = "failed";
      record.error = `exited with code ${code ?? "null"}`;
      this.notifyStop(record);
      return;
    }

    record.restarts += 1;
    record.state = "restarting";
    this.logger.log(
      `suite: ${record.driver} exited (code ${code ?? "null"}); ` +
        `restarting in ${this.config.restartMs} ms`
    );

    this.clearRestart(record);
    record.restartTimer = setTimeout(() => {
      record.restartTimer = null;
      if (record.desired) this.spawn(record);
    }, this.config.restartMs);
    unref(record.restartTimer);
  }

  private notifyStart(record: DriverRecord): void {
    record.upstreamActive = true;
    this.onStart?.(this.view(record));
  }

  private notifyStop(record: DriverRecord): void {
    if (!record.upstreamActive) return;
    record.upstreamActive = false;
    this.onStop?.(this.view(record));
  }

  private clearRestart(record: DriverRecord): void {
    if (record.restartTimer) {
      clearTimeout(record.restartTimer);
      record.restartTimer = null;
    }
  }

  private require(driver: DriverName): DriverRecord {
    const record = this.records.get(driver);
    if (!record) throw new Error(`Unknown driver: ${driver}`);
    return record;
  }

  private view(record: DriverRecord): DriverView {
    return {
      driver: record.driver,
      nodeId: record.nodeId,
      url: record.url,
      desired: record.desired,
      state: record.state,
      pid: record.pid,
      restarts: record.restarts,
      startedAt: record.startedAt,
      lastExit: record.lastExit,
      error: record.error,
    };
  }
}
