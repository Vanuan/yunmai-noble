'use strict';

const Parser = require('binary-parser').Parser;

const SIGNATURE = 0x55;
const HEADER_SIZE = 4;
const PACKET_OVERHEAD = HEADER_SIZE + 1;

const PacketType = {
  MEASURING: 0x01,
  MEASURED: 0x02
};

const packetParser = new Parser()
  .uint8('packetSignature')
  .uint8('firmwareVersion')
  .uint8('packetLength')
  .uint8('packetType')
  .buffer('data', {
    type: 'int32',
    // binary-parser compiles this function in an isolated scope, so it cannot
    // reference PACKET_OVERHEAD (header + checksum).
    length: function() { return this.packetLength - 5; }
  })
  .uint8('checksum');

const weightingProgressParser = new Parser()
  .uint32be('date')
  .uint16be('weight');

const weightingCompletedParser = new Parser()
  .uint8('historicalInfo')
  .uint32be('date')
  .uint32be('userId')
  .uint16be('weight')
  .uint16be('resistance')
  .uint16be('fatPercentage');

function parsePacket(buffer) {
  return packetParser.parse(buffer);
}

function parseWeightingProgress(buffer) {
  return weightingProgressParser.parse(buffer);
}

function parseWeightingCompleted(buffer) {
  return weightingCompletedParser.parse(buffer);
}

module.exports = {
  SIGNATURE,
  HEADER_SIZE,
  PACKET_OVERHEAD,
  PacketType,
  parsePacket,
  parseWeightingProgress,
  parseWeightingCompleted
};
