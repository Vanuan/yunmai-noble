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
    const message = error instanceof Error ? error.message : String(error);
    this.lastError = message;
    this.logger.error(`historian: upstream error: ${message}`);
  }
}
