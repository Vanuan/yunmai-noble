import { test } from "bun:test";
import assert from "node:assert/strict";

import {
  PROTOCOL_VERSION,
  ServerMessageSchema,
  MessageTypes,
  parseServerMessage,
  safeParseServerMessage,
  type CompletedMessage,
  type ServerMessage,
} from "../src/contract/websocket";

const envelope = {
  v: PROTOCOL_VERSION,
  deviceId: "pi-scale-1",
  sentAt: "2026-11-01T13:35:27.120Z",
} as const;

test("accepts a hello message", () => {
  const input = {
    ...envelope,
    type: MessageTypes.HELLO,
    payload: {
      capabilities: [MessageTypes.MEASURING, MessageTypes.COMPLETED],
    },
  };

  const message: ServerMessage = parseServerMessage(input);
  assert.deepEqual(message, input);
});

test("accepts measuring messages", () => {
  const message = parseServerMessage({
    ...envelope,
    type: MessageTypes.MEASURING,
    payload: {
      measuredAt: "2026-11-01T13:35:26.000Z",
      weight: 741,
    },
  });

  assert.equal(message.type, MessageTypes.MEASURING);
  if (message.type === MessageTypes.MEASURING) {
    assert.equal(message.payload.weight, 741);
  }
});

test("accepts completed measurements", () => {
  const input: CompletedMessage = {
    ...envelope,
    type: MessageTypes.COMPLETED,
    payload: {
      measuredAt: "2026-11-01T13:35:26.000Z",
      userId: 1,
      weight: 750,
      resistance: 480,
      fatPercentage: 201,
      historical: false,
      firmwareVersion: 1,
    },
  };

  const message = parseServerMessage(input);
  assert.deepEqual(message, input);
});

test("accepts status and error messages", () => {
  const status = parseServerMessage({
    ...envelope,
    type: MessageTypes.STATUS,
    payload: {
      bluetooth: "poweredOn",
      scanning: false,
      connected: true,
      peripheralName: "YUNMAI-SIM",
    },
  });
  assert.equal(status.type, MessageTypes.STATUS);

  const error = parseServerMessage({
    ...envelope,
    type: MessageTypes.ERROR,
    payload: {
      code: "invalid_packet",
      message: "Packet type 9 is not supported",
    },
  });
  assert.equal(error.type, MessageTypes.ERROR);
});

test("rejects invalid envelopes and payloads", () => {
  const invalid = [
    { ...envelope, v: 2, type: MessageTypes.HELLO, payload: { capabilities: [] } },
    { ...envelope, deviceId: "", type: MessageTypes.HELLO, payload: { capabilities: [] } },
    {
      ...envelope,
      sentAt: "2026-11-01T13:35:27.120+02:00",
      type: MessageTypes.HELLO,
      payload: { capabilities: [] },
    },
    {
      ...envelope,
      type: MessageTypes.MEASURING,
      payload: { measuredAt: "2026-11-01T13:35:26.000Z", weight: 7.41 },
    },
    {
      ...envelope,
      type: MessageTypes.MEASURING,
      payload: { measuredAt: "yesterday", weight: 741 },
    },
    {
      ...envelope,
      type: MessageTypes.COMPLETED,
      payload: {
        measuredAt: "2026-11-01T13:35:26.000Z",
        weight: 750,
        resistance: 0,
        fatPercentage: 0,
        historical: false,
        firmwareVersion: 1,
      },
    },
    {
      ...envelope,
      type: MessageTypes.STATUS,
      payload: {
        bluetooth: "on",
        scanning: false,
        connected: false,
        peripheralName: null,
      },
    },
  ];

  for (const input of invalid) {
    assert.equal(safeParseServerMessage(input).success, false);
  }
});

test("rejects legacy v0 messages and unknown message types", () => {
  assert.equal(
    safeParseServerMessage({
      firmwareVersion: 1,
      packetType: "measured",
      data: {},
    }).success,
    false
  );

  assert.equal(
    safeParseServerMessage({
      ...envelope,
      type: "measurement",
      payload: {},
    }).success,
    false
  );
});

test("exposes a discriminated union schema", () => {
  const result = ServerMessageSchema.safeParse({
    ...envelope,
    type: MessageTypes.ERROR,
    payload: { code: "boom", message: "failed" },
  });

  assert.equal(result.success, true);
});
