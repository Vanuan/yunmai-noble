# WebSocket message contract

Status: v1 is implemented in the node and historian schemas. The v0 mapping
below is retained for older nodes. Source of truth:
[`packages/contract/src/websocket.ts`](../packages/contract/src/websocket.ts).

## Transport

- WebSocket text frames, UTF-8, one JSON object per frame.
- Server to client only; v1 has no client application messages.
- Recommended maximum frame size: 64 KiB.
- Endpoint: `ws://<node>:8080`; path and query are ignored.

## Envelope

| Field | Type | Notes |
| --- | --- | --- |
| `v` | literal `1` | Protocol version |
| `type` | string | Message discriminator |
| `deviceId` | non-empty string | Stable node id |
| `sentAt` | ISO 8601 UTC with `Z` | Node clock |
| `payload` | object | Shape depends on `type` |

Clients ignore unknown fields, message types, and unsupported versions.

## Messages

### `hello`

Sent first on every connection.

```json
{ "v": 1, "type": "hello", "deviceId": "pi-scale-1",
  "sentAt": "2026-11-01T13:35:25.400Z",
  "payload": { "capabilities": ["measurement.measuring",
    "measurement.completed", "status"] } }
```

`capabilities` lists message types the node may emit.

### `measurement.measuring`

Live progress; not persisted.

```json
{ "v": 1, "type": "measurement.measuring", "deviceId": "pi-scale-1",
  "sentAt": "2026-11-01T13:35:26.100Z",
  "payload": { "measuredAt": "2026-11-01T13:35:26.000Z", "weight": 741 } }
```

`weight` is an integer in hundredths of a kilogram. `measuredAt` comes from the
scale clock at second precision.

### `measurement.completed`

The only durable message type.

```json
{ "v": 1, "type": "measurement.completed", "deviceId": "pi-scale-1",
  "sentAt": "2026-11-01T13:35:27.120Z",
  "payload": {
    "measuredAt": "2026-11-01T13:35:27.000Z",
    "userId": 1,
    "weight": 750,
    "resistance": 480,
    "fatPercentage": 201,
    "historical": false,
    "firmwareVersion": 1
  } }
```

| Field | Range | Notes |
| --- | --- | --- |
| `measuredAt` | ISO 8601 UTC | Scale timestamp |
| `userId` | `0..4294967295` | Scale-local user slot |
| `weight` | `0..65535` | Hundredths of a kilogram |
| `resistance` | `0..65535` | Raw device value |
| `fatPercentage` | `0..65535` | Raw device value |
| `historical` | boolean | Stored measurement replayed by the scale |
| `firmwareVersion` | `0..255` | Scale firmware |

Consumers deduplicate by `(deviceId, measuredAt, userId, weight)`, since a live
measurement may later be replayed as historical.

### `status`

```json
{ "v": 1, "type": "status", "deviceId": "pi-scale-1",
  "sentAt": "2026-11-01T13:35:25.500Z",
  "payload": { "bluetooth": "poweredOn", "scanning": false,
    "connected": true, "peripheralName": "YUNMAI-SIM" } }
```

`bluetooth` is one of `poweredOn`, `poweredOff`, `resetting`, `unauthorized`,
`unsupported`, `unknown`. `peripheralName` may be `null`.

### `error`

```json
{ "v": 1, "type": "error", "deviceId": "pi-scale-1",
  "sentAt": "2026-11-01T13:35:28.000Z",
  "payload": { "code": "unsupported_packet", "message": "Packet type 9" } }
```

Errors are non-fatal and do not close the connection.

## Invariants

- `weight` is always an integer in hundredths of a kilogram.
- There is no unit on the wire. The Yunmai measuring and measured packets
  carry only a weight value, so the scale's physical kg/lb switch is not
  observable to the service; everything downstream stores and publishes
  kilograms. Clients convert at render time (`weight / 2.204622621848776`).
  The simulator's `SET_UNIT` (0x13) command is a test hook only — real
  hardware command framing has not been reverse-engineered.
- Timestamps are ISO 8601 UTC with a `Z` suffix; fractional seconds are
  optional.
- `hello` is the first message; messages keep emission order per connection.
- Only `measurement.completed` is durable.
- Binary BLE packets are never forwarded; values are JSON scalars.
- Unknown fields and message types are ignored.

## Versioning

- `v` changes only for breaking changes.
- Additive fields and new message types stay within the current version.
- v1 does not negotiate per-client versions.

## Migrating from v0

| v0 | v1 |
| --- | --- |
| `packetType: "measuring"` | `type: "measurement.measuring"` |
| `packetType: "measured"` | `type: "measurement.completed"` |
| `data.date` (epoch seconds) | `payload.measuredAt` (`date * 1000` ISO) |
| `data.userId`, `data.weight`, `data.resistance`, `data.fatPercentage` | Same names under `payload` |
| `data.historicalInfo === 1` | `payload.historical` |
| `firmwareVersion` | `payload.firmwareVersion` |
| `packetType: "unknown"` | `type: "error"`, `code: "unsupported_packet"` |
| missing | `v`, `deviceId`, `sentAt` |

## Validation

```ts
import { parseServerMessage } from "@yunmai-noble/contract";

const message = parseServerMessage(JSON.parse(raw));
if (message.type === "measurement.completed") {
  // message.payload is validated and typed
}
```

`parseServerMessage` throws `ZodError`; `safeParseServerMessage` returns a
result object. Zod strips unknown keys by default.

## Security and limits

- v1 has no authentication; bind to a trusted network or use a VPN.
- `deviceId` is an identifier, not a credential.
- The node should enforce the 64 KiB limit and drop slow clients; not
  implemented yet.
- No personal data beyond the scale-local `userId`.
