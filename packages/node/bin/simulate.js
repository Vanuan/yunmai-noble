#!/usr/bin/env node
'use strict';

const readline = require('readline');
const packets = require('../src/bluetooth/simulator/packets');
const protocol = require('../src/yunmai/protocol');
const simulator = require('../src/bluetooth/simulator');

const link = simulator.createLink({
  logger: console,
  autoStart: false,
  repeat: false
});

let peripheral = null;
let characteristic = null;
let shuttingDown = false;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});
rl.setPrompt('simulator> ');

function describe(buffer) {
  let packet;
  try {
    packet = protocol.parsePacket(buffer);
  } catch (error) {
    return 'unparsable frame (' + buffer.length + ' bytes)';
  }

  if (packet.packetType === protocol.PacketType.MEASURING) {
    const measurement = protocol.parseWeightingProgress(packet.data);
    return 'measuring ' + (measurement.weight / 100).toFixed(2) + ' kg' +
      ' at ' + new Date(measurement.date * 1000).toISOString();
  }

  if (packet.packetType === protocol.PacketType.MEASURED) {
    const measurement = protocol.parseWeightingCompleted(packet.data);
    return (measurement.historicalInfo ? 'historical' : 'measured') + ' ' +
      (measurement.weight / 100).toFixed(2) + ' kg' +
      ', fat ' + measurement.fatPercentage +
      ', resistance ' + measurement.resistance +
      ', user ' + measurement.userId +
      ' at ' + new Date(measurement.date * 1000).toISOString();
  }

  if (packet.packetType >= 0x80) {
    return 'ack 0x' + (packet.packetType & 0x7f).toString(16) +
      ' status ' + packet.data[0];
  }

  return 'packet type 0x' + packet.packetType.toString(16);
}

function printHelp() {
  console.log([
    'start          begin a simulated weighing',
    'stop           stop the current weighing',
    'history        emit stored measurements',
    'unit kg|lb     set the scale unit',
    'user <id>      set the measurement user id',
    'disconnect     disconnect and exit',
    'quit           exit'
  ].join('\n'));
}

function fail(error) {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
}

function sendCommand(type, payload) {
  if (!characteristic) {
    console.log('Not connected yet');
    return;
  }
  const frame = packets.buildCommand(type, payload);
  console.log('-> write      ' + frame.toString('hex'));
  characteristic.write(frame, function(error) {
    if (error) fail(error);
  });
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;

  if (characteristic) characteristic.unsubscribe();
  if (peripheral && peripheral.state !== 'disconnected') peripheral.disconnect();
  rl.close();
  process.exit(0);
}

function handleLine(line) {
  const parts = line.trim().split(/\s+/);
  const command = (parts[0] || '').toLowerCase();

  if (!command) return;
  if (command === 'help') return printHelp();
  if (command === 'quit' || command === 'exit') return shutdown();
  if (command === 'disconnect') return shutdown();

  if (command === 'start') return sendCommand(packets.CommandType.START_MEASUREMENT);
  if (command === 'stop') return sendCommand(packets.CommandType.STOP_MEASUREMENT);
  if (command === 'history') return sendCommand(packets.CommandType.REQUEST_HISTORY);

  if (command === 'unit') {
    const unit = (parts[1] || '').toLowerCase();
    if (unit !== 'kg' && unit !== 'lb') {
      console.log('Usage: unit kg|lb');
      return;
    }
    return sendCommand(packets.CommandType.SET_UNIT, Buffer.from([unit === 'kg' ? 0 : 1]));
  }

  if (command === 'user') {
    const userId = parseInt(parts[1], 10);
    if (isNaN(userId) || userId < 0) {
      console.log('Usage: user <id>');
      return;
    }
    const payload = Buffer.alloc(4);
    payload.writeUInt32BE(userId >>> 0, 0);
    return sendCommand(packets.CommandType.SET_USER, payload);
  }

  console.log('Unknown command: ' + command + ' (type "help")');
}

rl.on('line', function(line) {
  handleLine(line);
  if (!shuttingDown) rl.prompt();
});
rl.on('close', shutdown);

link.on('stateChange', function(state) {
  if (state === 'poweredOn') link.startScanning();
});

link.on('discover', function(found) {
  peripheral = found;
  console.log('Discovered ' + found.advertisement.localName);

  found.connect(function(error) {
    if (error) return fail(error);
    console.log('Connected');

    found.discoverServices(['ffe0'], function(error, services) {
      if (error) return fail(error);
      if (!services.length) return fail(new Error('Service ffe0 not found'));

      services[0].discoverCharacteristics(['ffe4'], function(error, characteristics) {
        if (error) return fail(error);
        if (!characteristics.length) return fail(new Error('Characteristic ffe4 not found'));

        characteristic = characteristics[0];
        characteristic.on('data', function(data, isNotification) {
          const direction = isNotification ? '<- notify' : '<- read  ';
          console.log(direction + '   ' + data.toString('hex') + '  ' + describe(data));
        });

        characteristic.subscribe(function(error) {
          if (error) return fail(error);
          console.log('Subscribed to ffe4. Type "help" for commands.');
          rl.prompt();
        });
      });
    });
  });
});

process.on('SIGINT', shutdown);
