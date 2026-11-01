'use strict';

const assert = require('assert');
const packets = require('../src/bluetooth/simulator/packets');
const protocol = require('../src/yunmai/protocol');

let failures = 0;

function test(name, fn) {
  try {
    fn();
    console.log('ok - ' + name);
  } catch (error) {
    failures += 1;
    console.error('not ok - ' + name);
    console.error(error.stack);
  }
}

test('measuring packets round-trip through the protocol parser', function() {
  const frame = packets.buildMeasuringPacket({
    date: 1500000000,
    weightKg: 7.41
  });

  assert.strictEqual(frame[0], protocol.SIGNATURE);
  assert.strictEqual(frame[2], frame.length);

  const packet = protocol.parsePacket(frame);
  assert.strictEqual(packet.packetSignature, protocol.SIGNATURE);
  assert.strictEqual(packet.firmwareVersion, packets.VERSION);
  assert.strictEqual(packet.packetType, protocol.PacketType.MEASURING);

  const reading = protocol.parseWeightingProgress(packet.data);
  assert.strictEqual(reading.date, 1500000000);
  assert.strictEqual(reading.weight, 741);
});

test('measured packets expose every completion field', function() {
  const frame = packets.buildMeasuredPacket({
    historical: true,
    date: 1500000100,
    userId: 42,
    weightKg: 7.35,
    resistance: 500,
    fatPercentage: 213
  });

  const packet = protocol.parsePacket(frame);
  assert.strictEqual(packet.packetType, protocol.PacketType.MEASURED);

  const measurement = protocol.parseWeightingCompleted(packet.data);
  assert.strictEqual(measurement.historicalInfo, 1);
  assert.strictEqual(measurement.date, 1500000100);
  assert.strictEqual(measurement.userId, 42);
  assert.strictEqual(measurement.weight, 735);
  assert.strictEqual(measurement.resistance, 500);
  assert.strictEqual(measurement.fatPercentage, 213);
});

test('command frames round-trip', function() {
  const payload = Buffer.alloc(4);
  payload.writeUInt32BE(42, 0);

  const frame = packets.buildCommand(packets.CommandType.SET_USER, payload);
  const command = packets.parseCommand(frame);

  assert.strictEqual(command.version, packets.VERSION);
  assert.strictEqual(command.type, packets.CommandType.SET_USER);
  assert.strictEqual(command.payload.readUInt32BE(0), 42);
});

test('ack frames set the high bit of the command type', function() {
  const frame = packets.buildAckPacket(packets.CommandType.REQUEST_HISTORY, packets.AckStatus.OK);
  const packet = protocol.parsePacket(frame);

  assert.strictEqual(packet.packetType, 0x92);
  assert.strictEqual(packet.data[0], packets.AckStatus.OK);
});

test('checksum covers the header and payload', function() {
  const frame = packets.buildMeasuringPacket({
    date: 1500000000,
    weightKg: 7.41
  });

  assert.strictEqual(
    frame[frame.length - 1],
    packets.checksum(frame.slice(0, frame.length - 1))
  );
});

if (failures > 0) process.exit(1);
