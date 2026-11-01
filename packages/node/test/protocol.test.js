'use strict';

const { test } = require('bun:test');
const assert = require('node:assert/strict');

const packets = require('../src/bluetooth/simulator/packets');
const protocol = require('../src/yunmai/protocol');

test('measuring packets round-trip through the protocol parser', () => {
  const frame = packets.buildMeasuringPacket({
    date: 1500000000,
    weightKg: 7.41
  });

  assert.equal(frame[0], protocol.SIGNATURE);
  assert.equal(frame[2], frame.length);

  const packet = protocol.parsePacket(frame);
  assert.equal(packet.packetSignature, protocol.SIGNATURE);
  assert.equal(packet.firmwareVersion, packets.VERSION);
  assert.equal(packet.packetType, protocol.PacketType.MEASURING);

  const reading = protocol.parseWeightingProgress(packet.data);
  assert.equal(reading.date, 1500000000);
  assert.equal(reading.weight, 741);
});

test('measured packets expose every completion field', () => {
  const frame = packets.buildMeasuredPacket({
    historical: true,
    date: 1500000100,
    userId: 42,
    weightKg: 7.35,
    resistance: 500,
    fatPercentage: 213
  });

  const packet = protocol.parsePacket(frame);
  assert.equal(packet.packetType, protocol.PacketType.MEASURED);

  const measurement = protocol.parseWeightingCompleted(packet.data);
  assert.equal(measurement.historicalInfo, 1);
  assert.equal(measurement.date, 1500000100);
  assert.equal(measurement.userId, 42);
  assert.equal(measurement.weight, 735);
  assert.equal(measurement.resistance, 500);
  assert.equal(measurement.fatPercentage, 213);
});

test('command frames round-trip', () => {
  const payload = Buffer.alloc(4);
  payload.writeUInt32BE(42, 0);

  const frame = packets.buildCommand(packets.CommandType.SET_USER, payload);
  const command = packets.parseCommand(frame);

  assert.equal(command.version, packets.VERSION);
  assert.equal(command.type, packets.CommandType.SET_USER);
  assert.equal(command.payload.readUInt32BE(0), 42);
});

test('ack frames set the high bit of the command type', () => {
  const frame = packets.buildAckPacket(packets.CommandType.REQUEST_HISTORY, packets.AckStatus.OK);
  const packet = protocol.parsePacket(frame);

  assert.equal(packet.packetType, 0x92);
  assert.equal(packet.data[0], packets.AckStatus.OK);
});

test('checksum covers the header and payload', () => {
  const frame = packets.buildMeasuringPacket({
    date: 1500000000,
    weightKg: 7.41
  });

  assert.equal(
    frame[frame.length - 1],
    packets.checksum(frame.slice(0, frame.length - 1))
  );
});

test('parseCommand rejects malformed frames', () => {
  assert.throws(
    () => packets.parseCommand(Buffer.alloc(2)),
    /too short/
  );

  const badSignature = Buffer.from(
    packets.buildCommand(packets.CommandType.START_MEASUREMENT)
  );
  badSignature[0] = 0x00;
  assert.throws(
    () => packets.parseCommand(badSignature),
    /signature/
  );

  const badLength = Buffer.from(
    packets.buildCommand(packets.CommandType.START_MEASUREMENT)
  );
  badLength[2] = 1;
  assert.throws(
    () => packets.parseCommand(badLength),
    /length mismatch/
  );
});

test('builders reject weights that do not fit in a uint16', () => {
  assert.throws(
    () => packets.buildMeasuringPacket({ date: 1, weightKg: -0.01 }),
    /weightKg out of range/
  );
  assert.throws(
    () => packets.buildMeasuringPacket({ date: 1, weightKg: 700 }),
    /weightKg out of range/
  );
});

test('the packet parser passes through unknown packet types', () => {
  const frame = packets.buildPacket(0x42, Buffer.from([1, 2, 3]));
  const packet = protocol.parsePacket(frame);

  assert.equal(packet.packetType, 0x42);
  assert.deepEqual(packet.data, Buffer.from([1, 2, 3]));
});
