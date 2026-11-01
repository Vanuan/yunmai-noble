# yumnai-noble

Yunmai scales BLE node app in docker

## Idea

```mermaid
flowchart TD
    browser["browser"] --> webui["Web UI"]

    webui -->|"RESTful API"| historian["Weight historian"]
    historian --> database[("Database")]

    webui --> ws(("Web socket"))
    historian --> ws
    ws --> node["yunmai-noble (this project)"]

    node -->|"Bluetooth"| scales["yunmai scales"]
```

## Install on Raspberry Pi

1. Install docker
2. `docker run` the container
```
$ curl -fsSL https://raw.githubusercontent.com/Vanuan/yunmai-noble/master/run.sh | sh
```

## Development (on any laptop that supports BLE)

Requires Node 22 for the real BLE link (see `.nvmrc`) and Bun for package
management, tests, and TypeScript.

```
$ docker-compose up --build
...
yunmai_1  | Bluetooth poweredOn
yunmai_1  | Looking for peripheral...
yunmai_1  | Yunmai scales detected
yunmai_1  | Waiting for weighting...
yunmai_1  | Tue Oct 31 2017 10:07:22 GMT+0000 (UTC) 7.41 kg
yunmai_1  | Tue Oct 31 2017 10:07:22 GMT+0000 (UTC) 7.53 kg
yunmai_1  | Tue Oct 31 2017 10:07:23 GMT+0000 (UTC) 7.41 kg
yunmai_1  | Tue Oct 31 2017 10:07:23 GMT+0000 (UTC) 7.37 kg
yunmai_1  | Tue Oct 31 2017 10:07:23 GMT+0000 (UTC) 7.33 kg
yunmai_1  | Tue Oct 31 2017 10:07:23 GMT+0000 (UTC) 7.23 kg
yunmai_1  | Tue Oct 31 2017 10:07:23 GMT+0000 (UTC) 7.27 kg
yunmai_1  | Tue Oct 31 2017 10:07:24 GMT+0000 (UTC) 7.31 kg
yunmai_1  | Tue Oct 31 2017 10:07:24 GMT+0000 (UTC) 7.31 kg
```

## Simulator (no BLE hardware)

Set `BLE_DRIVER=simulator` to replace the Bluetooth link with a simulated
Yunmai scale:

```
$ bun install
$ BLE_DRIVER=simulator bun run dev
```

The simulator implements the same link API as `noble`, emits measuring and
measured packets, and responds to commands on characteristic `ffe4`. It is
configured with `SIMULATOR_*` variables such as `SIMULATOR_WEIGHT_KG`,
`SIMULATOR_STEPS`, and `SIMULATOR_INTERVAL_MS`.

Run it interactively with `bun run simulate`; run `bun test` and
`bun run typecheck`.

Bun runs the simulator and the test suite. The real BLE link still runs on Node
22 because `@abandonware/bluetooth-hci-socket` is a native addon built for
Node's ABI and cannot be loaded by Bun.

## WebSocket contract

The message format is specified in [`project/WEBSOCKET.md`](project/WEBSOCKET.md).
TypeScript types and zod schemas live in `src/contract/websocket.ts`.

