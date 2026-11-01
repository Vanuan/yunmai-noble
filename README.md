# yunmai-noble

Yunmai scales BLE node, simulator, weight historian, web dashboard, and a
single-executable suite that runs them together.


## Quick start

Requires Node 22 (`.nvmrc`) and Bun 1.3+. The desktop client additionally needs
Rust stable.

```sh
bun install
bun test
bun run typecheck
```

## Run the whole suite

`bun run suite` is the single executable. It hosts the historian and web UI in
one Bun process, then starts one node child process per scale driver. Every
driver speaks the same v1 WebSocket contract, so the historian can follow any
combination of them at once.

```sh
bun run lab                                # lab.toml: simulator only
bun run suite                              # dbus driver, UI at :3000
bun run suite --config ./lab.toml          # explicit config file
SUITE_SCALES=simulator bun run suite       # environment override
SUITE_SCALES=dbus,simulator bun run suite  # real scale and simulation together
```

`lab.toml` is committed for hardware-free development: loopback bind,
simulator only, and no auto-start or repeat, so each weighing starts from the
simulator console. Open `http://127.0.0.1:3000/` for the dashboard and
`http://127.0.0.1:3000/simulator/` for the virtual scale.

## Configuration

The suite reads `yunmai-noble.toml` from the working directory, then
`$XDG_CONFIG_HOME/yunmai-noble/config.toml` (default
`~/.config/yunmai-noble/config.toml`). `--config <path>` or `YUNMAI_CONFIG`
selects another file. Copy [yunmai-noble.example.toml](yunmai-noble.example.toml)
to get started; relative paths resolve from the working directory.

```toml
[historian]
port = 3000
database_path = "./data/historian.sqlite"

[drivers]
initial = ["dbus", "simulator"]
node_id_prefix = "scale"
restart_ms = 2000

[simulator]
weight_kg = 7.5
```

Environment variables override the file, which keeps containers and systemd
units simple: `HISTORIAN_PORT`, `HISTORIAN_HOST`, `DATABASE_PATH`,
`SUITE_SCALES`, `SUITE_NODE_ID_PREFIX`, `SUITE_DRIVER_RESTART_MS`, and
`SIMULATOR_*`. The example file lists every supported key. Standalone
`bun run historian` and `bun run dev` remain driven by environment variables
only.

### Runtime driver switching

Drivers can be started and stopped without restarting the suite, so the
simulator can feed the dashboard next to real hardware:

```sh
curl http://127.0.0.1:3000/api/suite
curl -X POST http://127.0.0.1:3000/api/suite/drivers/simulator/start
curl -X POST http://127.0.0.1:3000/api/suite/drivers/dbus/stop
```

`GET /api/suite` returns each driver's state (`stopped`, `running`,
`restarting`, ...), pid, current loopback URLs, device id, restart count, and
upstream status. A crashed driver restarts after `drivers.restart_ms` unless
stopped. Driver ports are chosen by the OS on every start, so a stale process
or another service cannot pin them; restarts pick fresh ports.

Driver children exit when the suite closes their stdin, so a crashed or killed
suite does not leave processes holding ports.

Drivers are child processes so they stay isolated and can use different
runtimes: `dbus` and `simulator` run under Bun, `noble` under Node 22. The
historian and UI stay in the single Bun process. A desktop distribution can
embed the same supervisor, or ship the suite as its sidecar.

The components can still run individually while developing: `bun run dev`
(node only), `bun run historian`, `bun run ui`, and `bun run build:ui`. The
suite builds `packages/ui/dist` on first run; rebuild it with
`bun run build:ui` after UI changes.

## Simulator

`SUITE_SCALES=simulator` (or `[drivers] initial = ["simulator"]`) runs a scale
below the GATT layer inside the node child. It repeats a weighing every few
seconds and accepts the same commands as the hardware. Tune it under
`[simulator]` in the config file, or with `SIMULATOR_WEIGHT_KG`,
`SIMULATOR_STEPS`, `SIMULATOR_INTERVAL_MS`, `SIMULATOR_CYCLE_DELAY_MS`,
`SIMULATOR_AUTO_START`, and `SIMULATOR_REPEAT`.

`bun run simulate` is a separate interactive REPL that speaks the scale side of
the protocol: `start`, `stop`, `history`, `unit kg|lb`, `user <id>`. It is for
inspecting packets and acks, not for feeding the node.

The desktop client can start the simulator driver from its Settings dialog,
so a separate service is not needed for normal use. When the Simulator driver
is active, **Settings → Open simulator** launches the standalone GPUI simulator
control app (`apps/simulator`). The virtual scale also has its own page at
`/simulator/`, separate from the dashboard: power switch, weight and user
fields, Step on / Step off, and Replay history. The same controls are available
as JSON:

```sh
GET  /api/suite/simulator
POST /api/suite/simulator/{start,stop,power,weight,user,history}
```

## Web UI

The historian serves two React + Vite + Tailwind entries from `packages/ui`:

- `/` dashboard: history from the HTTP API and live updates over SSE.
- `/simulator/` virtual scale: controls the simulator driver, with a live
  weight display.

Both are built into `packages/ui/dist`. See
[packages/ui/README.md](packages/ui/README.md) for development and GPUI
portability notes.

## Desktop

`apps/desktop` is a native Rust client built with
[`gpui-unofficial`](https://crates.io/crates/gpui-unofficial), the published
build of Zed's GPUI. It polls the historian for the latest reading, status,
and history, and selects the active Bluetooth driver from the suite in its
Settings dialog: simulator, D-Bus, or node bindings (`noble`). The latest
reading is shown on the same virtual scale platform used by the simulator app,
so the dashboard mirrors what the user stepped on. When the simulator is
active, the dialog also launches the separate GPUI virtual-scale app.

```sh
bun run lab             # historian + simulator
bun run desktop         # builds the simulator UI, then runs the desktop client
bun run simulator-ui    # run the simulator control app on its own
```

Point it at another historian with `--historian <url>` or
`YUNMAI_HISTORIAN_URL`. It uses only the HTTP API; BLE, SQLite, and the node
WebSocket stay behind the historian. On startup it probes `/health` and, when
the URL is loopback and nothing is running, starts the packaged
`yunmai-noble.service` system unit (or a user unit, or the dev suite).
`YUNMAI_SERVICE` selects another unit and `--no-autostart` /
`YUNMAI_AUTOSTART=none` disables autostart. The Settings dialog starts the
chosen suite driver and stops the others; the choice is remembered in
`~/.config/yunmai-noble/desktop.json`. See
[apps/desktop/README.md](apps/desktop/README.md) for requirements and the
remaining SSE/trend work.

## Debian packages

Four packages are built with `dpkg-deb`:

```sh
bun install
packaging/deb/build.sh                   # writes dist/deb/*.deb
sudo apt install ./dist/deb/yunmai-noble-full_0.2.0_all.deb
```

| Package | What it installs |
| --- | --- |
| `yunmai-noble-full` | Metapackage: the service and the desktop client together, i.e. the normal install |
| `yunmai-noble` | `/usr/bin/yunmai-noble` with a bundled Bun, the app sources under `/usr/lib/yunmai-noble`, `yunmai-noble.service` on port 3000, and `/etc/yunmai-noble/config.toml`; no GUI dependencies |
| `yunmai-noble-desktop` | `/usr/bin/yunmai-noble-desktop` with a menu entry and driver picker, plus `/usr/bin/yunmai-noble-simulator-ui`; talks to the service over HTTP and can target a remote host |
| `yunmai-noble-simulator` | Optional parallel demo: `yunmai-noble-simulator.service` on port 3100, `/etc/yunmai-noble/simulator.toml`, and a simulator menu entry; depends on the main package and shares its runtime |

The service runs as the `yunmai` user and keeps its SQLite database under
`/var/lib/yunmai-noble` (or `/var/lib/yunmai-noble-simulator`). The main
service can switch to the simulator driver from the desktop app, so the
simulator package is only needed for a second instance running in parallel.
`apt remove` keeps data; `apt purge` removes it. See
[packaging/deb/README.md](packaging/deb/README.md) for the layout, build
flags, and glibc/architecture notes.

## BLE drivers

- `dbus` (default): needs BlueZ and the system D-Bus socket. On NixOS, enable
  `hardware.bluetooth.enable` and `hardware.bluetooth.powerOnBoot`; set
  `DBUS_SYSTEM_BUS_ADDRESS=unix:path=/run/dbus/system_bus_socket` if
  `/var/run` is not available.
- `noble` (legacy): native HCI; Node 22 only, with adapter access.
- `simulator`: no hardware.

On hosts with AppArmor or SELinux confining Docker, allow the container to use
the system D-Bus socket, or use the legacy noble image.

## Raspberry Pi

```sh
./run.sh          # default D-Bus image
./run.sh noble    # legacy native HCI image
```

Or run the installer remotely:

```sh
curl -fsSL https://raw.githubusercontent.com/Vanuan/yunmai-noble/master/run.sh | sh
```

The D-Bus image mounts `/run/dbus/system_bus_socket` and does not need
privileged networking, though the host security policy must allow D-Bus
access. The legacy image uses `--privileged` and host networking. Both use
Node 22 and npm so they work on arm32; Bun has no arm32 image.

## Repository layout

```
packages/node       BLE node, simulator, and tests
packages/contract   WebSocket v1 schemas and types
packages/historian  SQLite, HTTP API, SSE, v0/v1 ingest
packages/suite      Single executable: historian + UI + driver supervisor
packages/ui         React/Vite/Tailwind dashboard and simulator app
apps/desktop        Rust/GPUI desktop client
apps/simulator      Rust/GPUI virtual-scale control app
crates/ui-kit       Shared GPUI scale platform and visual primitives
packaging/deb       Debian package build and assets
docs/               screenshots
lab.toml            simulator-only development config
project/            design and status documents
yunmai-noble.example.toml  sample suite configuration
```

## Documentation

- [Status](project/STATUS.md), [Roadmap](project/ROADMAP.md),
  [Architecture](project/ARCHITECTURE.md)
- [WebSocket contract](project/WEBSOCKET.md)
- [Historian design](project/HISTORIAN.md)
- [D-Bus simulator design](project/DBUS_SIMULATOR.md)
- [Deployment plan](project/DEPLOYMENT.md)
