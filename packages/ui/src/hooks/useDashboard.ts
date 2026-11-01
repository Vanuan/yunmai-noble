import { useEffect, useRef, useState } from "react";
import type { ServerMessage } from "@yunmai-noble/contract";

import {
  fetchHealth,
  fetchLatest,
  fetchMeasurements,
  subscribeLive,
  type DeviceStatus,
  type Health,
  type LiveConnection,
  type Measurement,
} from "../api";
import { mergeMeasurement } from "../lib/format";

export interface LiveWeight {
  weightKg: number;
  measuredAt: string;
}

export interface DashboardState {
  measurements: Measurement[];
  latest: Measurement | null;
  health: Health | null;
  live: LiveWeight | null;
  deviceStatus: DeviceStatus | null;
  connection: LiveConnection;
  error: string | null;
  loading: boolean;
}

function messageToMeasurement(message: ServerMessage, id: number): Measurement {
  if (message.type !== "measurement.completed") {
    throw new Error("Expected a completed measurement");
  }

  return {
    id,
    deviceId: message.deviceId,
    scaleDate: message.payload.measuredAt,
    receivedAt: message.sentAt,
    userId: message.payload.userId,
    weightKg: message.payload.weight / 100,
    resistance: message.payload.resistance,
    fatPercentage: message.payload.fatPercentage,
    historical: message.payload.historical,
    firmwareVersion: message.payload.firmwareVersion,
  };
}

export function useDashboard(): DashboardState {
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [latest, setLatest] = useState<Measurement | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [live, setLive] = useState<LiveWeight | null>(null);
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus | null>(null);
  const [connection, setConnection] = useState<LiveConnection>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const temporaryId = useRef(-1);

  useEffect(() => {
    let active = true;

    Promise.all([fetchMeasurements(100), fetchLatest(), fetchHealth()])
      .then(([history, current, serviceHealth]) => {
        if (!active) return;
        setMeasurements(history);
        setLatest(current);
        setHealth(serviceHealth);
        setError(null);
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setLoading(false);
      });

    const unsubscribe = subscribeLive({
      onConnectionChange: (state) => {
        if (!active) return;
        setConnection(state);
        if (state === "live") setError(null);
      },
      onMessage: (message) => {
        if (!active) return;

        if (message.type === "measurement.measuring") {
          setLive({
            weightKg: message.payload.weight / 100,
            measuredAt: message.payload.measuredAt,
          });
          return;
        }

        if (message.type === "measurement.completed") {
          const measurement = messageToMeasurement(message, temporaryId.current);
          temporaryId.current -= 1;
          setLatest(measurement);
          setMeasurements((current) => mergeMeasurement(current, measurement));
          setLive(null);
          return;
        }

        if (message.type === "status") {
          setDeviceStatus(message.payload);
          return;
        }

        if (message.type === "error") {
          setError(message.payload.message);
        }
      },
    });

    const healthTimer = setInterval(() => {
      fetchHealth()
        .then((next) => {
          if (active) setHealth(next);
        })
        .catch(() => {});
    }, 15000);

    return () => {
      active = false;
      unsubscribe();
      clearInterval(healthTimer);
    };
  }, []);

  return {
    measurements,
    latest,
    health,
    live,
    deviceStatus,
    connection,
    error,
    loading,
  };
}
