import { test } from "bun:test";
import assert from "node:assert/strict";
import { WebSocketServer } from "ws";

import { IngestClient, aggregateStatus } from "../src/ingest";
import { silentLogger } from "../src/logger";
import type { SseHub } from "../src/sse";
import { SqliteStore } from "../src/store";

const NOW = new Date("2026-11-01T10:00:02.000Z");

function waitFor(predicate: () => boolean, timeoutMs = 1500): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    (function poll() {
      if (predicate()) return resolve();
      if (Date.now() - startedAt > timeoutMs) {
        return reject(new Error("Timed out waiting for condition"));
      }
      setTimeout(poll, 5);
    })();
  });
}

function fakeSse(): { sse: SseHub; messages: unknown[] } {
  const messages: unknown[] = [];
  return {
    sse: {
      subscribe() {
        return new ReadableStream<Uint8Array>();
      },
      broadcast(message: unknown) {
        messages.push(message);
      },
      close() {},
      clientCount() {
        return 0;
      },
    },
    messages,
  };
}

test("aggregates multiple upstream statuses", () => {
  assert.deepEqual(aggregateStatus([]), {
    configured: false,
    connected: false,
    lastMessageAt: null,
    lastError: null,
  });

  assert.deepEqual(
    aggregateStatus([
      {
        id: "simulator",
        url: "ws://127.0.0.1:8081",
        status: {
          configured: true,
          connected: true,
          lastMessageAt: "2026-11-01T10:00:01.000Z",
          lastError: null,
        },
      },
      {
        id: "dbus",
        url: "ws://127.0.0.1:8080",
        status: {
          configured: true,
          connected: false,
          lastMessageAt: "2026-11-01T10:00:02.000Z",
          lastError: "connection failed",
        },
      },
    ]),
    {
      configured: true,
      connected: false,
      lastMessageAt: "2026-11-01T10:00:02.000Z",
      lastError: "connection failed",
    }
  );
});

test("ingests v1 and legacy v0 measurements", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => server.once("listening", resolve));

  const address = server.address();
  const port =
    address && typeof address === "object" ? address.port : 0;

  const store = new SqliteStore(":memory:");
  const { sse, messages } = fakeSse();
  const legacyDate = Math.floor(
    Date.parse("2026-11-01T09:00:00.000Z") / 1000
  );

  server.on("connection", (socket) => {
    socket.send(
      JSON.stringify({
        v: 1,
        type: "measurement.completed",
        deviceId: "v1-device",
        sentAt: "2026-11-01T10:00:01.000Z",
        payload: {
          measuredAt: "2026-11-01T10:00:00.000Z",
          userId: 1,
          weight: 741,
          resistance: 0,
          fatPercentage: 0,
          historical: false,
          firmwareVersion: 1,
        },
      })
    );
    socket.send(
      JSON.stringify({
        firmwareVersion: 1,
        packetType: "measured",
        data: {
          historicalInfo: 1,
          date: legacyDate,
          userId: 2,
          weight: 750,
          resistance: 0,
          fatPercentage: 0,
        },
      })
    );
    socket.send(JSON.stringify({ invalid: true }));
    socket.send(
      JSON.stringify({
        v: 1,
        type: "status",
        deviceId: "v1-device",
        sentAt: "2026-11-01T10:00:01.000Z",
        payload: {
          bluetooth: "poweredOn",
          scanning: false,
          connected: true,
          peripheralName: "YUNMAI-SIM",
        },
      })
    );
  });

  const ingest = new IngestClient({
    url: `ws://127.0.0.1:${port}`,
    store,
    sse,
    deviceId: "legacy-device",
    reconnectMinMs: 50,
    reconnectMaxMs: 100,
    logger: silentLogger,
    now: () => NOW,
  });

  try {
    await waitFor(() => store.list({ limit: 10 }).length === 2);

    const rows = store.list({ limit: 10 });
    const v1 = rows.find((row) => row.deviceId === "v1-device");
    const legacy = rows.find((row) => row.deviceId === "legacy-device");

    assert.ok(v1);
    assert.equal(v1.weightX100, 741);
    assert.equal(v1.userId, 1);
    assert.equal(v1.historical, false);

    assert.ok(legacy);
    assert.equal(legacy.weightX100, 750);
    assert.equal(legacy.userId, 2);
    assert.equal(legacy.historical, true);
    assert.equal(
      legacy.scaleDate,
      Math.floor(Date.parse("2026-11-01T09:00:00.000Z") / 1000)
    );

    assert.equal(messages.length, 3);
    assert.equal(ingest.status().connected, true);
    assert.equal(ingest.status().lastMessageAt, NOW.toISOString());
    assert.equal(
      store.devices().find((device) => device.id === "v1-device")?.model,
      "YUNMAI-SIM"
    );
  } finally {
    ingest.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  }
});
