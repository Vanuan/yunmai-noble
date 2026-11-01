# Roadmap

Items are ordered by dependency, not priority.

## Decisions

- **Monorepo:** node, contract, historian, and UI live under `packages/`.
- **Persistence:** SQLite via `bun:sqlite`; revisit only if data volume grows.
- **WebSocket contract:** v1 is defined in
  [WEBSOCKET.md](WEBSOCKET.md) and `packages/contract`.
- **Local development:** Bun and Node run directly; Docker is only for
  Raspberry Pi deployment.
- **Deployment:** `run.sh` builds the image from the current `Dockerfile`. The
  image uses Node 22 and npm because Bun has no arm32 image.
- **BLE runtime:** the real link stays on Node 22; Bun cannot load the native
  HCI addon.
- **Yunmai protocol:** notification packet types are implemented in
  `packages/node/src/yunmai/protocol.js`. Command frames are provisional
  simulator commands and are not required for history.

## Next steps

1. Scaffold `packages/historian` and `packages/ui` and wire them to the shared
   contract.
2. Emit the v1 WebSocket contract from the node per
   [WEBSOCKET.md](WEBSOCKET.md).
3. Add environment configuration for the node (`NODE_ID`, `HISTORIAN_URL`,
   device-name filter, UUIDs).
4. Validate packet signature, length, and checksum before parsing.
5. Replace `process.exit(0)` on disconnect with a scan-and-reconnect loop.
6. Implement the Weight historian per [HISTORIAN.md](HISTORIAN.md) (REST API +
   SQLite).
7. Build a minimal UI client (web or desktop).
8. Add CI.

## Open questions

- Which UI client should be built first: web or desktop?
- Should the historian relay live measurements for remote clients, or should
  clients always connect to the node directly?
- How should devices be identified and registered when there is more than one
  node?
- Is API authentication needed for the historian, or is network isolation
  sufficient?
