'use strict';

const PROTOCOL_VERSION = 1;

function sentAtOrNow(sentAt) {
  return sentAt || new Date().toISOString();
}

function envelope(type, deviceId, payload, sentAt) {
  return {
    v: PROTOCOL_VERSION,
    type: type,
    deviceId: deviceId,
    sentAt: sentAtOrNow(sentAt),
    payload: payload
  };
}

function measuredAt(seconds) {
  return new Date(seconds * 1000).toISOString();
}

function buildHelloMessage(deviceId, capabilities, sentAt) {
  return envelope('hello', deviceId, { capabilities: capabilities }, sentAt);
}

function buildMeasuringMessage(deviceId, measurement, sentAt) {
  return envelope(
    'measurement.measuring',
    deviceId,
    {
      measuredAt: measuredAt(measurement.date),
      weight: measurement.weight
    },
    sentAt
  );
}

function buildCompletedMessage(deviceId, measurement, firmwareVersion, sentAt) {
  return envelope(
    'measurement.completed',
    deviceId,
    {
      measuredAt: measuredAt(measurement.date),
      userId: measurement.userId,
      weight: measurement.weight,
      resistance: measurement.resistance,
      fatPercentage: measurement.fatPercentage,
      historical: measurement.historicalInfo === 1,
      firmwareVersion: firmwareVersion
    },
    sentAt
  );
}

function buildStatusMessage(deviceId, status, sentAt) {
  return envelope(
    'status',
    deviceId,
    {
      bluetooth: status.bluetooth,
      scanning: status.scanning,
      connected: status.connected,
      peripheralName: status.peripheralName
    },
    sentAt
  );
}

function buildErrorMessage(deviceId, code, message, sentAt) {
  return envelope('error', deviceId, { code: code, message: message }, sentAt);
}

module.exports = {
  PROTOCOL_VERSION: PROTOCOL_VERSION,
  buildHelloMessage: buildHelloMessage,
  buildMeasuringMessage: buildMeasuringMessage,
  buildCompletedMessage: buildCompletedMessage,
  buildStatusMessage: buildStatusMessage,
  buildErrorMessage: buildErrorMessage
};
