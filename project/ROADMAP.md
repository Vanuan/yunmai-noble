# Roadmap

## Decisions

- **Monorepo:** node, contract, historian, and UI under `packages/`; the
  desktop client under `apps/desktop` in a root Cargo workspace.
- **Boundaries:** BLE (D-Bus/HCI), persistence (SQLite via `bun:sqlite`), and
  HTTP/HTML/API. See [ARCHITECTURE.md](ARCHITECTURE.md).
- **Contract:** v1 in [WEBSOCKET.md](WEBSOCKET.md); emitted by the node.
- **BLE:** dual-driver via `BLE_DRIVER`: `dbus` default, `noble` optional
  legacy, `simulator` for tests.
- **Clients:** browser UI first (React + Vite + Tailwind, `packages/ui`), then
  a Rust/GPUI desktop app using `gpui-unofficial`. The dashboard and the virtual
  scale are separate web app entries (`/` and `/simulator/`), so demo controls
  stay out of the product surface. The desktop scaffold polls the HTTP API;
  SSE, a trend chart, and simulator controls are next.
- **Driver selection:** the desktop client is the control surface. It lists
  the suite drivers (simulator, D-Bus, node bindings), starts the selected one,
  stops the others, and remembers the choice in the user config. The simulator
  is a driver; the separate simulator package is only an optional parallel demo
  instance.
- **Simulator UI:** `apps/simulator` is a separate GPUI remote control for
  `/api/suite/simulator`. The main app launches it from Settings when the
  simulator driver is active. It does not plug into D-Bus; the suite owns the
  driver transport, so a future `dbus-sim` backend can reuse the same proxy.
- **Single executable:** `packages/suite` hosts the historian and UI in one Bun
  process and supervises one node child per driver on OS-assigned loopback
  ports. `/api/suite` starts and stops drivers at runtime, so simulated and
  real scales can feed one historian.
- **Multi-source:** the historian follows every configured upstream and keys
  measurements by the v1 `deviceId`.
- **Configuration:** `yunmai-noble.toml` with environment overrides, so the
  same file works for a desktop install and a container.
- **Local development:** Bun and Node run directly; Docker is only for Pi
  deployment.
- **Deployment:** `run.sh` builds the default D-Bus image, or the legacy noble
  image with `./run.sh noble`. Images use Node/npm because Bun has no arm32
  image. Ubuntu ships as two `dpkg-deb` packages built by
  `packaging/deb/build.sh`: `yunmai-noble` (service, bundled Bun, UI, desktop
  client) and `yunmai-noble-simulator` (same runtime, separate unit and
  database). Target artifacts: Pi/HA, Docker cloud with an edge agent, NixOS
  module; see [DEPLOYMENT.md](DEPLOYMENT.md).

## Next steps

1. Validate the default D-Bus driver with a real scale on Linux/NixOS.
2. Add remaining node configuration (`HISTORIAN_URL`, name filter, UUIDs).
3. Validate packet signatures and lengths; add the reconnect loop.
4. Finish the desktop client (`apps/desktop`): SSE, trend chart, and simulator
   controls.
5. Add the remaining deployment artifacts from [DEPLOYMENT.md](DEPLOYMENT.md):
   Pi/Home Assistant, NixOS module, cloud ingest, and historian auth.
6. Decide whether to package the native `noble` addon and HCI capabilities, or
   keep node bindings a development-only driver.
7. Prototype `dbus-sim`: the real `dbus` driver against a private mock BlueZ on
   a private bus. This gives CI end-to-end coverage without an adapter; see
   [DBUS_SIMULATOR.md](DBUS_SIMULATOR.md).
8. Add CI, including `arm64` package builds.

## Open questions

- Should the live relay be SSE only, or also WebSocket for commands?

- How should multiple nodes be identified and labelled in the UI?
- Is historian authentication needed, or is network isolation sufficient?
- Can arm32 be dropped so the node runs on Bun?
- Should the node container run as root for D-Bus access?
