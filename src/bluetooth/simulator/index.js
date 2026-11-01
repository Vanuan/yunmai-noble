'use strict';

const EventEmitter = require('events');
const Scale = require('./scale');

const SILENT_LOGGER = {
  log: function() {},
  error: function() {}
};

function resolveLogger(options) {
  if (options.logger) return options.logger;
  if (options.verbose) return console;
  return SILENT_LOGGER;
}

function normalizeUuids(uuids) {
  if (!uuids) return [];
  return uuids.map(function(uuid) { return String(uuid).toLowerCase(); });
}

function uuidMatches(uuid, requested) {
  return requested.length === 0 || requested.indexOf(String(uuid).toLowerCase()) !== -1;
}

class SimulatedCharacteristic extends EventEmitter {
  constructor(uuid, scale) {
    super();
    this.uuid = uuid;
    this._scale = scale;
    this._subscribed = false;

    const self = this;
    this._scale.on('packet', function(packet) {
      self.notify(packet);
    });
  }

  subscribe(callback) {
    this._subscribed = true;
    this._scale.subscribe();
    if (callback) {
      process.nextTick(function() { callback(null); });
    }
  }

  unsubscribe(callback) {
    this._subscribed = false;
    this._scale.unsubscribe();
    if (callback) {
      process.nextTick(function() { callback(null); });
    }
  }

  notify(packet) {
    if (this._subscribed) {
      this.emit('data', packet, true);
    }
  }

  write(data, withoutResponse, callback) {
    if (typeof withoutResponse === 'function') {
      callback = withoutResponse;
      withoutResponse = false;
    }

    const self = this;
    this._scale.handleCommand(data).forEach(function(packet) {
      self.notify(packet);
    });

    if (callback) {
      process.nextTick(function() { callback(null); });
    }
  }

  read(callback) {
    if (callback) {
      process.nextTick(function() { callback(null, Buffer.alloc(0)); });
    }
  }
}

class SimulatedService {
  constructor(uuid, characteristic) {
    this.uuid = uuid;
    this._characteristic = characteristic;
  }

  discoverCharacteristics(uuids, callback) {
    const requested = normalizeUuids(uuids);
    const characteristics = uuidMatches(this._characteristic.uuid, requested)
      ? [this._characteristic]
      : [];

    if (callback) {
      process.nextTick(function() { callback(null, characteristics); });
    }
  }
}

class SimulatedPeripheral extends EventEmitter {
  constructor(options) {
    super();
    this.uuid = 'simulated-yunmai-scale';
    this.id = this.uuid;
    this.address = '00:00:00:00:00:00';
    this.addressType = 'public';
    this.connectable = true;
    this.rssi = -40;
    this.state = 'disconnected';
    this.advertisement = {
      localName: options.name
    };
    this._service = options.service;
  }

  connect(options, callback) {
    if (typeof options === 'function') {
      callback = options;
    }

    const self = this;
    process.nextTick(function() {
      if (self.state !== 'connected') {
        self.state = 'connected';
        self.emit('connect');
      }
      if (callback) callback(null);
    });
  }

  disconnect(options, callback) {
    if (typeof options === 'function') {
      callback = options;
    }

    const self = this;
    process.nextTick(function() {
      if (self.state !== 'disconnected') {
        self.state = 'disconnected';
        self.emit('disconnect');
      }
      if (callback) callback(null);
    });
  }

  discoverServices(uuids, callback) {
    const requested = normalizeUuids(uuids);
    const services = uuidMatches(this._service.uuid, requested) ? [this._service] : [];

    if (callback) {
      process.nextTick(function() { callback(null, services); });
    }
  }
}

class SimulatedLink extends EventEmitter {
  constructor(options) {
    super();
    options = options || {};

    this._logger = resolveLogger(options);
    this._scanDelayMs = options.scanDelayMs === undefined ? 200 : options.scanDelayMs;
    this._scanning = false;
    this._scanTimer = null;
    this._destroyed = false;

    this._scale = new Scale(Object.assign({}, options, { logger: this._logger }));
    this._characteristic = new SimulatedCharacteristic('ffe4', this._scale);
    this._service = new SimulatedService('ffe0', this._characteristic);
    this._peripheral = new SimulatedPeripheral({
      name: options.name || 'YUNMAI-SIM',
      service: this._service
    });

    const self = this;
    process.nextTick(function() {
      if (!self._destroyed) self.emit('stateChange', 'poweredOn');
    });
  }

  startScanning() {
    if (this._scanning || this._destroyed) return;
    this._scanning = true;

    const self = this;
    this._scanTimer = setTimeout(function() {
      self._scanTimer = null;
      if (!self._scanning || self._destroyed) return;
      self._scanning = false;
      self.emit('discover', self._peripheral);
    }, this._scanDelayMs);
  }

  stopScanning() {
    this._scanning = false;
    clearTimeout(this._scanTimer);
    this._scanTimer = null;
  }

  destroy() {
    this._destroyed = true;
    this.stopScanning();
    this._scale.unsubscribe();
    this.removeAllListeners();
  }
}

function createLink(options) {
  return new SimulatedLink(options);
}

module.exports = {
  createLink: createLink,
  SimulatedLink: SimulatedLink,
  SimulatedPeripheral: SimulatedPeripheral,
  SimulatedService: SimulatedService,
  SimulatedCharacteristic: SimulatedCharacteristic
};
