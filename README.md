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
$ BLE_DRIVER=simulator yarn start
```

The simulator implements the same link API as `noble`, emits measuring and
measured packets, and responds to commands on characteristic `ffe4`. It is
configured with `SIMULATOR_*` variables such as `SIMULATOR_WEIGHT_KG`,
`SIMULATOR_STEPS`, and `SIMULATOR_INTERVAL_MS`.

Run it interactively with `yarn simulate` and run tests with `yarn test`.

