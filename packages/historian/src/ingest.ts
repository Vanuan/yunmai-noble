import WebSocket from "ws";
import {
  safeParseServerMessage,
  type ServerMessage,
} from "@yunmai-noble/contract";

import type { MeasurementStore } from "./store";
import type { SseHub } from "./sse";
import type { Logger } from "./logger";
import { LegacyMessageSchema, type LegacyMessage } from "./schemas";

export interface IngestStatus {
  configured: boolean;
  connected: boolean;
  lastMessageAt: string | null;
  lastError: string | null;
}

export interface IngestOptions {
  url: string;
  store: MeasurementStore;
  sse: SseHub;
  deviceId: string;
  reconnectMinMs: number;
  reconnectMaxMs: number;
  logger: Logger;
  now?: () => Date;
}

function unref(timer: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>): void {
  (timer as unknown as { unref?: () => void }).unref?.();
}

export class IngestClient {
  private readonly url: string;
  private readonly store: MeasurementStore;
  private readonly sse: SseHub;
  private readonly deviceId: string;
  private readonly reconnectMinMs: number;
  private readonly reconnectMaxMs: number;
  private readonly logger: Logger;
  private readonly now: () => Date;

  private socket: WebSocket | null = null;
  private connected = false;
  private stopped = false;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastMessageAt: string | null = null;
  private lastError: string | null = null;

  constructor(options: IngestOptions) {
    this.url = options.url;
    this.store = options.store;
    this.sse = options.sse;
    this.deviceId = options.deviceId;
    this.reconnectMinMs = options.reconnectMinMs;
    this.reconnectMaxMs = options.reconnectMaxMs;
    this.logger = options.logger;
    this.now = options.now ?? (() => new Date());
    this.connect();
  }

  status(): IngestStatus {
    return {
      configured: true,
      connected: this.connected,
      lastMessageAt: this.lastMessageAt,
      lastError: this.lastError,
    };
  }

  close(): void {
    this.stopped = true;
    this.connected = false;
    this.clearReconnect();
    this.stopHeartbeat();

    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.terminate();
      this.socket = null;
    }
  }

  private connect(): void {
    if (this.stopped) return;

    let socket: WebSocket;
    try {
      socket = new WebSocket(this.url);
    } catch (error) {
      this.recordError(error);
      this.scheduleReconnect();
      return;
    }

    this.socket = socket;

    socket.on("open", () => {
      this.connected = true;
      this.attempt = 0;
      this.lastError = null;
      this.logger.log(`historian: connected to ${this.url}`);
      this.startHeartbeat(socket);
    });

    socket.on("message", (data) => {
      this.handleRaw(data.toString());
    });

    socket.on("error", (error) => {
      this.recordError(error);
    });

    socket.on("close", () => {
      this.connected = false;
      this.stopHeartbeat();
      if (!this.stopped) {
        this.scheduleReconnect();
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.stopped) return;

    const exponential = Math.min(
      this.reconnectMaxMs,
      this.reconnectMinMs * 2 ** this.attempt
    );
    const delay = exponential + Math.floor(Math.random() * Math.min(1000, exponential));
    this.attempt = Math.min(this.attempt + 1, 10);

    this.logger.log(`historian: reconnecting in ${delay} ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
    unref(this.reconnectTimer);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private startHeartbeat(socket: WebSocket): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.ping();
      }
    }, 30000);
    unref(this.heartbeatTimer);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private handleRaw(raw: string): void {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      this.lastError = "invalid JSON from upstream";
      this.logger.error("historian: invalid JSON from upstream");
      return;
    }

    const current = safeParseServerMessage(json);
    if (current.success) {
      this.handleMessage(current.data);
      return;
    }

    const legacy = LegacyMessageSchema.safeParse(json);
    if (!legacy.success) {
      this.lastError = "unsupported message from upstream";
      this.logger.error("historian: unsupported message from upstream");
      return;
    }

    const mapped = this.mapLegacy(legacy.data);
    if (mapped) {
      this.handleMessage(mapped);
    }
  }

  private mapLegacy(message: LegacyMessage): ServerMessage | null {
    const sentAt = this.now().toISOString();
    const measuredAt = new Date(message.data.date * 1000).toISOString();

    if (message.packetType === "measuring") {
      return {
        v: 1,
        type: "measurement.measuring",
        deviceId: this.deviceId,
        sentAt,
        payload: {
          measuredAt,
          weight: message.data.weight,
        },
      };
    }

    return {
      v: 1,
      type: "measurement.completed",
      deviceId: this.deviceId,
      sentAt,
      payload: {
        measuredAt,
        userId: message.data.userId,
        weight: message.data.weight,
        resistance: message.data.resistance,
        fatPercentage: message.data.fatPercentage,
        historical: message.data.historicalInfo === 1,
        firmwareVersion: message.firmwareVersion,
      },
    };
  }

  private handleMessage(message: ServerMessage): void {
    this.lastMessageAt = this.now().toISOString();
    this.sse.broadcast(message);

    if (message.type === "status") {
      // The driver reports the advertised scale name; it is the only model
      // identifier a weight-only scale sends over the wire.
      const model = message.payload.peripheralName;
      if (model) {
        try {
          this.store.setDeviceModel(message.deviceId, model, this.now().toISOString());
        } catch (error) {
          this.recordError(error);
        }
      }
      return;
    }

    if (message.type !== "measurement.completed") return;

    try {
      const inserted = this.store.insert({
        deviceId: message.deviceId,
        measuredAt: message.payload.measuredAt,
        userId: message.payload.userId,
        weightX100: message.payload.weight,
        resistance: message.payload.resistance,
        fatPercentage: message.payload.fatPercentage,
        historical: message.payload.historical,
        firmwareVersion: message.payload.firmwareVersion,
        receivedAt: this.now().toISOString(),
      });

      if (!inserted) {
        this.logger.log("historian: duplicate measurement ignored");
      }
    } catch (error) {
      this.recordError(error);
    }
  }

  private recordError(error: unknown): void {
    const message =
      error instanceof Error
        ? error.message
        : typeof (error as { message?: unknown } | null)?.message === "string"
          ? String((error as { message: string }).message)
          : String(error);
    this.lastError = message;
    this.logger.error(`historian: upstream error: ${message}`);
  }
}

export interface IngestSourceOptions {
  id: string;
  url: string;
  deviceId: string;
  reconnectMinMs: number;
  reconnectMaxMs: number;
}

export interface IngestSourceStatus {
  id: string;
  url: string;
  status: IngestStatus;
}

export interface IngestGroupDeps {
  store: MeasurementStore;
  sse: SseHub;
  logger: Logger;
  now?: () => Date;
}

export interface IngestGroup {
  add(options: IngestSourceOptions): IngestClient;
  addClient(id: string, url: string, client: IngestClient): void;
  remove(id: string): boolean;
  get(id: string): IngestClient | undefined;
  statuses(): IngestSourceStatus[];
  aggregate(): IngestStatus;
  close(): void;
}

export const DISABLED_UPSTREAM: IngestStatus = {
  configured: false,
  connected: false,
  lastMessageAt: null,
  lastError: null,
};

export function aggregateStatus(statuses: IngestSourceStatus[]): IngestStatus {
  if (statuses.length === 0) return { ...DISABLED_UPSTREAM };

  let connected = true;
  let lastMessageAt: string | null = null;
  let lastError: string | null = null;

  for (const { status } of statuses) {
    if (!status.connected) connected = false;
    if (
      status.lastMessageAt &&
      (lastMessageAt === null || status.lastMessageAt > lastMessageAt)
    ) {
      lastMessageAt = status.lastMessageAt;
    }
    lastError ??= status.lastError;
  }

  return { configured: true, connected, lastMessageAt, lastError };
}

// Owns one ingest client per upstream so the historian can follow several
// scale drivers at once. The suite adds and removes sources as drivers start
// and stop.
export function createIngestGroup(deps: IngestGroupDeps): IngestGroup {
  const sources = new Map<string, { url: string; client: IngestClient }>();

  return {
    add(options: IngestSourceOptions): IngestClient {
      const existing = sources.get(options.id);
      if (existing) return existing.client;

      const client = new IngestClient({
        url: options.url,
        store: deps.store,
        sse: deps.sse,
        deviceId: options.deviceId,
        reconnectMinMs: options.reconnectMinMs,
        reconnectMaxMs: options.reconnectMaxMs,
        logger: deps.logger,
        now: deps.now,
      });

      sources.set(options.id, { url: options.url, client });
      return client;
    },

    addClient(id: string, url: string, client: IngestClient): void {
      sources.get(id)?.client.close();
      sources.set(id, { url, client });
    },

    remove(id: string): boolean {
      const source = sources.get(id);
      if (!source) return false;
      source.client.close();
      sources.delete(id);
      return true;
    },

    get(id: string): IngestClient | undefined {
      return sources.get(id)?.client;
    },

    statuses(): IngestSourceStatus[] {
      return Array.from(sources, ([id, source]) => ({
        id,
        url: source.url,
        status: source.client.status(),
      }));
    },

    aggregate(): IngestStatus {
      return aggregateStatus(Array.from(sources, ([id, source]) => ({
        id,
        url: source.url,
        status: source.client.status(),
      })));
    },

    close(): void {
      for (const { client } of sources.values()) client.close();
      sources.clear();
    },
  };
}
