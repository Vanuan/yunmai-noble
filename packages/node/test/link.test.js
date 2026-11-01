'use strict';

const { test } = require('bun:test');
const assert = require('node:assert/strict');

const bluetooth = require('../src/bluetooth');
const simulator = require('../src/bluetooth/simulator');

const SILENT_LOGGER = {
  log: function() {},
  error: function() {}
};

function discoverServices(peripheral, uuids) {
  return new Promise(function(resolve, reject) {
    peripheral.discoverServices(uuids, function(error, services) {
      if (error) return reject(error);
      resolve(services);
    });
  });
}

function discoverCharacteristics(service, uuids) {
  return new Promise(function(resolve, reject) {
    service.discoverCharacteristics(uuids, function(error, characteristics) {
      if (error) return reject(error);
      resolve(characteristics);
    });
  });
}

function connect(peripheral) {
  return new Promise(function(resolve, reject) {
    peripheral.connect(function(error) {
      if (error) return reject(error);
      resolve();
    });
  });
}

function disconnect(peripheral) {
  return new Promise(function(resolve, reject) {
    peripheral.disconnect(function(error) {
      if (error) return reject(error);
      resolve();
    });
  });
}

test('the link factory builds a simulator and rejects unknown drivers', function() {
  const link = bluetooth.createLink({
    driver: 'simulator',
    simulator: { scanDelayMs: 1 }
  });

  assert.equal(typeof link.startScanning, 'function');
  link.destroy();

  assert.throws(
    function() { bluetooth.createLink({ driver: 'unknown' }); },
    /Unknown BLE_DRIVER/
  );
});

test('simulator options are parsed from the environment', function() {
  const options = bluetooth.simulatorOptionsFromEnv({
    SIMULATOR_NAME: 'YUNMAI-ENV',
    SIMULATOR_WEIGHT_KG: '70.5',
    SIMULATOR_STEPS: '3',
    SIMULATOR_INTERVAL_MS: '10',
    SIMULATOR_CYCLE_DELAY_MS: '20',
    SIMULATOR_SCAN_DELAY_MS: '5',
    SIMULATOR_REPEAT: 'false',
    SIMULATOR_AUTO_START: 'no'
  });

  assert.deepEqual(options, {
    name: 'YUNMAI-ENV',
    weightKg: 70.5,
    steps: 3,
    intervalMs: 10,
    cycleDelayMs: 20,
    scanDelayMs: 5,
    repeat: false,
    autoStart: false
  });

  assert.deepEqual(
    bluetooth.simulatorOptionsFromEnv({ SIMULATOR_STEPS: 'not-a-number' }),
    {}
  );
});

test('the simulated link exposes the Yunmai GATT layout', async function() {
  const link = simulator.createLink({
    scanDelayMs: 1,
    logger: SILENT_LOGGER
  });

  try {
    const peripheral = await new Promise(function(resolve, reject) {
      link.once('stateChange', function(state) {
        if (state === 'poweredOn') link.startScanning();
      });
      link.once('discover', resolve);
      link.once('error', reject);
    });

    assert.equal(peripheral.advertisement.localName, 'YUNMAI-SIM');

    const missingServices = await discoverServices(peripheral, ['fff0']);
    assert.equal(missingServices.length, 0);

    const services = await discoverServices(peripheral, ['ffe0']);
    assert.equal(services.length, 1);
    assert.equal(services[0].uuid, 'ffe0');

    const missingCharacteristics = await discoverCharacteristics(services[0], ['fff1']);
    assert.equal(missingCharacteristics.length, 0);

    const characteristics = await discoverCharacteristics(services[0], ['FFE4']);
    assert.equal(characteristics.length, 1);
    assert.equal(characteristics[0].uuid, 'ffe4');

    await connect(peripheral);
    assert.equal(peripheral.state, 'connected');

    const disconnected = new Promise(function(resolve) {
      peripheral.once('disconnect', resolve);
    });
    await disconnect(peripheral);
    await disconnected;
    assert.equal(peripheral.state, 'disconnected');
  } finally {
    link.destroy();
  }
});
