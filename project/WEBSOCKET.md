# WebSocket message contract

Status: draft v1. The zod schemas and tests exist; the node still emits the
v0 format described under [Migrating from v0](#migrating-from-v0).

Source of truth: [`src/contract/websocket.ts`](../src/contract/websocket.ts).

## Transport

- WebSocket, text frames, UTF-8.
- One JSON object per frame; no batching or newline framing.
- Server to client only. v1 has no client application messages; WebSocket
  ping/pong frames are handled by the WebSocket layer.
- Recommended maximum frame size: 64 KiB. Measurement frames are under 1 KiB.
- Endpoint: `ws://<node>:8080`, path and query string are ignored.

## Envelope

Every message uses the same envelope:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `v` | literal `1` | yes | Protocol version |
| `type` | string | yes | Discriminates the payload |
| `deviceId` | string, non-empty | yes | Stable node id, configured by the node |
| `sentAt` | ISO 8601 UTC with `Z` | yes | Node clock when the frame was sent |
| `payload` | object | yes | Shape depends on `type` |

Clients must ignore unknown fields and unknown message types. New optional
fields and new message types may be added within v1.

## Message types

### `hello`

Sent immediately after the connection opens, before any measurement.

```json
{
  "v": 1,
  "type": "hello",
  "deviceId": "pi-scale-1",
  "sentAt": "2026-11-01T13:35:25.400Z",
  "payload": {
    "capabilities": [
      "measurement.measuring",
      "measurement.completed",
      "status"
    ]
  }
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `payload.capabilities` | string[] | Message types this node may emit |

### `measurement.measuring`

A live progress value while a weighing is in progress.

```json
{
  "v": 1,
  "type": "measurement.measuring",
  "deviceId": "pi-scale-1",
  "sentAt": "2026-11-01T13:35:26.100Z",
  "payload": {
    "measuredAt": "2026-11-01T13:35:26.000Z",
    "weight": 741
  }
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `payload.measuredAt` | ISO 8601 UTC | Scale timestamp, second precision |
| `payload.weight` | integer `0..65535` | Hundredths of a kilogram (`741` = 7.41 kg) |

`measurement.measuring` is transient and must not be persisted.

### `measurement.completed`

A completed weighing. Consumers persist these.

```json
{
  "v": 1,
  "type": "measurement.completed",
  "deviceId": "pi-scale-1",
  "sentAt": "2026-11-01T13:35:27.120Z",
  "payload": {
    "measuredAt": "2026-11-01T13:35:27.000Z",
    "userId": 1,
    "weight": 750,
    "resistance": 480,
    "fatPercentage": 201,
    "historical": false,
    "firmwareVersion": 1
  }
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `payload.measuredAt` | ISO 8601 UTC | Scale timestamp, second precision |
| `payload.userId` | integer `0..4294967295` | Scale-local user slot, not a global account |
| `payload.weight` | integer `0..65535` | Hundredths of a kilogram |
| `payload.resistance` | integer `0..65535` | Raw device value, pass through |
| `payload.fatPercentage` | integer `0..65535` | Raw device value, pass through |
| `payload.historical` | boolean | `true` for stored measurements replayed by the scale |
| `payload.firmwareVersion` | integer `0..255` | Scale firmware reported in the packet |

Measurements may be repeated: a live measurement can later be replayed as a
historical one. Consumers deduplicate completed measurements by
`(deviceId, measuredAt, userId, weight)`.

### `status`

Bluetooth and connection state changes.

```json
{
  "v": 1,
  "type": "status",
  "deviceId": "pi-scale-1",
  "sentAt": "2026-11-01T13:35:25.500Z",
  "payload": {
    "bluetooth": "poweredOn",
    "scanning": false,
    "connected": true,
    "peripheralName": "YUNMAI-SIM"
  }
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `payload.bluetooth` | enum | `poweredOn`, `poweredOff`, `resetting`, `unauthorized`, `unsupported`, `unknown` |
| `payload.scanning` | boolean | Whether discovery is active |
| `payload.connected` | boolean | Whether a scale is connected |
| `payload.peripheralName` | string or null | Advertised name when connected |

### `error`

A non-fatal problem the node wants clients to see.

```json
{
  "v": 1,
  "type": "error",
  "deviceId": "pi-scale-1",
  "sentAt": "2026-11-01T13:35:28.000Z",
  "payload": {
    "code": "unsupported_packet",
    "message": "Packet type 9 is not supported"
  }
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `payload.code` | string, non-empty | Stable machine-readable code |
| `payload.message` | string | Human-readable detail |

An `error` does not close the connection.

## Invariants

- `weight` is always an integer in hundredths of a kilogram. Clients divide by
  100 for display.
- Timestamps are ISO 8601 UTC with a `Z` suffix; fractional seconds are
  optional.
- `measurement.completed` is the only durable message type.
- `hello` is the first message on a connection.
- Messages are delivered in emission order per connection.
- Binary BLE packets are never forwarded; all values are JSON numbers,
  strings, booleans, or null.
- A client that does not understand `v` or a `type` must ignore that frame and
  continue.

## Versioning

- `v` is bumped only for breaking changes.
- Additive fields and new message types keep the current `v`.
- When `v` changes, the server may keep emitting the previous version during a
  migration window; clients select the highest version they support from
  `hello`.
- v1 does not negotiate per-client versions; the node emits one version.

## Migrating from v0

The current node emits unversioned objects:

```json
{ "firmwareVersion": 1, "packetType": "measuring", "data": { "date": 1761994526, "weight": 741 } }
{ "firmwareVersion": 1, "packetType": "measured", "data": {
  "historicalInfo": 1, "date": 1761994526, "userId": 1,
  "weight": 750, "resistance": 480, "fatPercentage": 201
} }
```

| v0 | v1 |
| --- | --- |
| `packetType: "measuring"` | `type: "measurement.measuring"` |
| `packetType: "measured"` | `type: "measurement.completed"` |
| `data.date` (epoch seconds) | `payload.measuredAt` = `new Date(date * 1000).toISOString()` |
| `data.userId`, `data.weight`, `data.resistance`, `data.fatPercentage` | Same names under `payload` |
| `data.historicalInfo === 1` | `payload.historical` |
| `firmwareVersion` | `payload.firmwareVersion` |
| `packetType: "unknown"` | `type: "error"` with `code: "unsupported_packet"` |
| missing | `v`, `deviceId`, `sentAt` from node configuration and send time |

Node migration is tracked in [ROADMAP.md](ROADMAP.md). Consumers built against
v1 must not parse v0 frames without an adapter.

## Using the schemas

```ts
import { parseServerMessage } from "../src/contract/websocket";

const message = parseServerMessage(JSON.parse(raw));

switch (message.type) {
  case "measurement.completed":
    // message.payload is fully typed and validated
    break;
  case "measurement.measuring":
  case "status":
  case "hello":
  case "error":
    break;
}
```

`parseServerMessage` throws a `ZodError` on invalid input.
`safeParseServerMessage` returns `{ success, data | error }` for untrusted
streams.

Zod strips unknown object keys by default. Consumers that need forward
compatibility for new fields should read them from the raw frame as well.

## Security and limits

- v1 has no authentication or authorization. Bind the node and historian to a
  trusted network, or put them behind a reverse proxy or VPN.
- `deviceId` is an identifier, not a credential.
- The node should enforce a `maxPayload` of 64 KiB and close clients that do
  not read fast enough; neither is implemented yet.
- Measurement frames contain no personal data beyond the scale-local
  `userId`.

## Testing

`test/contract.test.ts` covers valid messages for every type, envelope and
payload rejections, and the discriminated union. Run it with `bun test`.
