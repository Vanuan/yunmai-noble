'use strict';

const protocol = require('../../yunmai/protocol');

const SIGNATURE = protocol.SIGNATURE;
const VERSION = 0x01;
const PACKET_OVERHEAD = protocol.PACKET_OVERHEAD;
const PacketType = protocol.PacketType;

// Simulator-defined command frames. The real Yunmai command protocol has not
// been reverse engineered yet; align these values once it is known.
const CommandType = {
  START_MEASUREMENT: 0x10,
  STOP_MEASUREMENT: 0x11,
  REQUEST_HISTORY: 0x12,
  SET_UNIT: 0x13,
  SET_USER: 0x14
};

const AckStatus = {
  OK: 0x00,
  UNSUPPORTED: 0x01,
  INVALID_ARGUMENT: 0x02
};

function checksum(buffer) {
  let sum = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    sum = (sum + buffer[index]) & 0xff;
  }
  return sum;
}

function buildPacket(type, payload) {
  payload = payload || Buffer.alloc(0);
  const length = payload.length + PACKET_OVERHEAD;
  if (length > 0xff) {
    throw new RangeError('Packet too long: ' + length + ' bytes');
  }

  const packet = Buffer.alloc(length);
  packet[0] = SIGNATURE;
  packet[1] = VERSION;
  packet[2] = length;
  packet[3] = type & 0xff;
  payload.copy(packet, 4);
  packet[length - 1] = checksum(packet.slice(0, length - 1));
  return packet;
}

function toUint32(value, name) {
  const number = Number(value);
  if (!isFinite(number) || number < 0 || number > 0xffffffff) {
    throw new RangeError(name + ' out of range');
  }
  return Math.floor(number) >>> 0;
}

function toUint16(value, name) {
  const number = Number(value);
  if (!isFinite(number) || number < 0 || number > 0xffff) {
    throw new RangeError(name + ' out of range');
  }
  return Math.round(number);
}

function toWeightHundredths(weightKg) {
  const weight = Number(weightKg);
  if (!isFinite(weight) || weight < 0) {
    throw new RangeError('weightKg out of range');
  }
  const hundredths = Math.round(weight * 100);
  if (hundredths > 0xffff) {
    throw new RangeError('weightKg out of range');
  }
  return hundredths;
}

function buildMeasuringPacket(measurement) {
  const payload = Buffer.alloc(6);
  payload.writeUInt32BE(toUint32(measurement.date, 'date'), 0);
  payload.writeUInt16BE(toWeightHundredths(measurement.weightKg), 4);
  return buildPacket(PacketType.MEASURING, payload);
}

function buildMeasuredPacket(measurement) {
  const payload = Buffer.alloc(15);
  payload.writeUInt8(measurement.historical ? 1 : 0, 0);
  payload.writeUInt32BE(toUint32(measurement.date, 'date'), 1);
  payload.writeUInt32BE(toUint32(measurement.userId || 0, 'userId'), 5);
  payload.writeUInt16BE(toWeightHundredths(measurement.weightKg), 9);
  payload.writeUInt16BE(toUint16(measurement.resistance || 0, 'resistance'), 11);
  payload.writeUInt16BE(toUint16(measurement.fatPercentage || 0, 'fatPercentage'), 13);
  return buildPacket(PacketType.MEASURED, payload);
}

function buildCommand(type, payload) {
  return buildPacket(type, payload);
}

function buildAckPacket(commandType, status) {
  return buildPacket((commandType | 0x80) & 0xff, Buffer.from([status & 0xff]));
}

function parseCommand(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < PACKET_OVERHEAD) {
    throw new Error('Command frame too short');
  }
  if (buffer[0] !== SIGNATURE) {
    throw new Error('Unexpected signature: 0x' + buffer[0].toString(16));
  }
  const length = buffer[2];
  if (length < PACKET_OVERHEAD || length !== buffer.length) {
    throw new Error('Command length mismatch: header says ' + length + ', got ' + buffer.length);
  }
  return {
    version: buffer[1],
    type: buffer[3],
    payload: buffer.slice(4, length - 1),
    checksum: buffer[length - 1]
  };
}

module.exports = {
  SIGNATURE,
  VERSION,
  PacketType,
  CommandType,
  AckStatus,
  checksum,
  buildPacket,
  buildMeasuringPacket,
  buildMeasuredPacket,
  buildCommand,
  buildAckPacket,
  parseCommand
};
