# Project status

_Last updated: 2026-11-01_

## Summary

Bun workspace monorepo. The BLE node reads Yunmai scales through a selectable
link (`dbus` default, `noble` legacy, `simulator`) and broadcasts JSON over
WebSocket. The node runs on Node 22; Bun handles packages, tests, and
TypeScript. Docker is only for Raspberry Pi deployment.

The historian is implemented with SQLite, WebSocket ingest, HTTP JSON APIs, and
an SSE relay. A React browser dashboard consumes the API and live relay. The
desktop client is still missing. See [ARCHITECTURE.md](ARCHITECTURE.md) and
[ROADMAP.md](ROADMAP.md).

## Implemented

- `YUNMAI` discovery, service `ffe0`, characteristic `ffe4`, measuring and
  measured packet parsing, WebSocket broadcast on port `8080`.
- Simulator with command responses and interactive `bun run simulate`.
- `dbus` driver, now the default: name discovery, UUID expansion, GATT
  subscribe/write, and disconnect polling. Mocked tests only.
- Legacy `noble` driver is optional; a separate legacy Docker image keeps the
  native HCI path.
- Node emits v1: `hello`, `status`, `measurement.measuring`,
  `measurement.completed`, and `error`, using `NODE_ID` as `deviceId`.
- `packages/historian`: SQLite store, v1/v0 ingest, `/health`,
  `/api/measurements`, `/api/measurements/latest`, `/api/devices`, `/api/events`
  (SSE), and static hosting for the built UI.
- `packages/ui`: React + Vite + Tailwind dashboard with live readings, trend
  chart, and history; `bun run ui` proxies to the historian.
- 57 Bun tests and `tsc --noEmit`.
- `run.sh` builds the default D-Bus image, or the legacy noble image with
  `./run.sh noble`.

## Not implemented

- Rust/GPUI desktop client.
- Reconnect loop, packet validation, and remaining node configuration
  (`HISTORIAN_URL`, name filter, UUIDs).
- Cloud ingest, historian auth, and deployment packaging.
- CI and linting.

## Known issues

- The default `dbus` driver has not been validated against a real scale.
- Bun cannot load the legacy noble link; noble runs on Node 22.
- Docker images use npm because Bun has no arm32 image.
- The default image needs host BlueZ/D-Bus and the mounted socket; host
  AppArmor/SELinux policy may also need to allow D-Bus. The legacy image needs
  privileged HCI access.
- `node-ble`/`dbus-next` report transitive npm audit findings.
- The historian keeps a v0 adapter for older nodes; the fallback status page
  remains for installations without a built UI.
- SQLite is single-instance; cloud deployment will need Postgres.
- Disconnect calls `process.exit(0)`; the device-name filter and UUIDs are
  hardcoded.
- No CI or linter.

## Run

See the [README](../README.md#quick-start).
