'use strict';

const { test } = require('bun:test');
const assert = require('node:assert/strict');

const { ServerMessageSchema } = require('@yunmai-noble/contract');
const messages = require('../src/yunmai/messages');

const SENT_AT = '2026-11-01T10:00:01.000Z';

test('builds a hello message', function() {
  const message = messages.buildHelloMessage(
    'pi-scale-1',
    ['measurement.completed'],
    SENT_AT
  );
  const parsed = ServerMessageSchema.parse(message);

  assert.equal(parsed.v, 1);
  assert.equal(parsed.type, 'hello');
  assert.equal(parsed.deviceId, 'pi-scale-1');
  assert.deepEqual(parsed.payload.capabilities, ['measurement.completed']);
});

test('builds a measuring message', function() {
  const parsed = ServerMessageSchema.parse(
    messages.buildMeasuringMessage(
      'pi-scale-1',
      { date: 1500000000, weight: 741 },
      SENT_AT
    )
  );

  assert.equal(parsed.type, 'measurement.measuring');
  if (parsed.type === 'measurement.measuring') {
    assert.equal(parsed.payload.measuredAt, '2017-07-14T02:40:00.000Z');
    assert.equal(parsed.payload.weight, 741);
  }
});

test('builds a completed message', function() {
  const parsed = ServerMessageSchema.parse(
    messages.buildCompletedMessage(
      'pi-scale-1',
      {
        historicalInfo: 1,
        date: 1500000000,
        userId: 7,
        weight: 750,
        resistance: 480,
        fatPercentage: 201
      },
      1,
      SENT_AT
    )
  );

  assert.equal(parsed.type, 'measurement.completed');
  if (parsed.type === 'measurement.completed') {
    assert.equal(parsed.payload.measuredAt, '2017-07-14T02:40:00.000Z');
    assert.equal(parsed.payload.userId, 7);
    assert.equal(parsed.payload.weight, 750);
    assert.equal(parsed.payload.resistance, 480);
    assert.equal(parsed.payload.fatPercentage, 201);
    assert.equal(parsed.payload.historical, true);
    assert.equal(parsed.payload.firmwareVersion, 1);
  }
});

test('builds status and error messages', function() {
  const status = ServerMessageSchema.parse(
    messages.buildStatusMessage(
      'pi-scale-1',
      {
        bluetooth: 'poweredOn',
        scanning: false,
        connected: true,
        peripheralName: 'YUNMAI-SIM'
      },
      SENT_AT
    )
  );
  assert.equal(status.type, 'status');

  const error = ServerMessageSchema.parse(
    messages.buildErrorMessage(
      'pi-scale-1',
      'unsupported_packet',
      'Packet type 9 is not supported',
      SENT_AT
    )
  );
  assert.equal(error.type, 'error');
  if (error.type === 'error') {
    assert.equal(error.payload.code, 'unsupported_packet');
  }
});
