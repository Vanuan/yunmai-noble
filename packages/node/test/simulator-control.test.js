'use strict';

const { test } = require('bun:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');

const { startControlServer } = require('../src/bluetooth/simulator/control');

const SILENT_LOGGER = {
  log: function() {},
  error: function() {}
};

function fakeControl() {
  const calls = [];
  const state = {
    powered: true,
    subscribed: true,
    running: false,
    weightKg: 7.5,
    lastWeightKg: null,
    user: 1,
    unit: 'kg',
    step: 0,
    steps: 8,
    repeat: false,
    intervalMs: 300,
    history: 0
  };

  return {
    calls: calls,
    state: state,
    control: {
      state: function() { return state; },
      setPowered: function(on) { calls.push(['power', on]); return state; },
      start: function() { calls.push(['start']); return state; },
      stop: function() { calls.push(['stop']); return state; },
      setWeightKg: function(kg) { calls.push(['weight', kg]); return state; },
      setUser: function(id) { calls.push(['user', id]); return state; },
      setUnit: function(unit) { calls.push(['unit', unit]); return state; },
      sendHistory: function() { calls.push(['history']); return 0; }
    }
  };
}

async function openControlServer() {
  const fake = fakeControl();
  const server = startControlServer({
    port: 0,
    control: fake.control,
    logger: SILENT_LOGGER
  });

  await once(server.server, 'listening');
  const address = server.server.address();
  const port = address && typeof address === 'object' ? address.port : 0;

  return {
    fake: fake,
    base: 'http://127.0.0.1:' + port,
    close: function() {
      return new Promise(function(resolve) { server.close(resolve); });
    }
  };
}

function post(base, path, body) {
  return fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? '{}' : JSON.stringify(body)
  });
}

test('serves simulator state and accepts control commands', async function() {
  const context = await openControlServer();

  try {
    const state = await fetch(context.base + '/api/simulator');
    assert.equal(state.status, 200);
    assert.deepEqual(await state.json(), context.fake.state);

    assert.equal((await post(context.base, '/api/simulator/power', { on: false })).status, 200);
    assert.equal((await post(context.base, '/api/simulator/start')).status, 200);
    assert.equal((await post(context.base, '/api/simulator/stop')).status, 200);
    assert.equal((await post(context.base, '/api/simulator/weight', { kg: 80.5 })).status, 200);
    assert.equal((await post(context.base, '/api/simulator/user', { id: 4 })).status, 200);
    assert.equal((await post(context.base, '/api/simulator/unit', { unit: 'lb' })).status, 200);
    assert.equal((await post(context.base, '/api/simulator/history')).status, 200);

    assert.deepEqual(context.fake.calls, [
      ['power', false],
      ['start'],
      ['stop'],
      ['weight', 80.5],
      ['user', 4],
      ['unit', 'lb'],
      ['history']
    ]);
  } finally {
    await context.close();
  }
});

test('rejects invalid simulator control requests', async function() {
  const context = await openControlServer();

  try {
    assert.equal((await post(context.base, '/api/simulator/weight', { kg: 'heavy' })).status, 400);
    assert.equal((await post(context.base, '/api/simulator/user', { id: -1 })).status, 400);
    assert.equal((await post(context.base, '/api/simulator/power', { on: 'yes' })).status, 400);
    assert.equal((await post(context.base, '/api/simulator/unit', { unit: 'stone' })).status, 400);

    assert.equal(
      (await fetch(context.base + '/api/simulator/start')).status,
      405
    );
    assert.equal(
      (await post(context.base, '/api/simulator/unknown')).status,
      404
    );

    assert.deepEqual(context.fake.calls, []);
  } finally {
    await context.close();
  }
});
