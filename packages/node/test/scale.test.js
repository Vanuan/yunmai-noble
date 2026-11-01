'use strict';

const { test } = require('bun:test');
const assert = require('node:assert/strict');

const Scale = require('../src/bluetooth/simulator/scale');
const packets = require('../src/bluetooth/simulator/packets');
const protocol = require('../src/yunmai/protocol');

const SILENT_LOGGER = {
  log: function() {},
  error: function() {}
};

function waitFor(predicate, timeoutMs) {
  return new Promise(function(resolve, reject) {
    const startedAt = Date.now();
    (function poll() {
      if (predicate()) return resolve();
      if (Date.now() - startedAt > timeoutMs) {
        return reject(new Error('Timed out waiting for condition'));
      }
      setTimeout(poll, 5);
    })();
  });
}

function parseAck(frame) {
  return protocol.parsePacket(frame);
}

test('set unit and set user commands are acknowledged and applied', function() {
  const scale = new Scale({
    autoStart: false,
    repeat: false,
    logger: SILENT_LOGGER
  });

  let ack = parseAck(
    scale.handleCommand(
      packets.buildCommand(packets.CommandType.SET_UNIT, Buffer.from([1]))
    )[0]
  );
  assert.equal(ack.packetType, 0x93);
  assert.equal(ack.data[0], packets.AckStatus.OK);
  assert.equal(scale.unit, 'lb');

  const payload = Buffer.alloc(4);
  payload.writeUInt32BE(42, 0);

  ack = parseAck(
    scale.handleCommand(
      packets.buildCommand(packets.CommandType.SET_USER, payload)
    )[0]
  );
  assert.equal(ack.packetType, 0x94);
  assert.equal(ack.data[0], packets.AckStatus.OK);
  assert.equal(scale.userId, 42);
});

test('invalid and unsupported commands return error acks', function() {
  const scale = new Scale({
    autoStart: false,
    repeat: false,
    logger: SILENT_LOGGER
  });

  let ack = parseAck(
    scale.handleCommand(Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]))[0]
  );
  assert.equal(ack.packetType, 0x80);
  assert.equal(ack.data[0], packets.AckStatus.INVALID_ARGUMENT);

  ack = parseAck(
    scale.handleCommand(
      packets.buildCommand(packets.CommandType.SET_UNIT)
    )[0]
  );
  assert.equal(ack.packetType, 0x93);
  assert.equal(ack.data[0], packets.AckStatus.INVALID_ARGUMENT);

  ack = parseAck(
    scale.handleCommand(
      packets.buildCommand(packets.CommandType.SET_USER, Buffer.alloc(2))
    )[0]
  );
  assert.equal(ack.data[0], packets.AckStatus.INVALID_ARGUMENT);

  ack = parseAck(scale.handleCommand(packets.buildCommand(0x33))[0]);
  assert.equal(ack.packetType, 0xb3);
  assert.equal(ack.data[0], packets.AckStatus.UNSUPPORTED);
});

test('power, weight, user, and history controls drive the scale', async function() {
  const scale = new Scale({
    autoStart: false,
    repeat: false,
    steps: 0,
    intervalMs: 1,
    weightKg: 7.5,
    history: [{ date: 1500000000, weightKg: 7.2, userId: 7 }],
    logger: SILENT_LOGGER
  });

  const received = [];
  scale.on('packet', function(packet) {
    received.push(protocol.parsePacket(packet));
  });
  scale.subscribe();

  assert.equal(scale.state().powered, true);
  scale.setPowered(false);
  assert.equal(scale.state().powered, false);
  assert.equal(scale.start(), false);

  scale.setPowered(true);
  scale.setWeightKg(81.2);
  scale.setUser(4);
  assert.equal(scale.state().weightKg, 81.2);
  assert.equal(scale.start(), true);

  await waitFor(function() {
    return received.some(function(packet) {
      return packet.packetType === protocol.PacketType.MEASURED;
    });
  }, 2000);

  const measuredPacket = received.filter(function(packet) {
    return packet.packetType === protocol.PacketType.MEASURED;
  })[0];
  const measured = protocol.parseWeightingCompleted(measuredPacket.data);
  assert.equal(measured.weight, 8120);
  assert.equal(measured.userId, 4);
  assert.equal(scale.state().lastWeightKg, 81.2);

  scale.sendHistory();
  const historical = received.filter(function(packet) {
    return packet.packetType === protocol.PacketType.MEASURED && packet.data[0] === 1;
  });
  assert.equal(historical.length, 1);
  assert.equal(scale.state().history, 1);

  scale.setPowered(false);
  assert.equal(scale.state().running, false);
  scale.unsubscribe();
});

test('completed measurements include the configured body metrics', async function() {
  const scale = new Scale({
    autoStart: false,
    repeat: false,
    steps: 0,
    intervalMs: 1,
    weightKg: 8.12,
    resistance: 480,
    fatPercentage: 201,
    userId: 3,
    logger: SILENT_LOGGER
  });

  const received = [];
  scale.on('packet', function(packet) {
    received.push(protocol.parsePacket(packet));
  });

  scale.subscribe();
  scale.start();

  try {
    await waitFor(function() {
      return received.some(function(packet) {
        return packet.packetType === protocol.PacketType.MEASURED;
      });
    }, 2000);

    const measuredPacket = received.filter(function(packet) {
      return packet.packetType === protocol.PacketType.MEASURED;
    })[0];
    const measured = protocol.parseWeightingCompleted(measuredPacket.data);

    assert.equal(measured.weight, 812);
    assert.equal(measured.resistance, 480);
    assert.equal(measured.fatPercentage, 201);
    assert.equal(measured.userId, 3);
    assert.equal(measured.historicalInfo, 0);
  } finally {
    scale.unsubscribe();
  }
});
