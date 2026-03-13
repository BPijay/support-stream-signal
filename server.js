const { WebSocketServer } = require('ws');
const http = require('http');

const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('SupportStream Signaling Active');
});

const wss = new WebSocketServer({ server });

// rooms: pin -> { host: WebSocket | null, viewer: WebSocket | null }
const rooms = new Map();

function getRoom(pin) {
  if (!rooms.has(pin)) rooms.set(pin, { host: null, viewer: null });
  return rooms.get(pin);
}

function safeSend(ws, data) {
  if (ws && ws.readyState === 1) {
    try { ws.send(data); return true; } catch (_) {}
  }
  return false;
}

wss.on('error', (err) => {
  console.error('[Server] WebSocketServer error:', err);
});

wss.on('connection', (ws, req) => {
  console.log(`[Server] New connection from ${req.socket.remoteAddress} URL: ${req.url}`);
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/');
  const pin = parts[2];
  const role = url.searchParams.get('role');

  if (!pin || (role !== 'host' && role !== 'viewer')) {
    ws.close(1008, 'Bad request');
    return;
  }

  // Reject viewer if no host present
  if (role === 'viewer' && !getRoom(pin).host) {
    ws.close(1008, 'Room not found. Start host first.');
    console.log(`[${pin}] Viewer rejected — no host`);
    return;
  }

  const room = getRoom(pin);

  if (role === 'host') {
    if (room.host) { try { room.host.close(1011, 'Replaced'); } catch (_) {} }
    room.host = ws;
    console.log(`[${pin}] Host joined`);
    if (room.viewer) safeSend(room.host, JSON.stringify({ type: 'viewer_joined' }));
  } else {
    if (room.viewer) { try { room.viewer.close(1011, 'Replaced'); } catch (_) {} }
    room.viewer = ws;
    console.log(`[${pin}] Viewer joined`);
    // Delay gives the host's WebRTC peer connection time to fully initialize
    // before receiving the viewer_joined trigger. Without this the host may
    // receive the message before its receiver loop is listening.
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
    console.log(`[${pin}] ${from} → ${to}`);
    if (!safeSend(target, data.toString())) {
      console.warn(`[${pin}] ${to} not reachable`);
    }
  });

  ws.on('close', () => {
    const isHost = ws === room.host;
    if (isHost) {
      room.host = null;
      safeSend(room.viewer, JSON.stringify({ type: 'host_disconnected' }));
      console.log(`[${pin}] Host disconnected`);
    } else {
      room.viewer = null;
      safeSend(room.host, JSON.stringify({ type: 'viewer_disconnected' }));
      console.log(`[${pin}] Viewer disconnected`);
    }
    // Clean up empty rooms
    if (!room.host && !room.viewer) rooms.delete(pin);
  });

  ws.on('error', (err) => console.error(`[${pin}] WS error:`, err));
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Signaling server running on port ${PORT}`));
