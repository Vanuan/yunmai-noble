# Roadmap

## Decisions

- **Monorepo:** node, contract, historian, and UI under `packages/`.
- **Boundaries:** BLE (D-Bus/HCI), persistence (SQLite via `bun:sqlite`), and
  HTTP/HTML/API. See [ARCHITECTURE.md](ARCHITECTURE.md).
- **Contract:** v1 in [WEBSOCKET.md](WEBSOCKET.md); emitted by the node.
- **BLE:** dual-driver via `BLE_DRIVER`: `dbus` default, `noble` optional
  legacy, `simulator` for tests.
- **Clients:** browser UI first (React + Vite + Tailwind, `packages/ui`), then
  a Rust/GPUI desktop app. The dashboard and the virtual scale are separate web
  app entries (`/` and `/simulator/`), so demo controls stay out of the product
  surface. The view model stays framework-neutral where easy, but the web
  client is the UX reference rather than a strict abstraction.
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
  image. Target artifacts: Pi/HA, Docker cloud with an edge agent, NixOS
  module, Ubuntu `.deb`; see [DEPLOYMENT.md](DEPLOYMENT.md).

## Next steps

1. Validate the default D-Bus driver with a real scale on Linux/NixOS.
2. Add remaining node configuration (`HISTORIAN_URL`, name filter, UUIDs).
3. Validate packet signatures and lengths; add the reconnect loop.
4. Port the browser dashboard to Rust/GPUI (`apps/desktop`) and package
   `packages/suite` as the desktop sidecar or single binary.
5. Add deployment artifacts from [DEPLOYMENT.md](DEPLOYMENT.md): Pi/Home
   Assistant, NixOS module, Ubuntu service + desktop `.deb`, cloud ingest, and
   historian auth.
6. Add CI.

## Open questions

- Should the live relay be SSE only, or also WebSocket for commands?
- Is GPUI ready for Ubuntu/Wayland, or should the desktop client use
  Tauri/egui?
- Should the single executable embed the node scripts, or ship them alongside
  a Bun runtime?
- How should multiple nodes be identified and labelled in the UI?
- Is historian authentication needed, or is network isolation sufficient?
- Can arm32 be dropped so the node runs on Bun?
- Should the node container run as root for D-Bus access?
