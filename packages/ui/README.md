# Web clients

React + Vite + Tailwind entries for the historian API and SSE relay:

- `/` — dashboard with history, trend, and live readings.
- `/simulator/` — virtual scale controlling the simulator driver.

Both are built from this package as separate HTML entries.

## Development

Start the suite (or a historian) with the simulator driver, then the Vite dev
server:

```sh
bun run lab         # http://127.0.0.1:3000
bun run ui          # http://127.0.0.1:5173
```

- Dashboard: `http://127.0.0.1:5173/`
- Simulator: `http://127.0.0.1:5173/simulator/`

Vite proxies `/api` and `/health` to port 3000.

## Production

```sh
bun run build:ui
bun run suite
```

The historian serves `packages/ui/dist` when present and falls back to its
placeholder page otherwise. `/simulator` redirects to `/simulator/`.

## GPUI portability

This is a web client first, but the view layer is intentionally plain:

- Components in `src/components/` are presentational "templates".
- Dashboard state lives in `src/hooks/useDashboard.ts`; the simulator page uses
  `SimulatorPanel` plus a live-weight hook.
- Layout uses flex/grid and spacing tokens rather than web-specific tricks.
- Brand colors and spacing map naturally to GPUI theme constants.
- Only `fetch` and `EventSource` are browser-specific; the view model can be
  reused when porting to Rust/GPUI.

The port does not need to be literal: the web client is the UX reference, not
a GPUI abstraction.
