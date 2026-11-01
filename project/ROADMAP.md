# Roadmap

Items are ordered by dependency, not priority.

## Next steps

1. Decide whether the Web UI and Weight historian live in this repository.
2. Define the WebSocket message contract (envelope, types, timestamps).
3. Add environment-based configuration for the node (`HISTORIAN_URL`,
   device-name filter, UUIDs).
4. Validate packet signature, length, and checksum before parsing.
5. Replace `process.exit(0)` on disconnect with a scan-and-reconnect loop.
6. Align simulator command frames with the real Yunmai protocol.
7. Scaffold the Weight historian (REST API + store) and a minimal Web UI.
8. Add CI.

## Open questions

- Should the historian and database live in this repository or in a separate
  deployment?

- What persistence should back the historian (SQLite, Postgres, cloud service)?
- What is the real Yunmai command protocol (packet types, payloads, checksum)?
- Should `run.sh` build from the current `Dockerfile` instead of pulling a
  fixed image tag?
