'use strict';

const { test } = require('bun:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const WebSocket = require('ws');

const ROOT = path.resolve(__dirname, '..');

function freePort() {
  return new Promise(function(resolve, reject) {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', function() {
      const port = server.address().port;
      server.close(function() { resolve(port); });
    });
  });
}

function openSocket(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  return new Promise(function(resolve, reject) {
    (function attempt() {
      const socket = new WebSocket(url);
      const messages = [];
      socket.on('message', function(raw) {
        messages.push(JSON.parse(raw.toString()));
      });

      const onError = function() {
        socket.on('error', function() {});
        socket.terminate();
        if (Date.now() > deadline) {
          return reject(new Error('WebSocket did not open at ' + url));
        }
        setTimeout(attempt, 25);
      };

      socket.once('open', function() {
        socket.removeListener('error', onError);
        resolve({ socket: socket, messages: messages });
      });
      socket.once('error', onError);
    })();
  });
}

function waitFor(predicate, timeoutMs) {
  return new Promise(function(resolve, reject) {
    const startedAt = Date.now();
    (function poll() {
      if (predicate()) return resolve();
      if (Date.now() - startedAt > timeoutMs) {
        return reject(new Error('Timed out waiting for condition'));
      }
      setTimeout(poll, 10);
    })();
  });
}

function stopChild(child) {
  return new Promise(function(resolve) {
    if (child.exitCode !== null || child.signalCode !== null) {
      return resolve();
    }

    const timer = setTimeout(function() {
      child.kill('SIGKILL');
      resolve();
    }, 3000);

    child.once('exit', function() {
      clearTimeout(timer);
      resolve();
    });

    child.kill('SIGINT');
  });
}

test('the app streams v1 measurements over WebSocket', async function() {
  const port = await freePort();
  const child = spawn(process.execPath, ['ble.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      BLE_DRIVER: 'simulator',
      NODE_ID: 'test-node',
      WS_PORT: String(port),
      SIMULATOR_NAME: 'YUNMAI-SIM',
      SIMULATOR_WEIGHT_KG: '7.5',
      SIMULATOR_SCAN_DELAY_MS: '1',
      SIMULATOR_STEPS: '2',
      SIMULATOR_INTERVAL_MS: '500',
      SIMULATOR_REPEAT: 'false',
      SIMULATOR_AUTO_START: 'true'
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const output = [];
  child.stdout.on('data', function(chunk) { output.push(chunk.toString()); });
  child.stderr.on('data', function(chunk) { output.push(chunk.toString()); });

  let socket;
  let messages;

  try {
    const opened = await openSocket('ws://127.0.0.1:' + port, 5000);
    socket = opened.socket;
    messages = opened.messages;

    await waitFor(function() {
      return messages.some(function(message) {
        return message.type === 'measurement.completed';
      });
    }, 5000).catch(function(error) {
      throw new Error(error.message + '\n' + output.join(''));
    });

    const hello = messages.find(function(message) {
      return message.type === 'hello';
    });
    assert.ok(hello, 'expected a hello message');
    assert.equal(hello.v, 1);
    assert.equal(hello.deviceId, 'test-node');

    const completed = messages.find(function(message) {
      return message.type === 'measurement.completed';
    });
    assert.equal(completed.payload.weight, 750);
    assert.equal(completed.payload.userId, 1);
    assert.equal(completed.payload.historical, false);
    assert.equal(completed.payload.firmwareVersion, 1);
    assert.equal(completed.payload.measuredAt.endsWith('Z'), true);

    assert.ok(
      messages.some(function(message) {
        return message.type === 'measurement.measuring';
      }),
      'expected at least one measuring message'
    );
  } finally {
    if (socket) socket.terminate();
    await stopChild(child);
  }
});
