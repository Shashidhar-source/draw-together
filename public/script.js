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
const tooltipEl = document.getElementById('stroke-tooltip');
const toolbarColor = document.getElementById('toolbar-color');
const toolbarSize = document.getElementById('toolbar-size');
const sizeLabel = document.getElementById('size-label');
const zoomLevel = document.getElementById('zoom-level');
const zoomIn = document.getElementById('zoom-in');
const zoomOut = document.getElementById('zoom-out');
const zoomReset = document.getElementById('zoom-reset');
const zoomSlider = document.getElementById('zoom-slider');
const colorPresets = document.querySelectorAll('.color-preset');
const toolBtns = {
  brush: document.getElementById('tool-brush'),
  eraser: document.getElementById('tool-eraser'),
  fill: document.getElementById('tool-fill'),
};

let ws = null;
let drawing = false;
let lastX = 0;
let lastY = 0;
let myColor = '#000000';
let myBrushSize = 4;
let myName = '';
let currentRoom = null;
let remoteCursors = {};
let strokes = [];
let activeTool = 'brush';

let vx = 0, vy = 0, vscale = 1, vrot = 0;
let pointers = {};
let isPinching = false;
let lastPinchDist = 0;
let lastPinchAngle = 0;
let longPressTimer = null;
let longPressPos = { x: 0, y: 0 };

function screenToCanvas(sx, sy) {
  const cosR = Math.cos(-vrot), sinR = Math.sin(-vrot);
  const dx = (sx - vx) / vscale, dy = (sy - vy) / vscale;
  return { x: dx * cosR - dy * sinR, y: dx * sinR + dy * cosR };
}

function resizeCanvases() {
  const wrapper = document.getElementById('canvas-wrapper');
  if (!wrapper) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = wrapper.clientWidth * dpr;
  canvas.height = wrapper.clientHeight * dpr;
  cursorCanvas.width = wrapper.clientWidth * dpr;
  cursorCanvas.height = wrapper.clientHeight * dpr;
  canvas.style.width = wrapper.clientWidth + 'px';
  canvas.style.height = wrapper.clientHeight + 'px';
  cursorCanvas.style.width = wrapper.clientWidth + 'px';
  cursorCanvas.style.height = wrapper.clientHeight + 'px';
  applyTransform(ctx);
}

function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function applyTransform(context = ctx) {
  const dpr = window.devicePixelRatio || 1;
  context.scale(dpr, dpr);
  context.translate(vx, vy);
  context.rotate(vrot);
  context.scale(vscale, vscale);
}

function redrawAllStrokes() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  applyTransform(ctx);
  for (const s of strokes) {
    if (s.type === 'fill') {
      applyFloodFill(s.logicalX, s.logicalY, s.color);
    } else {
      drawLine(ctx, s);
    }
  }
}

function startDraw(e) {
  if (pointers[e.pointerId]) return;
  const pos = getPos(e);
  pointers[e.pointerId] = { x: pos.x, y: pos.y };
  if (Object.keys(pointers).length === 2) {
    const p = Object.values(pointers);
    lastPinchDist = Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y);
    lastPinchAngle = Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x);
    isPinching = true;
    return;
  }
  if (activeTool === 'fill') {
    e.preventDefault();
    const c = screenToCanvas(pos.x, pos.y);
    const data = { type: 'fill', logicalX: c.x, logicalY: c.y, color: myColor };
    strokes.push(data);
    applyFloodFill(c.x, c.y, myColor);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
    return;
  }
  e.preventDefault();
  if (isPinching) return;

  if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
  longPressPos = { x: pos.x, y: pos.y };
  longPressTimer = setTimeout(() => {
    longPressTimer = null;
    if (drawing) return;
    const c = screenToCanvas(longPressPos.x, longPressPos.y);
    const found = findStrokeAt(c.x, c.y);
    if (found) {
      tooltipEl.textContent = found.name || 'Anonymous';
      tooltipEl.style.display = 'block';
      tooltipEl.style.left = (longPressPos.x + 12) + 'px';
      tooltipEl.style.top = (longPressPos.y - 8) + 'px';
    }
  }, 500);

  drawing = true;
  const c = screenToCanvas(pos.x, pos.y);
  lastX = c.x;
  lastY = c.y;
  tooltipEl.style.display = 'none';

  // Draw a single dot immediately
  const mode = activeTool === 'eraser' ? 'eraser' : 'brush';
  const data = {
    type: 'draw', mode,
    x0: lastX, y0: lastY,
    x1: lastX + 0.001, y1: lastY + 0.001,
    color: myColor, brushSize: myBrushSize, name: myName,
  };
  strokes.push(data);
  drawLine(ctx, data);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function findStrokeAt(mx, my) {
  let found = null;
  let minDist = Infinity;
  for (const s of strokes) {
    if (s.mode === 'eraser') continue;
    const dist = pointToSegmentDist(mx, my, s.x0, s.y0, s.x1, s.y1);
    const threshold = (s.brushSize || 4) / 2 + 4;
    if (dist < threshold && dist < minDist) {
      minDist = dist;
      found = s;
    }
  }
  return found;
}

function handlePointerMove(e) {
  const pos = getPos(e);
  if (pointers[e.pointerId]) {
    pointers[e.pointerId] = { x: pos.x, y: pos.y };
  }
  if (longPressTimer && Math.hypot(pos.x - longPressPos.x, pos.y - longPressPos.y) > 10) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
  if (Object.keys(pointers).length === 2 && isPinching) {
    const p = Object.values(pointers);
    const dist = Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y);
    const angle = Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x);
    const cx = (p[0].x + p[1].x) / 2;
    const cy = (p[0].y + p[1].y) / 2;
    const oldCx = (p[0].x + (p[1].x - p[0].x) * (1 - dist / lastPinchDist) / 2) + (pos.x - p[0].x) / 2;
if (lastPinchDist > 0) {
        const scaleChange = dist / lastPinchDist;
        vx = cx - scaleChange * (cx - vx);
        vy = cy - scaleChange * (cy - vy);
        vscale *= scaleChange;
        if (vscale < 0.1) vscale = 0.1;
        if (vscale > 4) vscale = 4;
      }
    vrot += angle - lastPinchAngle;
    lastPinchDist = dist;
    lastPinchAngle = angle;
    zoomLevel.textContent = Math.round(vscale * 100) + '%';
    zoomSlider.value = Math.round(vscale * 100);
    redrawAllStrokes();
    return;
  }
  if (!drawing || isPinching) {
    if (!isPinching) {
      const c = screenToCanvas(pos.x, pos.y);
      checkStrokeHover(c.x, c.y);
    }
    return;
  }
  e.preventDefault();
  const c = screenToCanvas(pos.x, pos.y);
  const mode = activeTool === 'eraser' ? 'eraser' : 'brush';
  const data = {
    type: 'draw', mode,
    x0: lastX, y0: lastY,
    x1: c.x, y1: c.y,
    color: myColor, brushSize: myBrushSize, name: myName,
  };
  strokes.push(data);
  drawLine(ctx, data);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
  lastX = c.x;
  lastY = c.y;
}

function stopDraw(e) {
  if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
  delete pointers[e.pointerId];
  if (Object.keys(pointers).length < 2) {
    isPinching = false;
  }
  if (tooltipEl.style.display === 'block' && !drawing) {
    tooltipEl.style.display = 'none';
  }
  if (!drawing) return;
  drawing = false;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'cursor', x: -1, y: -1 }));
  }
}

let strokeCount = 0;

function drawLine(context, data) {
  if (data.mode === 'eraser' || data.color === 'eraser') {
    context.globalCompositeOperation = 'destination-out';
    context.strokeStyle = 'rgba(0,0,0,1)';
  } else {
    context.globalCompositeOperation = 'source-over';
    context.strokeStyle = data.color;
  }
  context.beginPath();
  context.moveTo(data.x0, data.y0);
  context.lineTo(data.x1, data.y1);
  context.lineWidth = data.brushSize;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.stroke();
  context.globalCompositeOperation = 'source-over';
}

function pointToSegmentDist(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x0, py - y0);
  let t = ((px - x0) * dx + (py - y0) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
}

function checkStrokeHover(mx, my) {
  const found = findStrokeAt(mx, my);
  if (found) {
    tooltipEl.textContent = found.name || 'Anonymous';
    tooltipEl.style.display = 'block';
    tooltipEl.style.left = (mx * vscale + vx + 12) + 'px';
    tooltipEl.style.top = (my * vscale + vy - 8) + 'px';
  } else {
    tooltipEl.style.display = 'none';
  }
}

function updateCursorCanvas() {
  cursorCtx.save();
  cursorCtx.setTransform(1, 0, 0, 1, 0, 0);
  cursorCtx.clearRect(0, 0, cursorCanvas.width, cursorCanvas.height);
  cursorCtx.restore();
  cursorCtx.save();
  applyTransform(cursorCtx);
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
  cursorCtx.restore();
  requestAnimationFrame(updateCursorCanvas);
}

function floodFillPhysical(x, y, fillColor) {
  const w = canvas.width, h = canvas.height;
  if (x < 0 || x >= w || y < 0 || y >= h) return;
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  const idx = (y * w + x) * 4;
  const targetR = data[idx], targetG = data[idx + 1], targetB = data[idx + 2], targetA = data[idx + 3];
  let fillR = 0, fillG = 0, fillB = 0;
  if (fillColor.startsWith('#')) {
    const hex = fillColor.replace('#', '');
    fillR = parseInt(hex.substring(0, 2), 16);
    fillG = parseInt(hex.substring(2, 4), 16);
    fillB = parseInt(hex.substring(4, 6), 16);
  }
  if (targetR === fillR && targetG === fillG && targetB === fillB && targetA === 255) return;
  const visited = new Uint8Array(w * h);
  const stack = [[x, y]];
  while (stack.length) {
    const [cx, cy] = stack.pop();
    if (cx < 0 || cx >= w || cy < 0 || cy >= h) continue;
    const vi = cy * w + cx;
    if (visited[vi]) continue;
    const pi = vi * 4;
    if (Math.abs(data[pi] - targetR) > 5 || Math.abs(data[pi + 1] - targetG) > 5 || Math.abs(data[pi + 2] - targetB) > 5 || Math.abs(data[pi + 3] - targetA) > 5) continue;
    visited[vi] = 1;
    data[pi] = fillR;
    data[pi + 1] = fillG;
    data[pi + 2] = fillB;
    data[pi + 3] = 255;
    stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
  }
  ctx.putImageData(imageData, 0, 0);
}

function applyFloodFill(logicalX, logicalY, fillColor) {
  const dpr = window.devicePixelRatio || 1;
  const cosR = Math.cos(vrot), sinR = Math.sin(vrot);
  let x1 = logicalX * vscale;
  let y1 = logicalY * vscale;
  let x2 = x1 * cosR - y1 * sinR;
  let y2 = x1 * sinR + y1 * cosR;
  let px = (x2 + vx) * dpr;
  let py = (y2 + vy) * dpr;
  floodFillPhysical(Math.floor(px), Math.floor(py), fillColor);
}

canvas.addEventListener('pointerdown', startDraw);
canvas.addEventListener('pointermove', handlePointerMove);
canvas.addEventListener('pointerup', stopDraw);
canvas.addEventListener('pointerleave', stopDraw);
canvas.addEventListener('pointercancel', stopDraw);

function connect(room, name) {
  ws = new WebSocket(BACKEND_URL);
  ws.onopen = () => {
    ws.send(JSON.stringify({
      type: 'join', room,
      color: myColor, brushSize: myBrushSize, name,
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
      case 'stroke-history':
        strokes = msg.strokes || [];
        redrawAllStrokes();
        break;
      case 'draw':
        strokes.push(msg);
        drawLine(ctx, msg);
        break;
      case 'fill':
        strokes.push(msg);
        applyFloodFill(msg.logicalX, msg.logicalY, msg.color);
        break;
      case 'clear':
        strokes = [];
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
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
      case 'error':
        alert(msg.message);
        break;
    }
  };
  ws.onclose = () => { disconnect(); };
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
  if (ws) { ws.close(); ws = null; }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
  currentRoom = null;
  remoteCursors = {};
  strokes = [];
  tooltipEl.style.display = 'none';
  vx = 0; vy = 0; vscale = 1; vrot = 0;
  zoomLevel.textContent = '100%';
  zoomSlider.value = 100;
  lobby.style.display = 'flex';
  canvasContainer.style.display = 'none';
}

joinBtn.addEventListener('click', () => {
  myColor = colorPicker.value;
  toolbarColor.value = myColor;
  myBrushSize = parseInt(brushSize.value, 10);
  toolbarSize.value = myBrushSize;
  sizeLabel.textContent = myBrushSize;
  myName = nameInput.value.trim() || 'Anonymous';
  const room = roomInput.value.trim().toUpperCase() || '';
  connect(room, myName);
});

clearBtn.addEventListener('click', () => {
  strokes = [];
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'clear' }));
  }
});

leaveBtn.addEventListener('click', disconnect);

colorPicker.addEventListener('input', () => {
  myColor = colorPicker.value;
  toolbarColor.value = myColor;
});
brushSize.addEventListener('input', () => {
  myBrushSize = parseInt(brushSize.value, 10);
  toolbarSize.value = myBrushSize;
  sizeLabel.textContent = myBrushSize;
});

toolbarColor.addEventListener('input', () => {
  myColor = toolbarColor.value;
  colorPicker.value = myColor;
});

toolbarSize.addEventListener('input', () => {
  myBrushSize = parseInt(toolbarSize.value, 10);
  sizeLabel.textContent = myBrushSize;
  brushSize.value = myBrushSize;
});

colorPresets.forEach(btn => {
  btn.addEventListener('click', () => {
    myColor = btn.getAttribute('data-color');
    colorPicker.value = myColor;
    toolbarColor.value = myColor;
  });
});

document.getElementById('tool-eraser').addEventListener('click', () => {
  activeTool = 'eraser';
  Object.values(toolBtns).forEach(b => b.classList.remove('active'));
  document.getElementById('tool-eraser').classList.add('active');
  canvas.style.cursor = 'crosshair';
});
document.getElementById('tool-brush').addEventListener('click', () => {
  activeTool = 'brush';
  Object.values(toolBtns).forEach(b => b.classList.remove('active'));
  document.getElementById('tool-brush').classList.add('active');
  canvas.style.cursor = 'crosshair';
});

document.getElementById('tool-fill').addEventListener('click', () => {
  activeTool = 'fill';
  Object.values(toolBtns).forEach(b => b.classList.remove('active'));
  document.getElementById('tool-fill').classList.add('active');
  canvas.style.cursor = 'pointer';
});

zoomIn.addEventListener('click', () => {
  const rect = canvas.getBoundingClientRect();
  const cx = rect.width / 2, cy = rect.height / 2;
  vx = cx - 1.3 * (cx - vx);
  vy = cy - 1.3 * (cy - vy);
  vscale *= 1.3;
  if (vscale > 4) vscale = 4;
  zoomLevel.textContent = Math.round(vscale * 100) + '%';
  zoomSlider.value = Math.round(vscale * 100);
  redrawAllStrokes();
});

zoomOut.addEventListener('click', () => {
  const rect = canvas.getBoundingClientRect();
  const cx = rect.width / 2, cy = rect.height / 2;
  vx = cx - (1 / 1.3) * (cx - vx);
  vy = cy - (1 / 1.3) * (cy - vy);
  vscale /= 1.3;
  if (vscale < 0.1) vscale = 0.1;
  zoomLevel.textContent = Math.round(vscale * 100) + '%';
  zoomSlider.value = Math.round(vscale * 100);
  redrawAllStrokes();
});

zoomSlider.addEventListener('input', () => {
  const rect = canvas.getBoundingClientRect();
  const cx = rect.width / 2, cy = rect.height / 2;
  const newScale = parseInt(zoomSlider.value, 10) / 100;
  vx = cx - (newScale / vscale) * (cx - vx);
  vy = cy - (newScale / vscale) * (cy - vy);
  vscale = newScale;
  zoomLevel.textContent = Math.round(vscale * 100) + '%';
  redrawAllStrokes();
});

zoomReset.addEventListener('click', () => {
  vx = 0; vy = 0; vscale = 1; vrot = 0;
  zoomLevel.textContent = '100%';
  zoomSlider.value = 100;
  redrawAllStrokes();
});

roomInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinBtn.click(); });
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinBtn.click(); });

window.addEventListener('resize', () => {
  resizeCanvases();
  if (currentRoom) redrawAllStrokes();
});

updateCursorCanvas();
