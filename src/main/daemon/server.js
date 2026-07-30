// Loopback HTTP endpoint that Claude Code talks to directly.
//
// Claude Code supports `"type": "http"` hooks, so every event can be POSTed
// here without a wrapper script per event. The chained statusLine forwarder
// posts the session payload — which is the only place the real
// `rate_limits` percentages are exposed — to /status.
//
// Bound to 127.0.0.1 and gated on a bearer token generated at first run, so
// nothing else on the machine can drive the mascot or read usage data.

const http = require('node:http');

const MAX_BODY = 256 * 1024;   // hook payloads carry tool output; cap them

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * @param {object} opts
 * @param {number} opts.port
 * @param {string} opts.token
 * @param {(payload: object) => void} opts.onHook
 * @param {(payload: object) => void} opts.onStatus
 * @param {() => object} opts.getState
 */
function createDaemon({ port, token, onHook, onStatus, getState }) {
  const server = http.createServer(async (req, res) => {
    const send = (code, body) => {
      const text = JSON.stringify(body);
      res.writeHead(code, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(text),
      });
      res.end(text);
    };

    // Unauthenticated on purpose: lets `curl` confirm the daemon is up
    // without handing the token around. Deliberately reveals nothing else.
    if (req.method === 'GET' && req.url === '/health') {
      send(200, { ok: true });
      return;
    }

    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${token}`) {
      send(401, { error: 'unauthorized' });
      return;
    }

    // Everything the mascot currently believes. Used by the dashboard and by
    // `npm run doctor` to confirm data is actually flowing.
    if (req.method === 'GET' && req.url === '/state') {
      send(200, getState ? getState() : {});
      return;
    }

    if (req.method !== 'POST') {
      send(405, { error: 'method not allowed' });
      return;
    }

    let payload;
    try {
      payload = JSON.parse((await readBody(req)) || '{}');
    } catch (err) {
      send(400, { error: err.message });
      return;
    }

    try {
      if (req.url === '/hook') onHook(payload);
      else if (req.url === '/status') onStatus(payload);
      else {
        send(404, { error: 'not found' });
        return;
      }
    } catch (err) {
      // A broken reaction must never make Claude Code's hook look failed.
      console.error('[daemon] handler error:', err.message);
    }
    send(200, { ok: true });
  });

  server.on('clientError', (_err, socket) => socket.destroy());

  return {
    server,
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          server.off('error', reject);
          resolve(port);
        });
      });
    },
    close() {
      return new Promise(resolve => server.close(resolve));
    },
  };
}

module.exports = { createDaemon };
