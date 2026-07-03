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
          rooms.set(room, new Map());
        }
        if (currentRoom) {
          const prev = rooms.get(currentRoom);
          if (prev) prev.delete(ws);
        }
        currentRoom = room;
        const clients = rooms.get(room);
        clients.set(ws, { color: msg.color || '#000000', brushSize: msg.brushSize || 4 });

        ws.send(JSON.stringify({ type: 'joined', room }));

        const userList = Array.from(clients.entries()).map(([c, u]) => ({
          color: u.color,
          brushSize: u.brushSize,
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
        broadcastToRoom(currentRoom, msg, ws);
        break;
      }

      case 'clear': {
        if (!currentRoom) break;
        broadcastToRoom(currentRoom, { type: 'clear' }, null);
        break;
      }

      case 'cursor': {
        if (!currentRoom) break;
        msg.id = ws._id;
        broadcastToRoom(currentRoom, msg, ws);
        break;
      }
    }
  });

  ws.on('close', () => {
    if (currentRoom && rooms.has(currentRoom)) {
      const clients = rooms.get(currentRoom);
      clients.delete(ws);
      if (clients.size === 0) {
        rooms.delete(currentRoom);
      } else {
        const userList = Array.from(clients.entries()).map(([c, u]) => ({
          color: u.color,
          brushSize: u.brushSize,
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
  const clients = rooms.get(room);
  if (!clients) return;
  const data = JSON.stringify(msg);
  for (const [client] of clients) {
    if (client !== exclude && client.readyState === 1) {
      client.send(data);
    }
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
