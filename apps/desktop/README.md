# yunmai-noble desktop

Native Rust desktop client for the historian API, built with
[`gpui-unofficial`](https://crates.io/crates/gpui-unofficial) (the published
build of Zed's GPUI).

It polls the historian every two seconds and shows the latest measurement,
service/upstream status, and recent history. A Settings dialog opened from the
titlebar selects the active suite driver. Live SSE streaming and simulator
controls are next.

## Window chrome

The app uses client-side decorations: a custom titlebar with the app name,
status badges, a Settings button, a close button, drag-to-move, and eight
edge/corner resize handles. If the compositor insists on server decorations,
the custom controls stay usable and the resize overlay is skipped.

## Launcher and preflight

Before opening the window, the app probes the historian:

- Reachable → open immediately.
- Unreachable, loopback URL, autostart enabled → try to start the service and
  wait up to ~6 s for `/health`.
  - `YUNMAI_AUTOSTART=auto` (default) prefers a systemd unit, trying the user
    unit first and then the system unit; otherwise it starts the suite from
    the checkout.
  - `YUNMAI_SERVICE` selects the unit (default `yunmai-noble.service`). The
    packaged simulator entry uses `yunmai-noble-simulator.service`.
  - `systemd` or `dev` forces one path.
  - `YUNMAI_SUITE_COMMAND` overrides the dev command.
  - Dev logs go to `data/desktop-suite.log`, and the suite is left running.
- Remote historian → never start a local service; open offline instead.

Disable autostart with `--no-autostart` or `YUNMAI_AUTOSTART=none`. The Debian
package installs the binary as `/usr/bin/yunmai-noble-desktop` with menu
entries for the real service and the simulator.

## Driver selection

The titlebar **Settings** button opens a dialog with the three suite drivers:
**Simulator**, **D-Bus**, and **Node bindings** (`noble`). Selecting one starts
it and stops the others via `POST /api/suite/drivers/{driver}/{start,stop}`.
Clicking the active driver stops it and forgets the choice. The selection is
saved to `$XDG_CONFIG_HOME/yunmai-noble/desktop.json` (or
`~/.config/yunmai-noble/desktop.json`) and reapplied on the next launch.

The options are disabled when the historian is not hosted by the suite. Node
bindings additionally need Node 22 and `@abandonware/noble` on the service
host, plus HCI access for the service user. The suite omits drivers it cannot
run, so those options are disabled; a saved choice that is no longer available
shows a message instead of starting.

When the Simulator driver is active, the dialog shows **Open simulator**. It
launches the standalone GPUI control app from `apps/simulator` against the same
suite. The app is a remote control for `/api/suite/simulator`; it does not
access D-Bus directly.

## Requirements

- Rust stable (edition 2024)
- Linux with Wayland or X11, `libxkbcommon`, Vulkan drivers, fontconfig, and
  the usual GPUI system packages
- Optional: a `yunmai-noble.service` systemd unit (system or user) for launcher
  autostart
- Optional: Node 22 and `@abandonware/noble` for the node-bindings driver

The crate lives in the root Cargo workspace.

## Run

Start the suite first (the simulator profile is enough):

```sh
bun run lab
```

Then, from the repository root:

```sh
bun run desktop          # builds the simulator UI first
# or
cargo run -p yunmai-noble-desktop
# or, just the simulator control app
bun run simulator-ui
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

The view uses the same light, soft-card palette as the GPUI simulator app. The
latest-reading card renders the shared physical-scale platform from
`crates/ui-kit`, so the dashboard shows the same virtual scale the user stepped
on. It talks only to the historian; it never opens BLE or SQLite.

## Next

- SSE live readings instead of polling
- Trend chart
- Simulator controls (the suite's `/api/suite/simulator`)
