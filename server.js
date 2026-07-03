const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const rooms = new Map();

function roomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

wss.on('connection', (ws) => {
  let currentRoom = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      case 'join': {
        const room = msg.room || roomId();
        if (!rooms.has(room)) {
          rooms.set(room, { clients: new Map(), strokes: [] });
        }
        const roomData = rooms.get(room);
        if (roomData.clients.size >= 50) {
          ws.send(JSON.stringify({ type: 'error', message: 'Room full (max 50)' }));
          break;
        }
        if (currentRoom) {
          const prev = rooms.get(currentRoom);
          if (prev) prev.clients.delete(ws);
        }
        currentRoom = room;
        const clients = roomData.clients;
        clients.set(ws, { color: msg.color || '#000000', brushSize: msg.brushSize || 4, name: msg.name || 'Anonymous' });

        ws.send(JSON.stringify({ type: 'joined', room }));
        if (roomData.strokes.length > 0) {
          ws.send(JSON.stringify({ type: 'stroke-history', strokes: roomData.strokes }));
        }

        const userList = Array.from(clients.entries()).map(([c, u]) => ({
          color: u.color,
          brushSize: u.brushSize,
          name: u.name,
          id: c._id || (c._id = Math.random().toString(36).substring(2, 8)),
        }));
        broadcastToRoom(room, {
          type: 'users',
          users: userList,
        }, null);

        broadcastToRoom(room, {
          type: 'user-joined',
          users: userList,
        }, ws);
        break;
      }

      case 'draw': {
        if (!currentRoom) break;
        const roomData = rooms.get(currentRoom);
        const drawer = roomData?.clients.get(ws);
        msg.name = drawer?.name || 'Anonymous';
        roomData?.strokes.push({ ...msg });
        if (roomData?.strokes.length > 10000) roomData.strokes.splice(0, 5000);
        broadcastToRoom(currentRoom, msg, ws);
        break;
      }

      case 'fill': {
        if (!currentRoom) break;
        const roomData = rooms.get(currentRoom);
        roomData?.strokes.push({ ...msg });
        if (roomData?.strokes.length > 10000) roomData.strokes.splice(0, 5000);
        broadcastToRoom(currentRoom, msg, ws);
        break;
      }

      case 'clear': {
        if (!currentRoom) break;
        const roomData = rooms.get(currentRoom);
        if (roomData) roomData.strokes = [];
        broadcastToRoom(currentRoom, { type: 'clear' }, null);
        break;
      }

      case 'cursor': {
        if (!currentRoom) break;
        const cursorUser = rooms.get(currentRoom)?.clients.get(ws);
        msg.id = ws._id;
        msg.name = cursorUser?.name || 'Anonymous';
        broadcastToRoom(currentRoom, msg, ws);
        break;
      }
    }
  });

  ws.on('close', () => {
    if (currentRoom && rooms.has(currentRoom)) {
      const roomData = rooms.get(currentRoom);
      roomData.clients.delete(ws);
      if (roomData.clients.size === 0) {
        rooms.delete(currentRoom);
      } else {
        const userList = Array.from(roomData.clients.entries()).map(([c, u]) => ({
          color: u.color,
          brushSize: u.brushSize,
          name: u.name,
          id: c._id || (c._id = Math.random().toString(36).substring(2, 8)),
        }));
        broadcastToRoom(currentRoom, {
          type: 'users',
          users: userList,
        }, null);
      }
    }
  });
});

function broadcastToRoom(room, msg, exclude) {
  const roomData = rooms.get(room);
  if (!roomData) return;
  const data = JSON.stringify(msg);
  for (const [client] of roomData.clients) {
    if (client !== exclude && client.readyState === 1) {
      client.send(data);
    }
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
