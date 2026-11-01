# Project status

_Last updated: 2026-11-01_

## Summary

`yunmai-noble` is a Node.js service that reads Yunmai Bluetooth LE scale
measurements using `@abandonware/noble` and broadcasts them as JSON over
WebSocket. It runs on Node 22 in Docker on a Raspberry Pi near the scale; Bun
is the package manager, test runner, and TypeScript toolchain.

The Web UI, Weight historian, and database from the
[idea diagram](../README.md#idea) are not implemented. This repository
currently contains the BLE node and an in-process scale simulator. Planned work
is tracked in [ROADMAP.md](ROADMAP.md).

## Layout

| Path | Purpose |
| --- | --- |
| `ble.js` | Entry point: Bluetooth link and WebSocket broadcaster |
| `src/bluetooth/` | Link factory for `noble` or the simulator |
| `src/bluetooth/simulator/` | Simulated scale: link, GATT emulation, packet builders |
| `src/yunmai/protocol.js` | Measuring and measured packet parsers |
| `src/contract/websocket.ts` | WebSocket v1 zod schemas and TypeScript types |
| `bin/simulate.js` | Interactive simulator harness |
| `test/` | Protocol, link, simulator, contract, and end-to-end WebSocket tests |
| `package.json` | Dependencies and `start`, `dev`, `simulate`, `test`, `typecheck` scripts |
| `tsconfig.json` | Strict TypeScript configuration |
| `.nvmrc` | Pins Node 22 for `nvm use` |
| `bun.lock` | Bun lockfile |
| `Dockerfile`, `x86/Dockerfile`, `docker-compose.yml`, `run.sh` | Build and deployment |
| `README.md`, `project/` | Documentation |

## What works

- Scans for a peripheral whose name contains `YUNMAI`, connects, and subscribes
  to characteristic `ffe4` on service `ffe0`.
- Parses measuring and measured packets, logs readings, and broadcasts them to
  WebSocket clients on port `8080`.
- Runs in Docker with host networking and a bind-mounted source tree.
- Runs without BLE hardware with `BLE_DRIVER=simulator`; the simulator
  advertises `YUNMAI-SIM`, emits measuring and measured packets, and responds
  to commands on `ffe4`.
- `bun run simulate` drives the simulator interactively.
- `bun test` runs 25 tests under Bun, including an end-to-end check that the
  app streams simulated weights over WebSocket.
- `bun run typecheck` checks the TypeScript contract with `tsc --noEmit`.
- `src/contract/websocket.ts` defines the versioned WebSocket v1 contract in
  zod; the format is specified in [WEBSOCKET.md](WEBSOCKET.md).

## Known issues

- Packet signature, length, and checksum are parsed but not validated.
- Simulator command types and the acknowledgement bit are provisional.
- The simulator's checksum is a simple byte sum; real semantics are unknown.
- The simulator is in-process, not a virtual BLE peripheral.
- Disconnect calls `process.exit(0)`; recovery relies on Docker restart policy.
- The device-name filter and UUIDs are hardcoded; the WebSocket port is set via
  `WS_PORT`.
- `Dockerfile` is dev-only; `run.sh` pulls a prebuilt image.
- `x86/Dockerfile` duplicates the root `Dockerfile`.
- Bun cannot load the native BLE transport; the real link must run on Node 22.
- The node still emits the unversioned v0 WebSocket format; v1 migration is
  pending.
- No CI or linter.

## Gaps against the idea diagram

| Component | Status |
| --- | --- |
| yunmai scales | Hardware or simulator |
| Bluetooth link | Implemented |
| yunmai-noble node | Partial |
| Web socket | v1 contract defined; v0 still emitted |
| Web UI | Missing |
| RESTful API | Missing |
| Weight historian | Missing |
| Database | Missing |

## How to run

- Requirements: Node 22 (`.nvmrc`) and Bun 1.3+.
- Install: `bun install`.
- With BLE: `docker-compose up --build`.
- Without BLE: `BLE_DRIVER=simulator bun run dev`.
- Interactive simulator: `bun run simulate`.
- Tests: `bun test`.
- Type checking: `bun run typecheck`.
- Raspberry Pi: `run.sh` (pulls `vanuan/yunmai-noble-arm32`).
- WebSocket endpoint: `ws://localhost:8080`.
