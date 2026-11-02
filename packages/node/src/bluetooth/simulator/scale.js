'use strict';

const EventEmitter = require('events');
const packets = require('./packets');

const DEFAULT_OPTIONS = {
  weightKg: 72.4,
  startOffsetKg: 0.4,
  steps: 8,
  intervalMs: 300,
  cycleDelayMs: 5000,
  // A simulated scale must not produce readings on its own: without these,
  // subscribing starts a weighing and every finished weighing starts another.
  // Demos that want a live feed set `repeat = true` in their config.
  repeat: false,
  autoStart: false,
  userId: 1,
  resistance: 0,
  fatPercentage: 0,
  history: null
};

const SILENT_LOGGER = {
  log: function() {},
  error: function() {}
};

function currentTimeInSeconds() {
  return Math.floor(Date.now() / 1000);
}

function roundWeight(weightKg) {
  return Math.round(weightKg * 100) / 100;
}

function defaultHistory() {
  const now = currentTimeInSeconds();
  return [
    { date: now - (3 * 86400), weightKg: 72.4, userId: 1 },
    { date: now - (2 * 86400), weightKg: 72.1, userId: 1 },
    { date: now - 86400, weightKg: 71.8, userId: 1 }
  ];
}

// Simulation of a Yunmai scale below the GATT layer: it emits measuring and
// measured frames and interprets command frames written to characteristic
// ffe4.
class Scale extends EventEmitter {
  constructor(options) {
    super();
    this.options = Object.assign({}, DEFAULT_OPTIONS, options);
    this.logger = this.options.logger || SILENT_LOGGER;
    this.history = this.options.history || defaultHistory();
    this.unit = 'kg';
    this.userId = this.options.userId;
    this.powered = true;
    this.subscribed = false;
    this.running = false;
    this.lastWeightKg = null;
    this.timer = null;
    this.step = 0;
  }

  subscribe() {
    this.subscribed = true;
    if (this.options.autoStart && this.powered) this.start();
  }

  unsubscribe() {
    this.subscribed = false;
    this.stop();
  }

  start() {
    if (!this.powered || !this.subscribed || this.running) return false;
    clearTimeout(this.timer);
    this.timer = null;
    this.running = true;
    this.step = 0;
    this.logger.log('simulator: weighing started');
    this.schedule(this.options.intervalMs);
    return true;
  }

  stop() {
    const wasRunning = this.running;
    this.running = false;
    clearTimeout(this.timer);
    this.timer = null;
    if (wasRunning) this.logger.log('simulator: weighing stopped');
  }

  handleCommand(buffer) {
    let command;
    try {
      command = packets.parseCommand(buffer);
    } catch (error) {
      this.logger.error('simulator: invalid command: ' + error.message);
      return [packets.buildAckPacket(0x00, packets.AckStatus.INVALID_ARGUMENT)];
    }

    if (!this.powered) {
      return [this.ack(command.type, packets.AckStatus.INVALID_ARGUMENT)];
    }

    switch (command.type) {
      case packets.CommandType.START_MEASUREMENT:
        this.start();
        return [this.ack(command.type, packets.AckStatus.OK)];
      case packets.CommandType.STOP_MEASUREMENT:
        this.stop();
        return [this.ack(command.type, packets.AckStatus.OK)];
      case packets.CommandType.REQUEST_HISTORY:
        this.logger.log('simulator: sending ' + this.history.length + ' historical measurements');
        return this.historyPackets().concat([this.ack(command.type, packets.AckStatus.OK)]);
      case packets.CommandType.SET_UNIT:
        if (command.payload.length < 1) {
          return [this.ack(command.type, packets.AckStatus.INVALID_ARGUMENT)];
        }
        this.unit = command.payload[0] === 0 ? 'kg' : 'lb';
        this.logger.log('simulator: unit set to ' + this.unit);
        return [this.ack(command.type, packets.AckStatus.OK)];
      case packets.CommandType.SET_USER:
        if (command.payload.length < 4) {
          return [this.ack(command.type, packets.AckStatus.INVALID_ARGUMENT)];
        }
        this.userId = command.payload.readUInt32BE(0);
        this.logger.log('simulator: user set to ' + this.userId);
        return [this.ack(command.type, packets.AckStatus.OK)];
      default:
        this.logger.log('simulator: unsupported command 0x' + command.type.toString(16));
        return [this.ack(command.type, packets.AckStatus.UNSUPPORTED)];
    }
  }

  historyPackets() {
    const self = this;
    return this.history.map(function(measurement) {
      return packets.buildMeasuredPacket(Object.assign({
        historical: true,
        userId: self.userId
      }, measurement));
    });
  }

  // Control surface for the simulator node. It stays below the packet layer so
  // the web console drives the same code path as a real scale.
  state() {
    return {
      powered: this.powered,
      subscribed: this.subscribed,
      running: this.running,
      weightKg: this.options.weightKg,
      lastWeightKg: this.lastWeightKg,
      user: this.userId,
      unit: this.unit,
      step: this.step,
      steps: this.options.steps,
      repeat: this.options.repeat,
      intervalMs: this.options.intervalMs,
      history: this.history.length
    };
  }

  setPowered(powered) {
    this.powered = Boolean(powered);
    if (!this.powered) {
      this.stop();
    } else if (this.subscribed && this.options.autoStart) {
      this.start();
    }
    return this.state();
  }

  setWeightKg(weightKg) {
    this.options.weightKg = roundWeight(weightKg);
    return this.state();
  }

  setUser(userId) {
    this.userId = userId;
    return this.state();
  }

  setUnit(unit) {
    this.unit = unit;
    return this.state();
  }

  sendHistory() {
    const self = this;
    const packetsToSend = this.historyPackets();
    packetsToSend.forEach(function(packet) {
      self.emit('packet', packet);
    });
    return packetsToSend.length;
  }

  ack(commandType, status) {
    return packets.buildAckPacket(commandType, status);
  }

  schedule(delayMs) {
    const self = this;
    this.timer = setTimeout(function() { self.tick(); }, delayMs);
  }

  tick() {
    this.timer = null;
    if (!this.running || !this.subscribed) return;

    if (this.step < this.options.steps) {
      const progress = this.options.steps === 0 ? 1 : this.step / this.options.steps;
      const weightKg = roundWeight(
        this.options.weightKg + this.options.startOffsetKg * (1 - progress)
      );
      this.step += 1;
      this.lastWeightKg = weightKg;
      this.emit('packet', packets.buildMeasuringPacket({
        date: currentTimeInSeconds(),
        weightKg: weightKg
      }));
      this.schedule(this.options.intervalMs);
      return;
    }

    this.finish();
  }

  finish() {
    this.running = false;
    this.lastWeightKg = this.options.weightKg;
    this.emit('packet', packets.buildMeasuredPacket({
      historical: false,
      date: currentTimeInSeconds(),
      userId: this.userId,
      weightKg: this.options.weightKg,
      resistance: this.options.resistance,
      fatPercentage: this.options.fatPercentage
    }));
    this.logger.log('simulator: measurement complete: ' + this.options.weightKg + ' kg');

    if (!this.options.repeat) return;

    const self = this;
    this.timer = setTimeout(function() {
      self.timer = null;
      if (self.subscribed) self.start();
    }, this.options.cycleDelayMs);
  }
}

module.exports = Scale;
module.exports.DEFAULT_OPTIONS = DEFAULT_OPTIONS;
