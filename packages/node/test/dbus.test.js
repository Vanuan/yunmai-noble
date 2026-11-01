'use strict';

const { test } = require('bun:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');

const dbus = require('../src/bluetooth/dbus');

const FFE0 = '0000ffe0-0000-1000-8000-00805f9b34fb';
const FFE4 = '0000ffe4-0000-1000-8000-00805f9b34fb';

const SILENT_LOGGER = {
  log: function() {},
  error: function() {}
};

class FakeCharacteristic extends EventEmitter {
  constructor(uuid) {
    super();
    this.uuid = uuid;
    this.notifying = false;
    this.writes = [];
  }

  async startNotifications() {
    this.notifying = true;
  }

  async stopNotifications() {
    this.notifying = false;
  }

  async writeValue(value) {
    this.writes.push(value);
  }

  async writeValueWithoutResponse(value) {
    this.writes.push(value);
  }

  async readValue() {
    return Buffer.alloc(0);
  }

  emitValue(value) {
    this.emit('valuechanged', value);
  }
}

class FakeService {
  constructor(uuid, characteristics) {
    this.uuid = uuid;
    this.characteristics = characteristics;
    this.requested = [];
  }

  async getCharacteristic(uuid) {
    this.requested.push(uuid);
    const characteristic = this.characteristics[uuid];
    if (!characteristic) throw new Error('Characteristic not available');
    return characteristic;
  }
}

class FakeGatt {
  constructor(services) {
    this.services = services;
    this.requested = [];
  }

  async getPrimaryService(uuid) {
    this.requested.push(uuid);
    const service = this.services[uuid];
    if (!service) throw new Error('Service not available');
    return service;
  }
}

class FakeDevice extends EventEmitter {
  constructor(address, name, gatt, alias) {
    super();
    this.address = address;
    this.name = name;
    this.alias = alias || name;
    this.gattServer = gatt;
    this.connected = false;
  }

  async getAlias() {
    return this.alias;
  }

  async getName() {
    return this.name;
  }

  async getAdvertisingData() {
    return {};
  }

  async connect() {
    this.connected = true;
  }

  async disconnect() {
    this.connected = false;
  }

  async isConnected() {
    return this.connected;
  }

  async gatt() {
    return this.gattServer;
  }
}

class FakeAdapter extends EventEmitter {
  constructor(devices) {
    super();
    this.devicesByAddress = devices;
    this.discovering = false;
    this.getDeviceCalls = 0;
  }

  async isPowered() {
    return true;
  }

  async isDiscovering() {
    return this.discovering;
  }

  async startDiscovery() {
    this.discovering = true;
  }

  async stopDiscovery() {
    this.discovering = false;
  }

  async devices() {
    return Object.keys(this.devicesByAddress);
  }

  async getDevice(address) {
    this.getDeviceCalls += 1;
    const device = this.devicesByAddress[address];
    if (!device) throw new Error('Device not found');
    return device;
  }
}

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

function fakeBluetooth(devices) {
  const adapter = new FakeAdapter(devices);
  return {
    adapter: adapter,
    createBluetooth: function() {
      return {
        bluetooth: {
          defaultAdapter: async function() { return adapter; }
        },
        destroy: function() {}
      };
    }
  };
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

function subscribe(characteristic) {
  return new Promise(function(resolve, reject) {
    characteristic.subscribe(function(error) {
      if (error) return reject(error);
      resolve();
    });
  });
}

function waitForState(link, expected) {
  return new Promise(function(resolve, reject) {
    const timer = setTimeout(function() {
      reject(new Error('Timed out waiting for state ' + expected));
    }, 1000);

    link.on('stateChange', function(state) {
      if (state === expected) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
}

function buildScale() {
  const characteristic = new FakeCharacteristic(FFE4);
  const service = new FakeService(FFE0, { [FFE4]: characteristic });
  const gatt = new FakeGatt({ [FFE0]: service });
  const device = new FakeDevice('AA:BB:CC:DD:EE:FF', 'YUNMAI-SIM', gatt);
  return {
    characteristic: characteristic,
    service: service,
    gatt: gatt,
    device: device
  };
}

test('expands short Bluetooth UUIDs', function() {
  assert.equal(dbus.expandUuid('ffe0'), FFE0);
  assert.equal(dbus.expandUuid('FFE4'), FFE4);
  assert.equal(dbus.expandUuid(FFE0), FFE0);
});

test('discovers, connects, subscribes, and forwards notifications', async function() {
  const scale = buildScale();
  const fake = fakeBluetooth({ [scale.device.address]: scale.device });
  const link = dbus.createLink({
    createBluetooth: fake.createBluetooth,
    scanIntervalMs: 1,
    connectPollMs: 5,
    logger: SILENT_LOGGER
  });

  try {
    await waitForState(link, 'poweredOn');

    const discovered = new Promise(function(resolve, reject) {
      link.once('discover', resolve);
      setTimeout(function() { reject(new Error('No discovery')); }, 1000);
    });
    link.startScanning();

    const peripheral = await discovered;
    assert.equal(peripheral.advertisement.localName, 'YUNMAI-SIM');

    await connect(peripheral);
    assert.equal(peripheral.state, 'connected');

    const services = await discoverServices(peripheral, ['ffe0']);
    assert.equal(services.length, 1);
    assert.equal(services[0].uuid, FFE0);
    assert.deepEqual(scale.gatt.requested, [FFE0]);

    const characteristics = await discoverCharacteristics(services[0], ['ffe4']);
    assert.equal(characteristics.length, 1);
    assert.deepEqual(scale.service.requested, [FFE4]);

    const dataEvent = new Promise(function(resolve) {
      characteristics[0].once('data', function(data, isNotification) {
        resolve({ data: data, isNotification: isNotification });
      });
    });

    await subscribe(characteristics[0]);
    scale.characteristic.emitValue(Buffer.from([1, 2, 3]));

    const event = await dataEvent;
    assert.deepEqual(event.data, Buffer.from([1, 2, 3]));
    assert.equal(event.isNotification, true);

    await new Promise(function(resolve, reject) {
      characteristics[0].write(Buffer.from([9]), function(error) {
        if (error) return reject(error);
        resolve();
      });
    });
    assert.deepEqual(scale.characteristic.writes[0], Buffer.from([9]));

    const disconnected = new Promise(function(resolve) {
      peripheral.once('disconnect', resolve);
    });
    await disconnect(peripheral);
    await disconnected;
  } finally {
    link.destroy();
  }
});

test('matches devices by name and ignores unrelated peripherals', async function() {
  const unrelated = new FakeDevice('11:11:11:11:11:11', 'OTHER-DEVICE', new FakeGatt({}));
  const scale = buildScale();
  scale.device.alias = scale.device.address;

  const fake = fakeBluetooth({
    [unrelated.address]: unrelated,
    [scale.device.address]: scale.device
  });
  const link = dbus.createLink({
    createBluetooth: fake.createBluetooth,
    scanIntervalMs: 1,
    connectPollMs: 5,
    logger: SILENT_LOGGER
  });

  try {
    await waitForState(link, 'poweredOn');

    const discovered = [];
    link.on('discover', function(peripheral) {
      discovered.push(peripheral);
    });
    link.startScanning();
    await delay(30);

    assert.equal(discovered.length, 1);
    assert.equal(discovered[0].address, scale.device.address);
    assert.equal(discovered[0].advertisement.localName, 'YUNMAI-SIM');
  } finally {
    link.destroy();
  }
});

test('reuses device proxies across scans', async function() {
  const unrelated = new FakeDevice('22:22:22:22:22:22', 'OTHER-DEVICE', new FakeGatt({}));
  const fake = fakeBluetooth({ [unrelated.address]: unrelated });
  const link = dbus.createLink({
    createBluetooth: fake.createBluetooth,
    scanIntervalMs: 1,
    connectPollMs: 5,
    logger: SILENT_LOGGER
  });

  try {
    await waitForState(link, 'poweredOn');
    link.startScanning();
    await delay(30);

    assert.equal(fake.adapter.getDeviceCalls, 1);
  } finally {
    link.destroy();
  }
});

test('emits disconnect when the underlying device drops', async function() {
  const scale = buildScale();
  const fake = fakeBluetooth({ [scale.device.address]: scale.device });
  const link = dbus.createLink({
    createBluetooth: fake.createBluetooth,
    scanIntervalMs: 1,
    connectPollMs: 5,
    logger: SILENT_LOGGER
  });

  try {
    await waitForState(link, 'poweredOn');

    const discovered = new Promise(function(resolve) {
      link.once('discover', resolve);
    });
    link.startScanning();

    const peripheral = await discovered;
    await connect(peripheral);

    const disconnected = new Promise(function(resolve) {
      peripheral.once('disconnect', resolve);
    });
    scale.device.connected = false;

    await disconnected;
    assert.equal(peripheral.state, 'disconnected');
  } finally {
    link.destroy();
  }
});

test('reports unsupported when the D-Bus bus emits an error', async function() {
  const bus = new EventEmitter();
  const link = dbus.createLink({
    createBluetooth: function() {
      return {
        bluetooth: {
          dbus: bus,
          defaultAdapter: function() { return new Promise(function() {}); }
        },
        destroy: function() {}
      };
    },
    logger: SILENT_LOGGER
  });

  try {
    await delay(0);
    const stateChange = waitForState(link, 'unsupported');
    bus.emit('error', new Error('access denied'));
    await stateChange;
  } finally {
    link.destroy();
  }
});

test('reports unsupported when the D-Bus adapter is unavailable', async function() {
  const link = dbus.createLink({
    createBluetooth: function() {
      return {
        bluetooth: {
          defaultAdapter: async function() { throw new Error('no system bus'); }
        },
        destroy: function() {}
      };
    },
    logger: SILENT_LOGGER
  });

  try {
    await waitForState(link, 'unsupported');
  } finally {
    link.destroy();
  }
});
