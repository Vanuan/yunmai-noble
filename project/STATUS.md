# Project status

_Last updated: 2026-11-01_

## Summary

Bun workspace monorepo. The BLE node reads Yunmai scales through a selectable
link (`dbus` default, `noble` legacy, `simulator`) and broadcasts JSON over
WebSocket. `packages/suite` is the single executable: it hosts the historian and
web UI in one Bun process, supervises one node child per driver, and starts or
stops drivers at runtime. The node runs on Node 22; Bun handles the rest. Docker
is only for Raspberry Pi deployment.

The historian is implemented with SQLite, WebSocket ingest from one or more
nodes, HTTP JSON APIs, and an SSE relay. A React browser dashboard consumes the
API and live relay. A Rust/GPUI desktop client ships with the service in the
Ubuntu `.deb` packages. See [ARCHITECTURE.md](ARCHITECTURE.md) and
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
- `packages/suite`: single executable that hosts the historian and UI, starts
  one node child per driver on OS-assigned loopback ports, restarts crashed
  drivers, and exposes `GET /api/suite` plus
  `POST /api/suite/drivers/{driver}/{start,stop}`. Children exit when the
  suite's stdin closes, so crashes do not leave ports held.
- `yunmai-noble.toml` configuration with `--config` / `YUNMAI_CONFIG` and
  environment-variable overrides.
- Multi-source ingest: the historian follows every configured upstream and
  reports `upstream` plus per-source `upstreams` in `/health`.
- `packages/ui`: React + Vite + Tailwind dashboard at `/` with live readings,
  trend chart, and history.
- Simulator app at `/simulator/`: a separate entry point styled as the real
  scale platform (concealed display, electrodes, central disc) with power,
  weight, user, step-on, step-off, and history replay; the node exposes a
  loopback control server and the suite proxies it at `/api/suite/simulator`.
- `lab.toml`: hardware-free simulator profile on loopback (`bun run lab`).
- `apps/desktop`: Rust/GPUI client using `gpui-unofficial`. It polls the
  historian and shows latest weight, service/upstream status, and history. A
  Settings dialog selects the active suite driver (simulator, D-Bus, or node
  bindings), stops the others, and remembers the choice in the user config.
- `apps/simulator`: standalone GPUI virtual-scale control app. It uses
  `/api/suite/simulator` (power, weight, user, unit, step on/off, history) and
  is launched from Settings when the simulator driver is active. It never talks
  to D-Bus directly; the suite owns the transport.
- `crates/ui-kit`: shared physical-scale platform. The dashboard shows the
  latest reading on it; the simulator makes it clickable. Both native clients
  share the same light palette and card treatment. It
  has client-side chrome (close, drag, resize) and a startup preflight that can
  start a packaged system unit or the dev suite; `YUNMAI_SERVICE` selects the
  unit.
- Debian packaging: `packaging/deb/build.sh` stages a clean runtime with a
  bundled Bun, builds the desktop client, and produces `yunmai-noble` and
  `yunmai-noble-simulator` with systemd units, conffiles, and desktop entries.
  The simulator shares the runtime and runs on port 3100 with its own database.
- 152 Bun tests, 16 Rust tests, and `tsc --noEmit`.
- `run.sh` builds the default D-Bus image, or the legacy noble image with
  `./run.sh noble`.

## Not implemented

- SSE live readings and trend chart in the desktop client.
- Packaging the native `noble` addon and HCI capabilities for the node-bindings
  driver; the default `.deb` omits them.
- `dbus-sim`: the real `dbus` driver against a private mock BlueZ. Design in
  [DBUS_SIMULATOR.md](DBUS_SIMULATOR.md).
- Publishing packages to a repository and building `arm64` in CI.
- Reconnect loop and packet validation in the node; the suite restarts exited
  drivers but does not resume a BLE session.
- Remaining node configuration (`HISTORIAN_URL`, name filter, UUIDs).
- Cloud ingest and historian auth.
- CI and linting.

## Known issues

- The default `dbus` driver has not been validated against a real scale.
- Bun cannot load the legacy noble link; the suite runs `noble` under Node 22.
  Packages ship the node scripts with a bundled Bun runtime rather than a
  single compiled executable.
- Docker images use npm because Bun has no arm32 image.
- The default image needs host BlueZ/D-Bus and the mounted socket; host
  AppArmor/SELinux policy may also need to allow D-Bus. The legacy image needs
  privileged HCI access.
- `node-ble`/`dbus-next` report transitive npm audit findings.
- The historian keeps a v0 adapter for older nodes; the fallback status page
  remains for installations without a built UI.
- The desktop client polls every 2 s; SSE is next. It needs Wayland/X11, Vulkan,
  and fontconfig.
- GPUI is pre-1.0 and consumed through the unofficial crates.io build, so minor
  API churn is expected.
- SQLite is single-instance; cloud deployment will need Postgres.
- Disconnect calls `process.exit(0)`; the device-name filter and UUIDs are
  hardcoded.
- No CI or linter.

## Run

See the [README](../README.md#quick-start).
