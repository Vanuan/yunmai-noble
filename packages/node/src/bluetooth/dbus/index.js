'use strict';

const EventEmitter = require('events');

const DEFAULT_NAME_FILTER = 'YUNMAI';
const DEFAULT_SCAN_INTERVAL_MS = 1000;
const DEFAULT_CONNECT_POLL_MS = 1000;
const UUID_SUFFIX = '-0000-1000-8000-00805f9b34fb';
const DBUS_INIT_ERROR = /DBusError|org\.freedesktop\.DBus|AppArmor|SELinux|No available adapters|ECONNREFUSED|ENOENT.*dbus/i;

function expandUuid(uuid) {
  const value = String(uuid).toLowerCase();
  if (/^[0-9a-f]{4}$/.test(value)) {
    return '0000' + value + UUID_SUFFIX;
  }
  if (/^[0-9a-f]{8}$/.test(value)) {
    return value + UUID_SUFFIX;
  }
  return value;
}

function normalizeUuids(uuids) {
  if (!uuids) return [];
  return uuids.map(expandUuid);
}

function loadNodeBle() {
  try {
    return require('node-ble');
  } catch (error) {
    throw new Error(
      'BLE_DRIVER=dbus requires the "node-ble" package: ' + error.message
    );
  }
}

class DbusCharacteristic extends EventEmitter {
  constructor(uuid, characteristic) {
    super();
    this.uuid = uuid;
    this._characteristic = characteristic;
    this._subscribed = false;

    const self = this;
    this._onValue = function(value) {
      if (self._subscribed) {
        self.emit('data', value, true);
      }
    };
    this._characteristic.on('valuechanged', this._onValue);
  }

  subscribe(callback) {
    const self = this;
    this._characteristic.startNotifications()
      .then(function() {
        self._subscribed = true;
        if (callback) callback(null);
      })
      .catch(function(error) {
        if (callback) callback(error);
      });
  }

  unsubscribe(callback) {
    const self = this;
    this._subscribed = false;
    this._characteristic.stopNotifications()
      .then(function() {
        if (callback) callback(null);
      })
      .catch(function(error) {
        if (callback) callback(error);
      });
  }

  write(data, withoutResponse, callback) {
    if (typeof withoutResponse === 'function') {
      callback = withoutResponse;
      withoutResponse = false;
    }

    const characteristic = this._characteristic;
    const write = withoutResponse && characteristic.writeValueWithoutResponse
      ? characteristic.writeValueWithoutResponse.bind(characteristic)
      : characteristic.writeValue.bind(characteristic);

    Promise.resolve(write(data))
      .then(function() {
        if (callback) callback(null);
      })
      .catch(function(error) {
        if (callback) callback(error);
      });
  }

  read(callback) {
    this._characteristic.readValue()
      .then(function(value) {
        if (callback) callback(null, value);
      })
      .catch(function(error) {
        if (callback) callback(error);
      });
  }

  dispose() {
    this._subscribed = false;
    if (this._characteristic.removeListener) {
      this._characteristic.removeListener('valuechanged', this._onValue);
    }
  }
}

class DbusService {
  constructor(uuid, service) {
    this.uuid = uuid;
    this._service = service;
    this._characteristics = [];
  }

  discoverCharacteristics(uuids, callback) {
    const requested = normalizeUuids(uuids);
    if (requested.length === 0) {
      callback(new Error('dbus driver requires explicit characteristic UUIDs'));
      return;
    }

    const self = this;
    Promise.all(requested.map(function(uuid) {
      return self._service.getCharacteristic(uuid)
        .then(function(characteristic) {
          const wrapped = new DbusCharacteristic(uuid, characteristic);
          self._characteristics.push(wrapped);
          return wrapped;
        })
        .catch(function() {
          return null;
        });
    })).then(function(characteristics) {
      callback(null, characteristics.filter(Boolean));
    }).catch(function(error) {
      callback(error);
    });
  }

  dispose() {
    const characteristics = this._characteristics;
    this._characteristics = [];
    characteristics.forEach(function(characteristic) {
      characteristic.dispose();
    });
  }
}

class DbusPeripheral extends EventEmitter {
  constructor(options) {
    super();
    this.uuid = options.address;
    this.id = options.address;
    this.address = options.address;
    this.state = 'disconnected';
    this.advertisement = {
      localName: options.localName
    };

    this._device = options.device;
    this._logger = options.logger;
    this._connectPollMs = options.connectPollMs;
    this._connectTimer = null;
    this._gatt = null;
    this._services = [];
  }

  connect(options, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = null;
    }

    const self = this;
    this._device.connect()
      .then(function() {
        self.state = 'connected';
        if (callback) callback(null);
        self.emit('connect');
        self._startDisconnectMonitor();
      })
      .catch(function(error) {
        if (callback) callback(error);
      });
  }

  disconnect(options, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = null;
    }

    if (this.state === 'disconnected') {
      if (callback) process.nextTick(function() { callback(null); });
      return;
    }

    const self = this;
    this._stopDisconnectMonitor();
    Promise.resolve(this._device.disconnect())
      .then(function() {
        self.state = 'disconnected';
        self._disposeServices();
        if (callback) callback(null);
        self.emit('disconnect');
      })
      .catch(function(error) {
        if (callback) callback(error);
      });
  }

  discoverServices(uuids, callback) {
    const requested = normalizeUuids(uuids);
    if (requested.length === 0) {
      callback(new Error('dbus driver requires explicit service UUIDs'));
      return;
    }

    const self = this;
    this._getGatt()
      .then(function(gatt) {
        return Promise.all(requested.map(function(uuid) {
          return gatt.getPrimaryService(uuid)
            .then(function(service) {
              const wrapped = new DbusService(uuid, service);
              self._services.push(wrapped);
              return wrapped;
            })
            .catch(function() {
              return null;
            });
        }));
      })
      .then(function(services) {
        callback(null, services.filter(Boolean));
      })
      .catch(function(error) {
        callback(error);
      });
  }

  _getGatt() {
    if (this._gatt) return Promise.resolve(this._gatt);

    const self = this;
    return this._device.gatt().then(function(gatt) {
      self._gatt = gatt;
      return gatt;
    });
  }

  _startDisconnectMonitor() {
    const self = this;
    this._stopDisconnectMonitor();
    this._connectTimer = setInterval(function() {
      self._device.isConnected()
        .then(function(connected) {
          if (!connected) self._handleDisconnect();
        })
        .catch(function() {
          self._handleDisconnect();
        });
    }, this._connectPollMs);

    if (this._connectTimer.unref) this._connectTimer.unref();
  }

  _stopDisconnectMonitor() {
    clearInterval(this._connectTimer);
    this._connectTimer = null;
  }

  _handleDisconnect() {
    if (this.state === 'disconnected') return;

    this.state = 'disconnected';
    this._stopDisconnectMonitor();
    this._disposeServices();
    this.emit('disconnect');
  }

  _disposeServices() {
    const services = this._services;
    this._services = [];
    this._gatt = null;
    services.forEach(function(service) {
      service.dispose();
    });
  }

  dispose() {
    this._stopDisconnectMonitor();
    this._disposeServices();
  }
}

class DbusLink extends EventEmitter {
  constructor(options) {
    super();
    options = options || {};

    const self = this;

    this._logger = options.logger || console;
    this._nameFilter = String(
      options.nameFilter || process.env.YUNMAI_DEVICE_NAME || DEFAULT_NAME_FILTER
    ).toUpperCase();
    this._scanIntervalMs = options.scanIntervalMs || DEFAULT_SCAN_INTERVAL_MS;
    this._connectPollMs = options.connectPollMs || DEFAULT_CONNECT_POLL_MS;
    this._createBluetooth = options.createBluetooth || loadNodeBle().createBluetooth;

    this._bluetooth = null;
    this._destroyBus = null;
    this._adapter = null;
    this._scanning = false;
    this._scanTimer = null;
    this._scanInFlight = false;
    this._seen = new Set();
    this._peripherals = [];
    this._destroyed = false;
    this._lastState = null;

    // dbus-next rethrows a failed D-Bus Hello call after emitting it on the
    // bus. Keep that dependency bug from crashing the whole node; unrelated
    // unhandled rejections keep the default behavior.
    this._onUnhandledRejection = function(reason) {
      const message = reason && reason.message ? reason.message : String(reason);
      if (!DBUS_INIT_ERROR.test(message)) {
        process.nextTick(function() { throw reason; });
        return;
      }
      self._logger.error('dbus: ' + message);
      self._emitState('unsupported');
    };
    process.on('unhandledRejection', this._onUnhandledRejection);

    this._init();
  }

  _init() {
    const self = this;
    Promise.resolve()
      .then(function() {
        const session = self._createBluetooth();
        self._bluetooth = session.bluetooth;
        self._destroyBus = session.destroy;

        if (self._bluetooth.dbus && self._bluetooth.dbus.on) {
          self._bluetooth.dbus.on('error', function(error) {
            self._logger.error('dbus: bus error: ' + (error.message || error));
            self._emitState('unsupported');
          });
        }

        return self._bluetooth.defaultAdapter();
      })
      .then(function(adapter) {
        self._adapter = adapter;
        return adapter.isPowered()
          .catch(function() { return false; })
          .then(function(powered) {
            self._emitState(powered ? 'poweredOn' : 'poweredOff');
          });
      })
      .catch(function(error) {
        self._logger.error('dbus: Bluetooth initialization failed: ' + error.message);
        self._emitState('unsupported');
      });
  }

  _emitState(state) {
    if (this._destroyed || this._lastState === state) return;
    this._lastState = state;
    this.emit('stateChange', state);
  }

  startScanning() {
    if (this._scanning || this._destroyed || !this._adapter) return;

    this._scanning = true;
    this._seen.clear();

    const self = this;
    this._adapter.startDiscovery()
      .catch(function(error) {
        self._logger.error('dbus: startDiscovery failed: ' + error.message);
      })
      .then(function() {
        self._scan();
      });

    this._scanTimer = setInterval(function() {
      self._scan();
    }, this._scanIntervalMs);

    if (this._scanTimer.unref) this._scanTimer.unref();
  }

  stopScanning() {
    this._scanning = false;
    clearInterval(this._scanTimer);
    this._scanTimer = null;

    if (this._adapter) {
      this._adapter.stopDiscovery().catch(function() {});
    }
  }

  _scan() {
    if (!this._scanning || this._scanInFlight || !this._adapter) return;

    const self = this;
    this._scanInFlight = true;

    this._adapter.devices()
      .then(function(addresses) {
        return addresses.reduce(function(chain, address) {
          return chain.then(function() {
            return self._considerAddress(address);
          });
        }, Promise.resolve());
      })
      .catch(function(error) {
        self._logger.error('dbus: scan failed: ' + error.message);
      })
      .then(function() {
        self._scanInFlight = false;
      });
  }

  _considerAddress(address) {
    const self = this;
    if (!this._scanning || this._seen.has(address)) return Promise.resolve();

    return this._adapter.getDevice(address)
      .then(function(device) {
        return self._findMatchingName(device).then(function(localName) {
          if (!localName || !self._scanning) return;

          self._seen.add(address);
          const peripheral = new DbusPeripheral({
            address: address,
            localName: localName,
            device: device,
            logger: self._logger,
            connectPollMs: self._connectPollMs
          });
          self._peripherals.push(peripheral);
          self.emit('discover', peripheral);
        });
      })
      .catch(function(error) {
        self._logger.error('dbus: failed to inspect ' + address + ': ' + error.message);
      });
  }

  _findMatchingName(device) {
    const self = this;
    const candidates = [];

    function addCandidate(value) {
      if (Buffer.isBuffer(value)) value = value.toString('utf8');
      if (typeof value === 'string' && value) candidates.push(value);
    }

    return Promise.resolve()
      .then(function() { return device.getAlias(); })
      .then(addCandidate, function() {})
      .then(function() { return device.getName(); })
      .then(addCandidate, function() {})
      .then(function() { return device.getAdvertisingData(); })
      .then(function(data) {
        if (data && typeof data === 'object') {
          Object.keys(data).forEach(function(key) {
            addCandidate(data[key]);
          });
        }
      }, function() {})
      .then(function() {
        return candidates.reduce(function(found, candidate) {
          if (found) return found;
          return self._matches(candidate) ? candidate : null;
        }, null);
      });
  }

  _matches(name) {
    return String(name).toUpperCase().indexOf(this._nameFilter) !== -1;
  }

  destroy() {
    this._destroyed = true;
    this.stopScanning();
    process.removeListener('unhandledRejection', this._onUnhandledRejection);
    this._lastState = null;

    this._peripherals.forEach(function(peripheral) {
      peripheral.dispose();
    });
    this._peripherals = [];

    if (this._destroyBus) {
      try {
        this._destroyBus();
      } catch (error) {
        // The bus may already be gone.
      }
      this._destroyBus = null;
    }

    this.removeAllListeners();
  }
}

function createLink(options) {
  return new DbusLink(options);
}

module.exports = {
  createLink: createLink,
  expandUuid: expandUuid,
  DbusLink: DbusLink,
  DbusPeripheral: DbusPeripheral,
  DbusService: DbusService,
  DbusCharacteristic: DbusCharacteristic
};
