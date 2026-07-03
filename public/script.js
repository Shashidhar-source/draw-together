const canvas = document.getElementById('draw-canvas');
const cursorCanvas = document.getElementById('cursor-canvas');
const ctx = canvas.getContext('2d');
const cursorCtx = cursorCanvas.getContext('2d');

const lobby = document.getElementById('lobby');
const canvasContainer = document.getElementById('canvas-container');
const nameInput = document.getElementById('name-input');
const roomInput = document.getElementById('room-input');
const joinBtn = document.getElementById('join-btn');
const roomCode = document.getElementById('room-code');
const clearBtn = document.getElementById('clear-btn');
const leaveBtn = document.getElementById('leave-btn');
const colorPicker = document.getElementById('color-picker');
const brushSize = document.getElementById('brush-size');
const userIndicators = document.getElementById('user-indicators');

let ws = null;
let drawing = false;
let lastX = 0;
let lastY = 0;
let myColor = '#000000';
let myBrushSize = 4;
let myName = '';
let currentRoom = null;
let remoteCursors = {};

function resizeCanvases() {
  const wrapper = document.getElementById('canvas-wrapper');
  let prevData = null;
  if (canvas.width > 0 && canvas.height > 0) {
    prevData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  }
  canvas.width = wrapper.clientWidth;
  canvas.height = wrapper.clientHeight;
  cursorCanvas.width = wrapper.clientWidth;
  cursorCanvas.height = wrapper.clientHeight;
  if (prevData) {
    ctx.putImageData(prevData, 0, 0);
  }
}

function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX || (e.touches && e.touches[0].clientX)) - rect.left;
  const y = (e.clientY || (e.touches && e.touches[0].clientY)) - rect.top;
  return { x, y };
}

function startDraw(e) {
  e.preventDefault();
  drawing = true;
  const pos = getPos(e);
  lastX = pos.x;
  lastY = pos.y;
}

function draw(e) {
  e.preventDefault();
  const pos = getPos(e);
  if (drawing) {
    const data = {
      type: 'draw',
      x0: lastX,
      y0: lastY,
      x1: pos.x,
      y1: pos.y,
      color: myColor,
      brushSize: myBrushSize,
      name: myName,
    };
    drawLine(ctx, data);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
    lastX = pos.x;
    lastY = pos.y;
  }
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'cursor',
      x: pos.x,
      y: pos.y,
      color: myColor,
      name: myName,
    }));
  }
}

function stopDraw(e) {
  drawing = false;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'cursor', x: -1, y: -1 }));
  }
}

function drawLine(context, data) {
  context.beginPath();
  context.moveTo(data.x0, data.y0);
  context.lineTo(data.x1, data.y1);
  context.strokeStyle = data.color;
  context.lineWidth = data.brushSize;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.stroke();
}

function applyRemoteDraw(data) {
  drawLine(ctx, data);
}

function updateCursorCanvas() {
  cursorCtx.clearRect(0, 0, cursorCanvas.width, cursorCanvas.height);
  for (const [id, cursor] of Object.entries(remoteCursors)) {
    if (cursor.x < 0 || cursor.y < 0) continue;
    cursorCtx.beginPath();
    cursorCtx.arc(cursor.x, cursor.y, 5, 0, Math.PI * 2);
    cursorCtx.fillStyle = cursor.color;
    cursorCtx.fill();
    cursorCtx.font = 'bold 11px system-ui, sans-serif';
    cursorCtx.fillStyle = cursor.color;
    cursorCtx.fillText(cursor.name || id.substring(0, 4), cursor.x + 12, cursor.y + 4);
  }
  requestAnimationFrame(updateCursorCanvas);
}

canvas.addEventListener('mousedown', startDraw);
canvas.addEventListener('mousemove', draw);
canvas.addEventListener('mouseup', stopDraw);
canvas.addEventListener('mouseleave', stopDraw);

canvas.addEventListener('touchstart', startDraw);
canvas.addEventListener('touchmove', draw);
canvas.addEventListener('touchend', stopDraw);

function connect(room, color, size, name) {
  ws = new WebSocket(BACKEND_URL);

  ws.onopen = () => {
    ws.send(JSON.stringify({
      type: 'join',
      room,
      color,
      brushSize: size,
      name,
    }));
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    switch (msg.type) {
      case 'joined':
        currentRoom = msg.room;
        roomCode.textContent = msg.room;
        lobby.style.display = 'none';
        canvasContainer.style.display = 'flex';
        resizeCanvases();
        break;

      case 'draw':
        applyRemoteDraw(msg);
        break;

      case 'clear':
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        break;

      case 'cursor':
        if (msg.x < 0 || msg.y < 0) {
          delete remoteCursors[msg.id];
        } else {
          remoteCursors[msg.id] = { x: msg.x, y: msg.y, color: msg.color, name: msg.name };
        }
        break;

      case 'users':
        renderUsers(msg.users);
        break;

      case 'user-joined':
        renderUsers(msg.users);
        break;
    }
  };

  ws.onclose = () => {
    disconnect();
  };
}

function renderUsers(users) {
  userIndicators.innerHTML = '';
  users.forEach((u) => {
    const item = document.createElement('div');
    item.className = 'user-item';
    const dot = document.createElement('span');
    dot.className = 'user-dot';
    dot.style.background = u.color;
    item.appendChild(dot);
    const label = document.createElement('span');
    label.className = 'user-name';
    label.textContent = u.name || 'Anonymous';
    item.appendChild(label);
    userIndicators.appendChild(item);
  });
}

function disconnect() {
  if (ws) {
    ws.close();
    ws = null;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  currentRoom = null;
  remoteCursors = {};
  lobby.style.display = 'flex';
  canvasContainer.style.display = 'none';
}

joinBtn.addEventListener('click', () => {
  myColor = colorPicker.value;
  myBrushSize = parseInt(brushSize.value, 10);
  myName = nameInput.value.trim() || 'Anonymous';
  const room = roomInput.value.trim().toUpperCase() || '';
  connect(room, myColor, myBrushSize, myName);
});

clearBtn.addEventListener('click', () => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'clear' }));
  }
});

leaveBtn.addEventListener('click', disconnect);

colorPicker.addEventListener('input', () => { myColor = colorPicker.value; });
brushSize.addEventListener('input', () => { myBrushSize = parseInt(brushSize.value, 10); });

roomInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinBtn.click();
});
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinBtn.click();
});

window.addEventListener('resize', resizeCanvases);

updateCursorCanvas();
