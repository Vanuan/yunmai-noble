'use strict';

const assert = require('assert');
const simulator = require('../src/bluetooth/simulator');
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

const link = simulator.createLink({
  logger: SILENT_LOGGER,
  scanDelayMs: 1,
  intervalMs: 2,
  steps: 2,
  cycleDelayMs: 0,
  repeat: false,
  autoStart: false,
  history: [
    { date: 1500000000, weightKg: 7.2, userId: 7 },
    { date: 1500000100, weightKg: 7.3, userId: 7 }
  ]
});

const received = [];
let characteristic = null;

const connected = new Promise(function(resolve, reject) {
  link.on('stateChange', function(state) {
    if (state === 'poweredOn') link.startScanning();
  });

  link.on('discover', function(peripheral) {
    peripheral.connect(function(error) {
      if (error) return reject(error);

      peripheral.discoverServices(['ffe0'], function(error, services) {
        if (error) return reject(error);
        if (!services.length) return reject(new Error('Service not found'));

        services[0].discoverCharacteristics(['ffe4'], function(error, characteristics) {
          if (error) return reject(error);
          if (!characteristics.length) return reject(new Error('Characteristic not found'));

          characteristic = characteristics[0];
          characteristic.on('data', function(data) {
            received.push(protocol.parsePacket(data));
          });

          characteristic.subscribe(function(error) {
            if (error) return reject(error);
            resolve();
          });
        });
      });
    });
  });
});

connected.then(function() {
  characteristic.write(packets.buildCommand(packets.CommandType.START_MEASUREMENT));
  return waitFor(function() {
    return received.some(function(packet) {
      return packet.packetType === protocol.PacketType.MEASURED;
    });
  }, 2000);
}).then(function() {
  const measuring = received.filter(function(packet) {
    return packet.packetType === protocol.PacketType.MEASURING;
  });
  const measured = received.filter(function(packet) {
    return packet.packetType === protocol.PacketType.MEASURED;
  });

  assert.strictEqual(measuring.length, 2);
  assert.strictEqual(measured.length, 1);

  const weights = measuring.map(function(packet) {
    return protocol.parseWeightingProgress(packet.data).weight;
  });
  assert.deepStrictEqual(weights, [790, 770]);

  const completed = protocol.parseWeightingCompleted(measured[0].data);
  assert.strictEqual(completed.historicalInfo, 0);
  assert.strictEqual(completed.weight, 750);

  characteristic.write(packets.buildCommand(packets.CommandType.REQUEST_HISTORY));
  return waitFor(function() {
    return received.some(function(packet) {
      return packet.packetType === 0x92;
    });
  }, 2000);
}).then(function() {
  const history = received.filter(function(packet) {
    return packet.packetType === protocol.PacketType.MEASURED && packet.data[0] === 1;
  });
  const ack = received.filter(function(packet) {
    return packet.packetType === 0x92;
  })[0];

  assert.strictEqual(history.length, 2);
  assert.strictEqual(ack.data[0], packets.AckStatus.OK);

  const first = protocol.parseWeightingCompleted(history[0].data);
  const second = protocol.parseWeightingCompleted(history[1].data);
  assert.strictEqual(first.weight, 720);
  assert.strictEqual(second.weight, 730);
  assert.strictEqual(first.userId, 7);

  characteristic.unsubscribe();
  link.destroy();
  console.log('ok - simulated scale emits measurements and responds to commands');
}).catch(function(error) {
  console.error('not ok - simulated scale emits measurements and responds to commands');
  console.error(error.stack);
  link.destroy();
  process.exit(1);
});
