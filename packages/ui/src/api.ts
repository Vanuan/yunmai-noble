import {
  safeParseServerMessage,
  type ServerMessage,
} from "@yunmai-noble/contract";

export interface Measurement {
  id: number;
  deviceId: string;
  scaleDate: string;
  receivedAt: string;
  userId: number;
  weightKg: number;
  resistance: number;
  fatPercentage: number;
  historical: boolean;
  firmwareVersion: number | null;
}

export interface MeasurementsResponse {
  measurements: Measurement[];
  next: string | null;
}

export interface Health {
  status: "ok" | "degraded";
  database: { ok: boolean };
  upstream: {
    configured: boolean;
    connected: boolean;
    lastMessageAt: string | null;
    lastError: string | null;
  };
}

export interface SimulatorState {
  powered: boolean;
  subscribed: boolean;
  running: boolean;
  weightKg: number;
  lastWeightKg: number | null;
  user: number;
  unit: "kg" | "lb";
  step: number;
  steps: number;
  repeat: boolean;
  intervalMs: number;
  history: number;
}

export interface ApiError extends Error {
  status: number;
  code?: string;
}

export type SimulatorAction =
  | "start"
  | "stop"
  | "power"
  | "weight"
  | "user"
  | "history";

export type DeviceStatus = Extract<ServerMessage, { type: "status" }>["payload"];
export type LiveConnection = "connecting" | "live" | "offline";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    let message = `Request failed: ${response.status} ${response.statusText}`;
    let code: string | undefined;

    try {
      const body = (await response.json()) as {
        error?: { code?: string; message?: string };
      };
      if (body.error?.message) message = body.error.message;
      code = body.error?.code;
    } catch {
      // Keep the status text when the body is not JSON.
    }

    throw Object.assign(new Error(message), {
      status: response.status,
      code,
    }) as ApiError;
  }
  return (await response.json()) as T;
}

export async function fetchMeasurements(limit = 100): Promise<Measurement[]> {
  const data = await request<MeasurementsResponse>(
    `/api/measurements?limit=${encodeURIComponent(String(limit))}`
  );
  return data.measurements;
}

export async function fetchLatest(): Promise<Measurement | null> {
  const response = await fetch("/api/measurements/latest");
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(
      `Request failed: ${response.status} ${response.statusText}`
    );
  }
  return (await response.json()) as Measurement;
}

export function fetchHealth(): Promise<Health> {
  return request<Health>("/health");
}

export function fetchSimulator(): Promise<SimulatorState> {
  return request<SimulatorState>("/api/suite/simulator");
}

export function startSimulatorDriver(): Promise<unknown> {
  return request("/api/suite/drivers/simulator/start", { method: "POST" });
}

export function simulatorCommand(
  action: SimulatorAction,
  body?: unknown
): Promise<SimulatorState> {
  return request<SimulatorState>(`/api/suite/simulator/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

export interface LiveHandlers {
  onMessage(message: ServerMessage): void;
  onConnectionChange(state: LiveConnection): void;
}

export function subscribeLive(handlers: LiveHandlers): () => void {
  const source = new EventSource("/api/events");

  source.onopen = () => handlers.onConnectionChange("live");
  source.onerror = () => handlers.onConnectionChange("offline");
  source.onmessage = (event) => {
    try {
      const parsed = safeParseServerMessage(JSON.parse(event.data));
      if (parsed.success) handlers.onMessage(parsed.data);
    } catch {
      // Ignore malformed SSE frames.
    }
  };

  return () => source.close();
}
