const { WebSocketServer } = require('ws');
const http = require('http');

const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('SupportStream Signaling Active');
});

const wss = new WebSocketServer({ server });

const rooms = new Map();

function getRoom(pin) {
  if (!rooms.has(pin)) rooms.set(pin, { host: null, viewer: null });
  return rooms.get(pin);
}

function safeSend(ws, data) {
  if (ws && ws.readyState === 1) {
    try { ws.send(data); return true; } catch (e) {
      console.error('safeSend error:', e.message);
    }
  }
  return false;
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/');
  const pin = parts[2];
  const role = url.searchParams.get('role');

  console.log(`[${pin}] New connection — role: ${role}`);

  if (!pin || (role !== 'host' && role !== 'viewer')) {
    console.log(`[${pin}] Bad request — closing`);
    ws.close(1008, 'Bad request');
    return;
  }

  if (role === 'viewer' && !getRoom(pin).host) {
    console.log(`[${pin}] Viewer rejected — no host`);
    ws.close(1008, 'Room not found. Start host first.');
    return;
  }

  const room = getRoom(pin);

  if (role === 'host') {
    if (room.host) {
      try { room.host.close(1011, 'Replaced'); } catch (e) {}
    }
    room.host = ws;
    console.log(`[${pin}] Host joined`);
    if (room.viewer) {
      safeSend(room.host, JSON.stringify({ type: 'viewer_joined' }));
    }
  } else {
    if (room.viewer) {
      try { room.viewer.close(1011, 'Replaced'); } catch (e) {}
    }
    room.viewer = ws;
    console.log(`[${pin}] Viewer joined`);
    setTimeout(() => {
      console.log(`[${pin}] Sending viewer_joined to host`);
      safeSend(room.host, JSON.stringify({ type: 'viewer_joined' }));
    }, 800);
  }

  ws.on('message', (data) => {
    const isHost = ws === room.host;
    const target = isHost ? room.viewer : room.host;
    const from = isHost ? 'Host' : 'Viewer';
    const to = isHost ? 'Viewer' : 'Host';
    console.log(`[${pin}] ${from} -> ${to}`);
    if (!safeSend(target, data.toString())) {
      console.warn(`[${pin}] ${to} not reachable — message dropped`);
    }
  });

  ws.on('close', (code, reason) => {
    const isHost = ws === room.host;
    const who = isHost ? 'Host' : 'Viewer';
    console.log(`[${pin}] ${who} disconnected (code: ${code}, reason: ${reason})`);
    if (isHost) {
      room.host = null;
      safeSend(room.viewer, JSON.stringify({ type: 'host_disconnected' }));
    } else {
      room.viewer = null;
      safeSend(room.host, JSON.stringify({ type: 'viewer_disconnected' }));
    }
    if (!room.host && !room.viewer) rooms.delete(pin);
  });

  ws.on('error', (err) => {
    console.error(`[${pin}] WebSocket error:`, err.message);
  });
});

wss.on('error', (err) => {
  console.error('[Server] Fatal error:', err.message);
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
});
