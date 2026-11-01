# Web client

React + Vite + Tailwind dashboard for the historian API and SSE relay.

## Development

Start the historian, then the Vite dev server:

```sh
bun run historian   # http://127.0.0.1:3000
bun run ui          # http://127.0.0.1:5173
```

Vite proxies `/api` and `/health` to the historian.

## Production

```sh
bun run build:ui
bun run historian
```

The historian serves `packages/ui/dist` when present and falls back to its
placeholder page otherwise.

## GPUI portability

This is a web client first, but the view layer is intentionally plain:

- Components in `src/components/` are presentational "templates".
- State lives in `src/hooks/useDashboard.ts`.
- Layout uses flex/grid and spacing tokens rather than web-specific tricks.
- Brand colors and spacing map naturally to GPUI theme constants.
- Only `fetch` and `EventSource` are browser-specific; the view model can be
  reused when porting to Rust/GPUI.

The port does not need to be literal: the web client is the UX reference, not
a GPUI abstraction.
