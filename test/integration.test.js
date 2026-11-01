'use strict';

const { test } = require('node:test');
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

      const onError = function() {
        socket.removeAllListeners();
        socket.terminate();
        if (Date.now() > deadline) {
          return reject(new Error('WebSocket did not open at ' + url));
        }
        setTimeout(attempt, 25);
      };

      socket.once('open', function() {
        socket.removeListener('error', onError);
        resolve(socket);
      });
      socket.once('error', onError);
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

test('the app streams simulated measurements over WebSocket', { timeout: 15000 }, async function() {
  const port = await freePort();
  const child = spawn(process.execPath, ['ble.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      BLE_DRIVER: 'simulator',
      WS_PORT: String(port),
      SIMULATOR_NAME: 'YUNMAI-SIM',
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

  try {
    socket = await openSocket('ws://127.0.0.1:' + port, 5000);

    const messages = [];
    const measured = new Promise(function(resolve, reject) {
      const timer = setTimeout(function() {
        reject(new Error('No measured message received.\n' + output.join('')));
      }, 5000);

      socket.on('message', function(raw) {
        const message = JSON.parse(raw.toString());
        messages.push(message);

        if (message.packetType === 'measured') {
          clearTimeout(timer);
          resolve(message);
        }
      });
    });

    const message = await measured;

    assert.equal(message.firmwareVersion, 1);
    assert.equal(message.data.weight, 750);
    assert.equal(message.data.userId, 1);
    assert.ok(
      messages.some(function(entry) { return entry.packetType === 'measuring'; }),
      'expected at least one measuring message'
    );
  } finally {
    if (socket) socket.terminate();
    await stopChild(child);
  }
});
