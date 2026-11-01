import { test } from "bun:test";
import assert from "node:assert/strict";

import { loadConfig } from "../src/config";

test("uses defaults when environment is empty", () => {
  assert.deepEqual(loadConfig({}), {
    host: "0.0.0.0",
    port: 3000,
    databasePath: "/data/historian.sqlite",
    upstreamUrls: [],
    deviceId: "yunmai-noble",
    reconnectMinMs: 1000,
    reconnectMaxMs: 30000,
    corsOrigin: "*",
    sseHeartbeatMs: 15000,
  });
});

test("parses environment values", () => {
  const config = loadConfig({
    HISTORIAN_HOST: "127.0.0.1",
    HISTORIAN_PORT: "4000",
    DATABASE_PATH: ":memory:",
    YUNMAI_WS_URL: "ws://127.0.0.1:8080",
    YUNMAI_DEVICE_ID: "living-room",
    RECONNECT_MIN_MS: "100",
    RECONNECT_MAX_MS: "2000",
    CORS_ORIGIN: "http://localhost:5173",
    SSE_HEARTBEAT_MS: "5000",
  });

  assert.equal(config.port, 4000);
  assert.deepEqual(config.upstreamUrls, ["ws://127.0.0.1:8080"]);
  assert.equal(config.deviceId, "living-room");
  assert.equal(config.reconnectMinMs, 100);
  assert.equal(config.reconnectMaxMs, 2000);
  assert.equal(config.corsOrigin, "http://localhost:5173");
  assert.equal(config.sseHeartbeatMs, 5000);
});

test("parses multiple upstreams and removes duplicates", () => {
  const config = loadConfig({
    YUNMAI_WS_URL: "ws://127.0.0.1:8080",
    YUNMAI_WS_URLS: " ws://127.0.0.1:8081 , ws://127.0.0.1:8080 ,, ",
  });

  assert.deepEqual(config.upstreamUrls, [
    "ws://127.0.0.1:8080",
    "ws://127.0.0.1:8081",
  ]);
});

test("treats blank upstream URLs as disabled", () => {
  assert.deepEqual(loadConfig({ YUNMAI_WS_URL: "  " }).upstreamUrls, []);
});

test("rejects invalid upstream URLs and backoff bounds", () => {
  assert.throws(
    () => loadConfig({ YUNMAI_WS_URL: "http://example.com" }),
    /YUNMAI_WS_URL/
  );
  assert.throws(
    () => loadConfig({ YUNMAI_WS_URLS: "ws://ok.example, http://example.com" }),
    /YUNMAI_WS_URL/
  );
  assert.throws(
    () =>
      loadConfig({
        RECONNECT_MIN_MS: "1000",
        RECONNECT_MAX_MS: "500",
      }),
    /RECONNECT_MAX_MS/
  );
});
