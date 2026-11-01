import { dirname } from "node:path";
import { connect } from "node:net";
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

const READY_TIMEOUT_MS = 5000;
const READY_POLL_MS = 50;

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    const done = (value: boolean): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };

    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.setTimeout(500, () => done(false));
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  token: object | null;
}

export interface SupervisorOptions {
  config: SuiteConfig;
  logger: Logger;
  env?: Record<string, string | undefined>;
  onStart?: (view: DriverView) => void;
  onStop?: (view: DriverView, reason: "stopped" | "exited") => void;
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
  private readonly driverEnv: Record<string, string | undefined>;
  private readonly onStart?: (view: DriverView) => void;
  private readonly onStop?: (
    view: DriverView,
    reason: "stopped" | "exited"
  ) => void;
  private readonly bunRuntime: string;
  private readonly nodeRuntime: string | null;
  private readonly records = new Map<DriverName, DriverRecord>();

  constructor(options: SupervisorOptions) {
    this.config = options.config;
    this.logger = options.logger;
    this.driverEnv = options.env ?? process.env;
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
        token: null,
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
    this.notifyStop(record, "stopped");

    if (!record.child) {
      record.state = "stopped";
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
    this.notifyStop(record, "stopped");

    const child = record.child;
    if (!child) {
      record.state = "stopped";
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
      this.notifyStop(record, "exited");
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
          ...this.driverEnv,
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
      this.notifyStop(record, "exited");
      return;
    }

    record.child = child;

    // onExit may run before Bun.spawn returns.
    if (child.exitCode !== null) {
      if (record.child === child) record.child = null;
      record.token = null;
      return;
    }

    record.pid = child.pid;
    record.state = "starting";

    const token = {};
    record.token = token;
    void this.markReady(record, child, token);
  }

  // Do not attach the historian until the child's WebSocket is listening,
  // which avoids a guaranteed failed connection on every start and restart.
  private async markReady(
    record: DriverRecord,
    child: Child,
    token: object
  ): Promise<void> {
    const port = driverPort(this.config, record.driver);
    const deadline = Date.now() + READY_TIMEOUT_MS;
    let ready = false;

    while (!ready && Date.now() < deadline) {
      if (record.child !== child || record.token !== token) return;
      ready = await canConnect(port);
      if (!ready) await sleep(READY_POLL_MS);
    }

    if (record.child !== child || record.token !== token) return;
    if (!ready) {
      this.logger.log(
        `suite: ${record.driver} did not open ${record.url} within ` +
          `${READY_TIMEOUT_MS} ms; attaching upstream anyway`
      );
    }

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
    record.token = null;
    record.pid = null;
    record.lastExit = {
      code,
      signal,
      at: new Date().toISOString(),
    };

    // The upstream is gone while the driver restarts.
    this.notifyStop(record, "exited");

    if (!record.desired) {
      record.state = "stopped";
      return;
    }

    if (this.config.restartMs <= 0) {
      record.state = "failed";
      record.error = `exited with code ${code ?? "null"}`;
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

  private notifyStop(
    record: DriverRecord,
    reason: "stopped" | "exited"
  ): void {
    if (!record.upstreamActive) return;
    record.upstreamActive = false;
    this.onStop?.(this.view(record), reason);
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
