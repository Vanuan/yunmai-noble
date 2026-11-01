# Roadmap

## Decisions

- **Monorepo:** node, contract, historian, and UI under `packages/`.
- **Boundaries:** BLE (D-Bus/HCI), persistence (SQLite via `bun:sqlite`), and
  HTTP/HTML/API. See [ARCHITECTURE.md](ARCHITECTURE.md).
- **Contract:** v1 in [WEBSOCKET.md](WEBSOCKET.md); the node still emits v0.
- **BLE:** dual-driver via `BLE_DRIVER`: `dbus` default, `noble` optional
  legacy, `simulator` for tests.
- **Local development:** Bun and Node run directly; Docker is only for Pi
  deployment.
- **Deployment:** `run.sh` builds the default D-Bus image, or the legacy noble
  image with `./run.sh noble`. Images use Node/npm because Bun has no arm32
  image.

## Next steps

1. Validate the default D-Bus driver with a real scale on Linux/NixOS.
2. Emit the v1 contract from the node.
3. Add node configuration (`NODE_ID`, `HISTORIAN_URL`, name filter, UUIDs).
4. Validate packet signatures and lengths; add the reconnect loop.
5. Scaffold `packages/historian`: SQLite store, ingest, HTTP JSON API, and
   served UI assets.
6. Build `packages/ui` against the HTTP surface.
7. Add CI.

## Open questions

- Build the first UI client for web or desktop?
- Should the historian relay live data, or should clients connect to the node?
- How should multiple nodes be identified?
- Is historian authentication needed, or is network isolation sufficient?
- Can arm32 be dropped so the node runs on Bun?
- Should the node container run as root for D-Bus access?
