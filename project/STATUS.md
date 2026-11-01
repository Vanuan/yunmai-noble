# Project status

_Last updated: 2026-11-01_

## Summary

`yunmai-noble` is a Bun workspace monorepo. Its BLE node reads Yunmai
Bluetooth LE scale measurements using `@abandonware/noble` and broadcasts them
as JSON over WebSocket. The node runs on Node 22; Bun is the package manager,
test runner, and TypeScript toolchain. Docker is only used for Raspberry Pi
deployment.

A UI client, the Weight historian, and the database from the
[idea diagram](../README.md#idea) are not implemented. This repository
currently contains the BLE node, an in-process scale simulator, and the
historian design. Planned work is tracked in [ROADMAP.md](ROADMAP.md).

## Layout

| Path | Purpose |
| --- | --- |
| `packages/node/` | BLE node: entry point, link, simulator, protocol, tests |
| `packages/contract/` | WebSocket v1 zod schemas and TypeScript types |
| `packages/historian/`, `packages/ui/` | Planned packages |
| `package.json`, `bun.lock`, `package-lock.json` | Workspace manifests and lockfiles |
| `tsconfig.json` | Strict TypeScript configuration |
| `.nvmrc` | Pins Node 22 for `nvm use` |
| `Dockerfile`, `run.sh` | Deployable Node 22 image for the Pi |
| `README.md`, `project/` | Documentation |

## What works

- Scans for a peripheral whose name contains `YUNMAI`, connects, and subscribes
  to characteristic `ffe4` on service `ffe0`.
- Parses measuring and measured packets, logs readings, and broadcasts them to
  WebSocket clients on port `8080`.
- Runs on Node 22 locally; `run.sh` builds the deployment image on the Pi.
- Runs without BLE hardware with `BLE_DRIVER=simulator`; the simulator
  advertises `YUNMAI-SIM`, emits measuring and measured packets, and responds
  to commands on `ffe4`.
- `bun run simulate` drives the simulator interactively.
- `bun test` runs 25 tests under Bun, including an end-to-end check that the
  app streams simulated weights over WebSocket.
- `bun run typecheck` checks the TypeScript contract with `tsc --noEmit`.
- `packages/contract/src/websocket.ts` defines the versioned WebSocket v1
  contract in zod; the format is specified in [WEBSOCKET.md](WEBSOCKET.md).

## Known issues

- Packet signature, length, and checksum are parsed but not validated.
- Simulator command types and the acknowledgement bit are provisional.
- The simulator's checksum is a simple byte sum; real semantics are unknown.
- The simulator is in-process, not a virtual BLE peripheral.
- Disconnect calls `process.exit(0)`; recovery relies on Docker restart policy.
- The device-name filter and UUIDs are hardcoded; the WebSocket port is set via
  `WS_PORT`.
- Bun cannot load the native BLE transport; the real link still runs on
  Node 22. A pure-JS BlueZ D-Bus migration is planned in
  [BLE-TRANSPORT-MIGRATION.md](BLE-TRANSPORT-MIGRATION.md).
- The deployment image uses npm instead of Bun because Bun publishes no arm32
  image.
- The node still emits the unversioned v0 WebSocket format; v1 migration is
  pending.
- No CI or linter.

## Gaps against the idea diagram

| Component | Status |
| --- | --- |
| yunmai scales | Hardware or simulator |
| Bluetooth link | Implemented with noble; D-Bus migration planned |
| yunmai-noble node | Partial |
| Web socket | v1 contract defined; v0 still emitted |
| UI client (web, desktop, ...) | Missing |
| RESTful API | Designed |
| Weight historian | Designed, not implemented |
| Database | Designed (SQLite), not implemented |

## How to run

- Requirements: Node 22 (`.nvmrc`) and Bun 1.3+.
- Install: `bun install`.
- Real BLE: `bun run start` (runs Node 22).
- Without BLE: `BLE_DRIVER=simulator bun run dev`.
- Interactive simulator: `bun run simulate`.
- Tests: `bun test`.
- Type checking: `bun run typecheck`.
- Raspberry Pi: `./run.sh` builds the Docker image and starts the container.
- WebSocket endpoint: `ws://localhost:8080`.
