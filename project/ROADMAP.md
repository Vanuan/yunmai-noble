# Roadmap

Items are ordered by dependency, not priority.

## Decisions

- **System boundaries:** BLE (D-Bus/HCI), persistence (file/remote DB), and
  HTTP/HTML/API. Only adapters touch OS, database, or HTTP specifics. See
  [ARCHITECTURE.md](ARCHITECTURE.md).
- **Monorepo:** node, contract, historian, and UI live under `packages/`.
- **Persistence:** SQLite via `bun:sqlite`; revisit only if data volume grows.
- **WebSocket contract:** v1 is defined in
  [WEBSOCKET.md](WEBSOCKET.md) and `packages/contract`.
- **Local development:** Bun and Node run directly; Docker is only for
  Raspberry Pi deployment.
- **Deployment:** `run.sh` builds the image from the current `Dockerfile`. The
  image uses Node 22 and npm because Bun has no arm32 image.
- **BLE transport:** dual-driver support via `BLE_DRIVER`: `dbus` is the
  target default, `noble` remains a selectable legacy driver, and `simulator`
  stays for tests. See
  [BLE-TRANSPORT-MIGRATION.md](BLE-TRANSPORT-MIGRATION.md).
- **Deployment target:** Linux/NixOS with BlueZ on the host; containers mount
  the system D-Bus socket instead of using privileged networking.
- **Yunmai protocol:** notification packet types are implemented in
  `packages/node/src/yunmai/protocol.js`. Command frames are provisional
  simulator commands and are not required for history.

## Next steps

1. Scaffold `packages/historian` and `packages/ui` and wire them to the shared
   contract.
2. Emit the v1 WebSocket contract from the node per
   [WEBSOCKET.md](WEBSOCKET.md).
3. Validate the scaffolded D-Bus driver on NixOS with a real scale, then make
   it the default per
   [BLE-TRANSPORT-MIGRATION.md](BLE-TRANSPORT-MIGRATION.md), keeping `noble`
   selectable.
4. Move noble/HCI to optional dependencies and add the legacy noble image.
5. Add environment configuration for the node (`NODE_ID`, `HISTORIAN_URL`,
   device-name filter, UUIDs).
6. Validate packet signature, length, and checksum before parsing.
7. Replace `process.exit(0)` on disconnect with a scan-and-reconnect loop.
7. Implement the Weight historian per [HISTORIAN.md](HISTORIAN.md):
   persistence, HTTP JSON API, and served UI assets.
8. Build a minimal UI client (web or desktop) against the HTTP surface.
10. Add CI.

## Open questions

- Which UI client should be built first: web or desktop?
- Should the historian relay live measurements for remote clients, or should
  clients always connect to the node directly?
- How should devices be identified and registered when there is more than one
  node?
- Is API authentication needed for the historian, or is network isolation
  sufficient?
- Can arm32 deployment be dropped so the node itself runs on Bun, or must the
  Node fallback remain?
- Is a host D-Bus policy acceptable for non-root containers, or should the
  node container run as root?
