'use strict';

const http = require('http');

const MAX_BODY_BYTES = 4096;

function readBody(request) {
  return new Promise(function(resolve, reject) {
    let body = '';

    request.on('data', function(chunk) {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) {
        request.destroy();
        reject(new Error('request body is too large'));
      }
    });
    request.on('end', function() { resolve(body); });
    request.on('error', reject);
  });
}

function send(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(payload)
  });
  response.end(payload);
}

function invalid(response, message) {
  send(response, 400, {
    error: { code: 'invalid_request', message: message }
  });
}

function parseWeight(payload) {
  if (
    typeof payload.kg !== 'number' ||
    !isFinite(payload.kg) ||
    payload.kg <= 0 ||
    payload.kg > 655.35
  ) {
    return null;
  }
  return payload.kg;
}

function parseUser(payload) {
  if (
    !Number.isInteger(payload.id) ||
    payload.id < 0 ||
    payload.id > 0xffffffff
  ) {
    return null;
  }
  return payload.id;
}

// Local HTTP surface used by the suite to drive the simulated scale. It binds
// to loopback only; the suite proxies it for the web console.
function startControlServer(options) {
  const control = options.control;
  const logger = options.logger || console;

  const server = http.createServer(function(request, response) {
    (async function() {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.pathname.indexOf('/api/simulator') !== 0) {
        return send(response, 404, {
          error: { code: 'not_found', message: 'Not found' }
        });
      }

      if (url.pathname === '/api/simulator') {
        if (request.method !== 'GET') {
          return send(response, 405, {
            error: { code: 'method_not_allowed', message: 'Use GET' }
          });
        }
        return send(response, 200, control.state());
      }

      if (request.method !== 'POST') {
        return send(response, 405, {
          error: { code: 'method_not_allowed', message: 'Use POST' }
        });
      }

      const raw = await readBody(request);
      let payload = {};
      if (raw.trim()) {
        try {
          payload = JSON.parse(raw);
        } catch (error) {
          return invalid(response, 'body must be JSON');
        }
      }

      switch (url.pathname) {
        case '/api/simulator/power':
          if (typeof payload.on !== 'boolean') {
            return invalid(response, 'expected { "on": true | false }');
          }
          control.setPowered(payload.on);
          break;

        case '/api/simulator/start':
          control.start();
          break;

        case '/api/simulator/stop':
          control.stop();
          break;

        case '/api/simulator/weight': {
          const weightKg = parseWeight(payload);
          if (weightKg === null) {
            return invalid(response, 'expected { "kg": 0 < number <= 655.35 }');
          }
          control.setWeightKg(weightKg);
          break;
        }

        case '/api/simulator/user': {
          const userId = parseUser(payload);
          if (userId === null) {
            return invalid(response, 'expected { "id": 0 <= integer }');
          }
          control.setUser(userId);
          break;
        }

        case '/api/simulator/unit':
          if (payload.unit !== 'kg' && payload.unit !== 'lb') {
            return invalid(response, 'expected { "unit": "kg" | "lb" }');
          }
          control.setUnit(payload.unit);
          break;

        case '/api/simulator/history':
          control.sendHistory();
          break;

        default:
          return send(response, 404, {
            error: { code: 'not_found', message: 'Not found' }
          });
      }

      return send(response, 200, control.state());
    })().catch(function(error) {
      logger.error('simulator: control error: ' + (error.message || error));
      if (response.headersSent) {
        response.end();
        return;
      }
      send(response, 500, {
        error: {
          code: 'control_error',
          message: error.message || String(error)
        }
      });
    });
  });

  server.listen(options.port, '127.0.0.1');
  server.on('listening', function() {
    const address = server.address();
    logger.log(
      'simulator: control on http://127.0.0.1:' +
        (address && typeof address === 'object' ? address.port : options.port)
    );
  });
  server.on('error', function(error) {
    logger.error('simulator: control server failed: ' + error.message);
  });

  return {
    server: server,
    close: function(callback) { server.close(callback); }
  };
}

module.exports = {
  startControlServer: startControlServer
};
