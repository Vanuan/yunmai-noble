import { test } from "bun:test";
import assert from "node:assert/strict";

import { startHistorian, type HistorianApp } from "../src/app";
import type { HistorianConfig } from "../src/config";
import { silentLogger } from "../src/logger";

function config(overrides: Partial<HistorianConfig> = {}): HistorianConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    databasePath: ":memory:",
    upstreamUrls: [],
    deviceId: "test-device",
    reconnectMinMs: 100,
    reconnectMaxMs: 1000,
    corsOrigin: "*",
    sseHeartbeatMs: 60000,
    ...overrides,
  };
}

async function withApp(
  fn: (app: HistorianApp, base: string) => Promise<void>
): Promise<void> {
  const app = startHistorian({
    config: config(),
    logger: silentLogger,
    ingest: null,
  });

  try {
    await fn(app, `http://127.0.0.1:${app.server.port}`);
  } finally {
    await app.close();
  }
}

test("reports health and serves the dashboard page", async () => {
  await withApp(async (_app, base) => {
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), {
      status: "ok",
      database: { ok: true },
      upstream: {
        configured: false,
        connected: false,
        lastMessageAt: null,
        lastError: null,
      },
      upstreams: [],
    });

    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type") ?? "", /text\/html/);
    assert.match(await page.text(), /yunmai-noble/);
  });
});

test("delegates suite control requests with CORS", async () => {
  const app = startHistorian({
    config: config(),
    logger: silentLogger,
    ingest: null,
    control(request, url) {
      if (url.pathname !== "/api/suite") return null;
      if (request.method !== "GET") {
        return new Response(null, { status: 405 });
      }
      return Response.json({ drivers: [] });
    },
  });

  try {
    const base = `http://127.0.0.1:${app.server.port}`;
    const response = await fetch(`${base}/api/suite`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
    assert.deepEqual(await response.json(), { drivers: [] });

    const rejected = await fetch(`${base}/api/suite`, { method: "POST" });
    assert.equal(rejected.status, 405);
    assert.equal(rejected.headers.get("access-control-allow-origin"), "*");
  } finally {
    await app.close();
  }
});

test("returns measurements with filters and a cursor", async () => {
  await withApp(async (app, base) => {
    app.store.insert({
      deviceId: "pi-scale-1",
      measuredAt: "2026-11-01T10:00:00.000Z",
      userId: 1,
      weightX100: 741,
      resistance: 0,
      fatPercentage: 0,
      historical: false,
      firmwareVersion: 1,
      receivedAt: "2026-11-01T10:00:01.000Z",
    });
    app.store.insert({
      deviceId: "pi-scale-1",
      measuredAt: "2026-11-01T11:00:00.000Z",
      userId: 2,
      weightX100: 750,
      resistance: 0,
      fatPercentage: 0,
      historical: false,
      firmwareVersion: 1,
      receivedAt: "2026-11-01T11:00:01.000Z",
    });

    const all = await fetch(`${base}/api/measurements`);
    assert.equal(all.status, 200);
    const body = (await all.json()) as {
      measurements: Array<{ weightKg: number; userId: number }>;
      next: string | null;
    };
    assert.equal(body.measurements.length, 2);
    assert.equal(body.measurements[0].weightKg, 7.5);
    assert.equal(body.next, null);

    const page = await fetch(`${base}/api/measurements?limit=1`);
    const pageBody = (await page.json()) as {
      measurements: unknown[];
      next: string | null;
    };
    assert.equal(pageBody.measurements.length, 1);
    assert.equal(pageBody.next, "2026-11-01T11:00:00.000Z");

    const missing = await fetch(`${base}/api/measurements/latest?userId=9`);
    assert.equal(missing.status, 404);

    const latest = await fetch(`${base}/api/measurements/latest`);
    assert.equal(latest.status, 200);
    assert.equal(((await latest.json()) as { weightKg: number }).weightKg, 7.5);

    const devices = await fetch(`${base}/api/devices`);
    assert.deepEqual(await devices.json(), {
      devices: [
        {
          id: "pi-scale-1",
          lastSeenAt: "2026-11-01T11:00:01.000Z",
          firmwareVersion: 1,
        },
      ],
    });
  });
});

test("rejects invalid query parameters", async () => {
  await withApp(async (_app, base) => {
    for (const path of [
      "/api/measurements?limit=0",
      "/api/measurements?from=yesterday",
      "/api/measurements/latest?userId=abc",
    ]) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 400, path);
      const body = (await response.json()) as {
        error: { code: string };
      };
      assert.equal(body.error.code, "invalid_query");
    }
  });
});

test("streams live messages over SSE", async () => {
  await withApp(async (app, base) => {
    const controller = new AbortController();
    const response = await fetch(`${base}/api/events`, {
      signal: controller.signal,
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);

    const reader = response.body?.getReader();
    assert.ok(reader, "SSE response has a body");
    const decoder = new TextDecoder();

    const initial = await reader.read();
    assert.match(decoder.decode(initial.value), /: connected/);

    app.sse.broadcast({
      v: 1,
      type: "measurement.completed",
      deviceId: "test-device",
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
    });

    const next = await reader.read();
    const frame = decoder.decode(next.value);
    assert.match(frame, /data: /);
    assert.match(frame, /measurement\.completed/);

    controller.abort();
    await reader.cancel().catch(() => {});
  });
});
