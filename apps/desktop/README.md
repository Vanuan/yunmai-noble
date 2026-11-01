# yunmai-noble desktop

Native Rust desktop client for the historian API, built with
[`gpui-unofficial`](https://crates.io/crates/gpui-unofficial) (the published
build of Zed's GPUI).

The first scaffold is read-only: it polls the historian every two seconds and
shows the latest measurement, service/upstream status, and recent history. Live
SSE streaming and simulator controls are next.

## Window chrome

The app uses client-side decorations: a custom titlebar with the app name, a
close button, drag-to-move, and eight edge/corner resize handles. If the
compositor insists on server decorations, the custom controls stay usable and
the resize overlay is skipped.

## Launcher and preflight

Before opening the window, the app probes the historian:

- Reachable → open immediately.
- Unreachable, loopback URL, autostart enabled → try to start the service and
  wait up to ~6 s for `/health`.
  - `YUNMAI_AUTOSTART=auto` (default) prefers a user systemd unit named
    `yunmai-noble.service`; otherwise it starts the suite from the checkout.
  - `systemd` or `dev` forces one path.
  - `YUNMAI_SUITE_COMMAND` overrides the dev command.
  - Dev logs go to `data/desktop-suite.log`, and the suite is left running.
- Remote historian → never start a local service; open offline instead.

Disable autostart with `--no-autostart` or `YUNMAI_AUTOSTART=none`. A
`yunmai-noble.desktop` entry is included for packaging.

## Requirements

- Rust stable (edition 2024)
- Linux with Wayland or X11, `libxkbcommon`, Vulkan drivers, fontconfig, and
  the usual GPUI system packages
- Optional: a `yunmai-noble.service` systemd user unit for launcher autostart

The crate lives in the root Cargo workspace.

## Run

Start the suite first (the simulator profile is enough):

```sh
bun run lab
```

Then, from the repository root:

```sh
cargo run -p yunmai-noble-desktop
# or
bun run desktop
```

Point the app at another historian:

```sh
cargo run -p yunmai-noble-desktop -- --historian http://pi.local:3000
YUNMAI_HISTORIAN_URL=http://pi.local:3000 cargo run -p yunmai-noble-desktop
```

`Ctrl-Q` / `Cmd-Q` quits.

## Layout

- `src/main.rs` — window, args, key bindings, preflight call
- `src/app.rs` — dashboard view, custom titlebar, polling loop
- `src/api.rs` — historian HTTP client and serde models
- `src/format.rs` — weight/date formatting
- `src/launcher.rs` — health probe and service autostart
- `yunmai-noble.desktop` — desktop entry for packaging

The view mirrors the web dashboard's dark theme and spacing so the two clients
stay visually consistent. It talks only to the historian; it never opens BLE or
SQLite.

## Next

- SSE live readings instead of polling
- Trend chart
- Simulator controls (the suite's `/api/suite/simulator`)
- Packaging for the Ubuntu `.deb` and systemd service
