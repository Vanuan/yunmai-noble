'use strict';

function numberFromEnv(env, name) {
  if (env[name] === undefined || env[name] === '') return undefined;
  const value = Number(env[name]);
  return isFinite(value) ? value : undefined;
}

function booleanFromEnv(env, name) {
  if (env[name] === undefined || env[name] === '') return undefined;
  return ['1', 'true', 'yes', 'on'].indexOf(String(env[name]).toLowerCase()) !== -1;
}

function simulatorOptionsFromEnv(env) {
  const options = {};
  const assign = function(key, value) {
    if (value !== undefined) options[key] = value;
  };

  assign('name', env.SIMULATOR_NAME);
  assign('weightKg', numberFromEnv(env, 'SIMULATOR_WEIGHT_KG'));
  assign('steps', numberFromEnv(env, 'SIMULATOR_STEPS'));
  assign('intervalMs', numberFromEnv(env, 'SIMULATOR_INTERVAL_MS'));
  assign('cycleDelayMs', numberFromEnv(env, 'SIMULATOR_CYCLE_DELAY_MS'));
  assign('scanDelayMs', numberFromEnv(env, 'SIMULATOR_SCAN_DELAY_MS'));
  assign('repeat', booleanFromEnv(env, 'SIMULATOR_REPEAT'));
  assign('autoStart', booleanFromEnv(env, 'SIMULATOR_AUTO_START'));
  assign('verbose', booleanFromEnv(env, 'SIMULATOR_VERBOSE'));

  return options;
}

// Returns a noble-compatible Bluetooth link. The simulator implements the same
// events and GATT method signatures, so the rest of the app does not change.
function createLink(options) {
  options = options || {};
  const driver = options.driver || process.env.BLE_DRIVER || 'noble';

  if (driver === 'noble') {
    return require('@abandonware/noble');
  }

  if (driver === 'simulator') {
    const simulatorOptions = Object.assign(
      {},
      simulatorOptionsFromEnv(process.env),
      options.simulator
    );
    return require('./simulator').createLink(simulatorOptions);
  }

  throw new Error('Unknown BLE_DRIVER "' + driver + '" (expected "noble" or "simulator")');
}

module.exports = {
  createLink: createLink,
  simulatorOptionsFromEnv: simulatorOptionsFromEnv
};
