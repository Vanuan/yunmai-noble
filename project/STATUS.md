# Project status

_Last updated: 2026-11-01_

## Summary

Bun workspace monorepo. The BLE node reads Yunmai scales through a selectable
link (`dbus` default, `noble` legacy, `simulator`) and broadcasts JSON over
WebSocket. The node runs on Node 22; Bun handles packages, tests, and
TypeScript. Docker is only for Raspberry Pi deployment.

The historian, persistence, and HTTP/HTML/API surface are not implemented. See
[ARCHITECTURE.md](ARCHITECTURE.md) and [ROADMAP.md](ROADMAP.md).

## Implemented

- `YUNMAI` discovery, service `ffe0`, characteristic `ffe4`, measuring and
  measured packet parsing, WebSocket broadcast on port `8080`.
- Simulator with command responses and interactive `bun run simulate`.
- `dbus` driver, now the default: name discovery, UUID expansion, GATT
  subscribe/write, and disconnect polling. Mocked tests only.
- Legacy `noble` driver is optional; a separate legacy Docker image keeps the
  native HCI path.
- WebSocket v1 zod schemas in `packages/contract`; the node still emits v0.
- 33 Bun tests and `tsc --noEmit`.
- `run.sh` builds the default D-Bus image, or the legacy noble image with
  `./run.sh noble`.

## Not implemented

- Persistence, historian, REST API, and UI client.
- v1 emission from the node.
- Reconnect loop, packet validation, and node configuration (`NODE_ID`, etc.).
- CI and linting.

## Known issues

- The default `dbus` driver has not been validated against a real scale.
- Bun cannot load the legacy noble link; noble runs on Node 22.
- Docker images use npm because Bun has no arm32 image.
- The default image needs host BlueZ/D-Bus and the mounted socket; host
  AppArmor/SELinux policy may also need to allow D-Bus. The legacy image needs
  privileged HCI access.
- `node-ble`/`dbus-next` report transitive npm audit findings.
- Disconnect calls `process.exit(0)`; the device-name filter and UUIDs are
  hardcoded.
- No CI or linter.

## Run

See the [README](../README.md#quick-start).
