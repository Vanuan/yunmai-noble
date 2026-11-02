# yunmai-noble desktop

Native Rust desktop client for the historian API, built with
[`gpui-unofficial`](https://crates.io/crates/gpui-unofficial) (the published
build of Zed's GPUI).

It polls the historian every two seconds and shows the latest measurement, a
weight trend chart, service/upstream status, and the five most recent readings.
**View history** opens a paginated list of every stored reading and **Open
historian** launches the web dashboard. A Settings dialog opened from the
titlebar selects the active suite driver. Live SSE streaming and simulator
controls are next.

## Trend chart

The dashboard plots the readings the poll returns (20) as a line chart with a
filled area, grid lines, and a dot per reading. `src/chart.rs` maps weights onto
unit coordinates in `plot_points`, which is unit tested; the canvas callback
only scales those points to the element bounds. Fewer than two readings hides
the chart.

## Latest reading

The card shows the scale platform, then the reading's time, user, device, and
firmware. When the driver has reported the advertised name, a **Model** field
sits next to the device id, so a `scale-simulator` node is identifiable as, say,
`YUNMAI-MINI`. Fat percentage and resistance only appear when the scale reports
them; weight-only models send zeros, and showing `0` would imply a measurement
that was never taken.

## History

The dashboard card lists the five most recent readings. Consecutive readings
with the same weight, user, and device within five minutes are folded into one
row marked with the number of readings, so a repeating simulator or a scale that
retransmits cannot flood the list. **View history**
replaces the dashboard with the full list: 100 readings per page, requested as
`GET /api/measurements?limit=100&before=<oldest scaleDate>`. Scrolling near the
bottom, or pressing **Load more**, fetches the next page. Reopening the view
starts again from the newest page. **Clear history** deletes every stored
reading through `DELETE /api/measurements`; it asks for a second click because
there is no undo. **Open historian** opens the web dashboard in the browser for
charts and per-user views.

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

The titlebar **Settings** button opens a dialog with three sections:

- **Status** - the historian URL, database health, one row per attached bridge
  (driver, URL, last message or last error), and the drivers that are running.
- **Drivers** - the three suite drivers.
- **Configuration** - the resolved TOML settings (`historian.*`, `drivers.*`,
  `simulator.*`) and the config file they came from, or "built-in defaults"
  when no file was loaded. The values come from `GET /api/suite/settings`, which
  reports what the suite resolved after applying environment overrides and
  strips credentials from upstream URLs. A historian running on its own has no
  suite configuration, so only the status section is filled in.

The driver section works as follows. The options are **Simulator**, **D-Bus**,
and **Node bindings** (`noble`). Selecting one starts it and stops the others
via `POST /api/suite/drivers/{driver}/{start,stop}`.
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
- `src/app.rs` — dashboard and history views, custom titlebar, polling loop
- `src/chart.rs` — weight trend chart geometry and canvas painting
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
- Trend ranges (week, month, all) on the chart
- Simulator controls (the suite's `/api/suite/simulator`)
