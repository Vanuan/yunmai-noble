# yunmai-noble desktop

Native Rust desktop client for the historian API, built with
[`gpui-unofficial`](https://crates.io/crates/gpui-unofficial) (the published
build of Zed's GPUI).

The first scaffold is read-only: it polls the historian every two seconds and
shows the latest measurement, service/upstream status, and recent history. Live
SSE streaming and simulator controls are next.

## Requirements

- Rust stable (edition 2024)
- Linux with Wayland or X11, `libxkbcommon`, Vulkan drivers, fontconfig, and
  the usual GPUI system packages

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

- `src/main.rs` — window, args, key bindings
- `src/app.rs` — dashboard view and polling loop
- `src/api.rs` — historian HTTP client and serde models
- `src/format.rs` — weight/date formatting

The view mirrors the web dashboard's dark theme and spacing so the two clients
stay visually consistent. It talks only to the historian; it never opens BLE or
SQLite.

## Next

- SSE live readings instead of polling
- Trend chart
- Simulator controls (the suite's `/api/suite/simulator`)
- Packaging for the Ubuntu `.deb` and systemd service
