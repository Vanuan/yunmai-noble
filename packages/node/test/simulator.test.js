'use strict';

const { test } = require('bun:test');
const assert = require('node:assert/strict');

const simulator = require('../src/bluetooth/simulator');
const packets = require('../src/bluetooth/simulator/packets');
const protocol = require('../src/yunmai/protocol');

const SILENT_LOGGER = {
  log: function() {},
  error: function() {}
};

function delay(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

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

function openScale(options) {
  const link = simulator.createLink(Object.assign({
    logger: SILENT_LOGGER,
    scanDelayMs: 1
  }, options));

  return new Promise(function(resolve, reject) {
    link.once('stateChange', function(state) {
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

            const characteristic = characteristics[0];
            characteristic.subscribe(function(error) {
              if (error) return reject(error);
              resolve({
                link: link,
                peripheral: peripheral,
                characteristic: characteristic
              });
            });
          });
        });
      });
    });
  });
}

async function closeScale(context) {
  context.characteristic.unsubscribe();
  context.peripheral.disconnect();
  context.link.destroy();
  await delay(5);
}

test('emits measurements and responds to commands', async function() {
  const context = await openScale({
    autoStart: false,
    repeat: false,
    steps: 2,
    intervalMs: 5,
    weightKg: 7.5,
    history: [
      { date: 1500000000, weightKg: 7.2, userId: 7 },
      { date: 1500000100, weightKg: 7.3, userId: 7 }
    ]
  });

  const received = [];
  context.characteristic.on('data', function(data, isNotification) {
    assert.equal(isNotification, true);
    received.push(protocol.parsePacket(data));
  });

  try {
    context.characteristic.write(packets.buildCommand(packets.CommandType.START_MEASUREMENT));

    await waitFor(function() {
      return received.some(function(packet) {
        return packet.packetType === protocol.PacketType.MEASURED;
      });
    }, 2000);

    const measuring = received.filter(function(packet) {
      return packet.packetType === protocol.PacketType.MEASURING;
    });
    const measured = received.filter(function(packet) {
      return packet.packetType === protocol.PacketType.MEASURED;
    });

    assert.equal(measuring.length, 2);
    assert.equal(measured.length, 1);

    const weights = measuring.map(function(packet) {
      return protocol.parseWeightingProgress(packet.data).weight;
    });
    assert.deepEqual(weights, [790, 770]);

    const completed = protocol.parseWeightingCompleted(measured[0].data);
    assert.equal(completed.historicalInfo, 0);
    assert.equal(completed.weight, 750);

    context.characteristic.write(packets.buildCommand(packets.CommandType.REQUEST_HISTORY));

    await waitFor(function() {
      return received.some(function(packet) {
        return packet.packetType === 0x92;
      });
    }, 2000);

    const history = received.filter(function(packet) {
      return packet.packetType === protocol.PacketType.MEASURED && packet.data[0] === 1;
    });
    const ack = received.filter(function(packet) {
      return packet.packetType === 0x92;
    })[0];

    assert.equal(history.length, 2);
    assert.equal(ack.data[0], packets.AckStatus.OK);
    assert.equal(protocol.parseWeightingCompleted(history[0].data).weight, 720);
    assert.equal(protocol.parseWeightingCompleted(history[1].data).weight, 730);
    assert.equal(protocol.parseWeightingCompleted(history[0].data).userId, 7);
  } finally {
    await closeScale(context);
  }
});

test('stop command stops the measurement stream', async function() {
  const context = await openScale({
    autoStart: true,
    repeat: false,
    steps: 1000,
    intervalMs: 5
  });

  const received = [];
  context.characteristic.on('data', function(data) {
    received.push(protocol.parsePacket(data));
  });

  try {
    await waitFor(function() { return received.length > 0; }, 2000);

    context.characteristic.write(packets.buildCommand(packets.CommandType.STOP_MEASUREMENT));
    await waitFor(function() {
      return received.some(function(packet) { return packet.packetType === 0x91; });
    }, 2000);

    const count = received.filter(function(packet) {
      return packet.packetType === protocol.PacketType.MEASURING;
    }).length;
    await delay(30);

    assert.equal(
      received.filter(function(packet) {
        return packet.packetType === protocol.PacketType.MEASURING;
      }).length,
      count
    );
  } finally {
    await closeScale(context);
  }
});

test('unsubscribing stops the measurement stream', async function() {
  const context = await openScale({
    autoStart: true,
    repeat: false,
    steps: 1000,
    intervalMs: 5
  });

  const received = [];
  context.characteristic.on('data', function(data) {
    received.push(protocol.parsePacket(data));
  });

  try {
    await waitFor(function() { return received.length > 0; }, 2000);

    context.characteristic.unsubscribe();
    const count = received.length;
    await delay(30);

    assert.equal(received.length, count);
  } finally {
    await closeScale(context);
  }
});
