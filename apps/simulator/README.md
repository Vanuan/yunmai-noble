# Yunmai Noble simulator UI

A standalone GPUI control surface for the virtual scale. It uses the shared
physical platform from `crates/ui-kit` (also shown by the main dashboard) and
drives the **simulator driver** through the suite's existing control API:

- `GET /api/suite/simulator`
- `POST /api/suite/simulator/{power,start,stop,weight,user,unit,history}`
- `POST /api/suite/drivers/simulator/start`

It never talks to D-Bus, BlueZ, SQLite, or the node directly. The suite owns the
driver and transport; this app is a thin remote control. That means the same UI
will also work with a future `dbus-sim` backend, because the suite exposes the
same `/api/suite/simulator` proxy for whichever simulated driver is active.

## Run

```sh
cargo run -p yunmai-noble-simulator-ui
# or
bun run simulator-ui

# another historian
cargo run -p yunmai-noble-simulator-ui -- --historian http://pi.local:3000
```

The main desktop app opens it from **Settings → Open simulator** when the
Simulator driver is selected. `bun run desktop` builds this binary before
starting the main app. `YUNMAI_SIMULATOR_UI` overrides the binary path used by
the launcher.

## Behavior

- Polls the simulator state every second.
- Power on/off, weight ±0.5 of the displayed unit, user ±1, unit kg/lb.
- The unit toggle is display-only: weights are sent to the API in kilograms,
  matching the wire protocol, which has no unit field. The display converts
  at render time.
- Tap the platform to power on or start a weighing.
- Step off and replay history.
- Starts the simulator driver from the dialog if it is stopped.
- Uses the same suite control API as the web app at `/simulator/`.
