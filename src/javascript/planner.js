import {
    viewport,
    mapWorld,
    mapImage,
    canvas,
    ctx,
    colorPicker,
    minimapCanvas,
    minimapViewport,
    minimapCtx,
    scale,
    state,
    resizeToMap,
    setDefaultCanvasSize,
    updateZoomDisplay,
    updateMinimap,
    updateMinimapViewport,
    makeDraggable,
    updatePeersList,
    updateStatus
} from './utils.js';

let tool = 'draw';
let drawing = false;
let currentUnitImage = null;
let undoStack = [];
let lineStart = null;
let lastDrawPoint = null;

let peer = null;
let myPeerId = null;
let connections = {};

function initPeer() {
    peer = new Peer({
        config: {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:global.stun.twilio.com:3478' }
            ]
        }
    });
    peer.on('open', id => {
        myPeerId = id;
        document.getElementById('my-session-id').value = id;
        updateStatus('Ready to connect', false);
        console.log('My peer ID is: ' + id);
    });
    peer.on('connection', conn => handleConnection(conn));
    peer.on('error', err => {
        console.error('PeerJS error:', err);
        updateStatus('Connection error', false);
    });
}

function handleConnection(conn) {
    conn.on('open', () => {
        console.log('Connected to:', conn.peer);
        connections[conn.peer] = conn;
        updatePeersList(Object.keys(connections).length, connections);
        updateStatus('Connected', true);
        sendFullState(conn);
    });
    conn.on('data', data => handleIncomingData(data, conn.peer));
    conn.on('close', () => {
        console.log('Connection closed:', conn.peer);
        delete connections[conn.peer];
        updatePeersList(Object.keys(connections).length, connections);
        if (Object.keys(connections).length === 0) {
            updateStatus('Ready to connect', false);
        }
    });
    conn.on('error', err => {
        console.error('Connection error with', conn.peer, err);
        delete connections[conn.peer];
        updatePeersList(Object.keys(connections).length, connections);
        if (Object.keys(connections).length === 0) {
            updateStatus('Connection failed - invalid ID', false);
            setTimeout(() => updateStatus('Ready to connect', false), 3000);
        }
    });
}

function connectToPeer() {
    const peerIdInput = document.getElementById('peer-session-id');
    const peerId = peerIdInput.value.trim();
    if (!peerId) return alert('Please enter a session ID');
    if (peerId === myPeerId) return alert('Cannot connect to yourself!');
    if (connections[peerId]) return alert('Already connected to this peer');
    updateStatus('Connecting...', false);
    const conn = peer.connect(peerId);
    const timeout = setTimeout(() => {
        if (!connections[conn.peer]) {
            console.log('Connection timeout for:', peerId);
            updateStatus('Connection failed - invalid ID or peer offline', false);
            setTimeout(() => {
                if (Object.keys(connections).length === 0) updateStatus('Ready to connect', false);
            }, 3000);
        }
    }, 10000);
    conn.on('open', () => clearTimeout(timeout));
    handleConnection(conn);
    peerIdInput.value = '';
}

function broadcastData(data) {
    Object.values(connections).forEach(conn => {
        if (conn.open) {
            try { conn.send(data); }
            catch (err) { console.error('Error broadcasting to', conn.peer, err); }
        }
    });
}

function sendFullState(conn) {
    if (!conn.open) return;
    try {
        const canvasData = canvas.toDataURL();
        conn.send({
            type: 'fullState',
            canvas: canvasData,
            markdown: document.getElementById('markdown-input').value,
            elements: serializeElements()
        });
    } catch (err) {
        console.error('Error sending full state:', err);
    }
}

function serializeElements() {
    const elements = [];
    mapWorld.querySelectorAll('.unit, .map-text, .marker').forEach(el => {
        elements.push({
            type: el.classList.contains('unit') ? 'unit' :
                el.classList.contains('marker') ? 'marker' : 'text',
            left: el.style.left,
            top: el.style.top,
            content: el.textContent || '',
            src: el.src || '',
            width: el.style.width || ''
        });
    });
    return elements;
}

function handleIncomingData(data, peerId) {
    try {
        switch (data.type) {
            case 'fullState':
                if (data.canvas) {
                    const img = new Image();
                    img.onload = () => ctx.drawImage(img, 0, 0);
                    img.src = data.canvas;
                }
                if (data.markdown) document.getElementById('markdown-input').value = data.markdown;
                if (data.elements) data.elements.forEach(el => deserializeElement(el));
                break;
            case 'draw':
                if (data.tool === 'erase') {
                    ctx.globalCompositeOperation = 'destination-out';
                    ctx.lineWidth = 20;
                } else {
                    ctx.globalCompositeOperation = 'source-over';
                    ctx.strokeStyle = data.color;
                    ctx.lineWidth = 3;
                }
                ctx.beginPath();
                ctx.moveTo(data.startX, data.startY);
                ctx.lineTo(data.endX, data.endY);
                ctx.stroke();
                ctx.globalCompositeOperation = 'source-over';
                updateMinimap();
                break;
            case 'line':
            case 'arrow':
                ctx.strokeStyle = data.color;
                ctx.fillStyle = data.color;
                ctx.lineWidth = 3;
                ctx.lineCap = 'round';
                if (data.type === 'arrow') {
                    drawArrow(data.x1, data.y1, data.x2, data.y2, true);
                } else {
                    ctx.beginPath();
                    ctx.moveTo(data.x1, data.y1);
                    ctx.lineTo(data.x2, data.y2);
                    ctx.stroke();
                }
                updateMinimap();
                break;
            case 'clear':
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                updateMinimap();
                break;
            case 'element':
                deserializeElement(data.element);
                break;
            case 'elementMove':
                const elMove = mapWorld.querySelector(`[data-element-id="${data.elementId}"]`);
                if (elMove) {
                    elMove.style.left = data.left;
                    elMove.style.top = data.top;
                }
                break;
            case 'elementDelete':
                const elDel = mapWorld.querySelector(`[data-element-id="${data.elementId}"]`);
                if (elDel) elDel.remove();
                break;
            case 'markdown':
                document.getElementById('markdown-input').value = data.content;
                break;
        }
    } catch (err) {
        console.error('Error handling incoming data:', err);
    }
}

function deserializeElement(data) {
    let el;
    if (data.type === 'unit') {
        el = document.createElement('img');
        el.src = data.src;
        el.className = 'unit';
        el.style.width = data.width;
    } else if (data.type === 'marker') {
        el = document.createElement('div');
        el.className = 'marker';
    } else if (data.type === 'text') {
        el = document.createElement('div');
        el.className = 'map-text';
        el.textContent = data.content;
    }
    el.style.left = data.left;
    el.style.top = data.top;
    el.dataset.elementId = Date.now() + '-' + Math.random();
    makeDraggable(el);
    mapWorld.appendChild(el);
}

function drawLineOrArrow(x1, y1, x2, y2) {
    ctx.strokeStyle = colorPicker.value;
    ctx.fillStyle = colorPicker.value;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    if (tool === 'arrow') {
        drawArrow(x1, y1, x2, y2, true);
    } else {
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
    }
    updateMinimap();
}

function drawArrow(x1, y1, x2, y2, commit) {
    const headlen = 15;
    const angle = Math.atan2(y2 - y1, x2 - x1);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headlen * Math.cos(angle - Math.PI / 6), y2 - headlen * Math.sin(angle - Math.PI / 6));
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headlen * Math.cos(angle + Math.PI / 6), y2 - headlen * Math.sin(angle + Math.PI / 6));
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headlen * Math.cos(angle - Math.PI / 6), y2 - headlen * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(x2 - headlen * Math.cos(angle + Math.PI / 6), y2 - headlen * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
}

window.toggleCollabPanel = function() {
    document.getElementById('collab-panel').classList.toggle('active');
};

window.copySessionId = function() {
    const input = document.getElementById('my-session-id');
    input.select();
    document.execCommand('copy');
    const btn = event.target.closest('.copy-btn');
    const originalHTML = btn.innerHTML;
    btn.innerHTML = '✓';
    setTimeout(() => btn.innerHTML = originalHTML, 1000);
};

window.connectToPeer = connectToPeer;

window.setTool = function(t) {
    tool = t;
    lineStart = null;
    document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelector(`[data-tool="${t}"]`)?.classList.add('active');
    if (t === 'line' || t === 'arrow') {
        canvas.style.cursor = 'crosshair';
    } else if (t === 'erase') {
        canvas.style.cursor = 'cell';
    } else {
        canvas.style.cursor = 'crosshair';
    }
};

window.clearDraw = function() {
    if (!confirm('Clear all drawings?')) return;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    undoStack.push(imageData);
    if (undoStack.length > 50) undoStack.shift();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    updateMinimap();
    broadcastData({ type: 'clear' });
};

window.zoom = function(factor) {
    const oldScale = scale;
    scale = Math.max(0.3, Math.min(3, scale * factor));
    mapWorld.style.transform = `scale(${scale})`;
    const rect = viewport.getBoundingClientRect();
    const centerX = viewport.scrollLeft + rect.width / 2;
    const centerY = viewport.scrollTop + rect.height / 2;
    viewport.scrollLeft = centerX * (scale / oldScale) - rect.width / 2;
    viewport.scrollTop = centerY * (scale / oldScale) - rect.height / 2;
    updateZoomDisplay();
    updateMinimapViewport();
};

window.resetView = function() {
    scale = 1;
    mapWorld.style.transform = `scale(${scale})`;
    viewport.scrollLeft = 0;
    viewport.scrollTop = 0;
    updateZoomDisplay();
    updateMinimapViewport();
};

window.undo = function() {
    if (undoStack.length === 0) return;
    const prevState = undoStack.pop();
    ctx.putImageData(prevState, 0, 0);
    updateMinimap();
};

canvas.addEventListener('mousedown', e => {
    if (tool === 'line' || tool === 'arrow') {
        if (!lineStart) {
            lineStart = { x: e.offsetX, y: e.offsetY };
        } else {
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            undoStack.push(imageData);
            if (undoStack.length > 50) undoStack.shift();
            drawLineOrArrow(lineStart.x, lineStart.y, e.offsetX, e.offsetY);
            broadcastData({
                type: tool,
                x1: lineStart.x,
                y1: lineStart.y,
                x2: e.offsetX,
                y2: e.offsetY,
                color: colorPicker.value
            });
            lineStart = null;
            canvas.style.cursor = 'crosshair';
        }
        return;
    }
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    undoStack.push(imageData);
    if (undoStack.length > 50) undoStack.shift();
    drawing = true;
    lastDrawPoint = { x: e.offsetX, y: e.offsetY };
    ctx.beginPath();
    ctx.moveTo(e.offsetX, e.offsetY);
});

canvas.addEventListener('mousemove', e => {
    if (tool === 'line' || tool === 'arrow') {
        if (lineStart) {
            canvas.style.cursor = 'crosshair';
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = canvas.width;
            tempCanvas.height = canvas.height;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.drawImage(canvas, 0, 0);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.putImageData(undoStack[undoStack.length - 1] || ctx.createImageData(canvas.width, canvas.height), 0, 0);
            ctx.strokeStyle = colorPicker.value;
            ctx.lineWidth = 3;
            ctx.lineCap = 'round';
            if (tool === 'arrow') {
                drawArrow(lineStart.x, lineStart.y, e.offsetX, e.offsetY, false);
            } else {
                ctx.beginPath();
                ctx.moveTo(lineStart.x, lineStart.y);
                ctx.lineTo(e.offsetX, e.offsetY);
                ctx.stroke();
            }
        }
        return;
    }
    if (!drawing) return;
    if (tool === 'erase') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineWidth = 20;
        ctx.lineCap = 'round';
    } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = colorPicker.value;
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
    }
    ctx.lineTo(e.offsetX, e.offsetY);
    ctx.stroke();
    if (lastDrawPoint && Object.keys(connections).length > 0) {
        broadcastData({
            type: 'draw',
            tool: tool,
            startX: lastDrawPoint.x,
            startY: lastDrawPoint.y,
            endX: e.offsetX,
            endY: e.offsetY,
            color: colorPicker.value
        });
    }
    lastDrawPoint = { x: e.offsetX, y: e.offsetY };
});

window.addEventListener('mouseup', () => {
    if (drawing) {
        drawing = false;
        lastDrawPoint = null;
        ctx.globalCompositeOperation = 'source-over';
        updateMinimap();
    }
});

viewport.addEventListener('wheel', e => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    window.zoom(e.deltaY < 0 ? 1.1 : 0.9);
}, { passive: false });

viewport.addEventListener('scroll', updateMinimapViewport);

window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const key = e.key.toLowerCase();
    const panSpeed = 40;
    if (key === 'w') { e.preventDefault(); viewport.scrollTop -= panSpeed; }
    if (key === 's') { e.preventDefault(); viewport.scrollTop += panSpeed; }
    if (key === 'a') { e.preventDefault(); viewport.scrollLeft -= panSpeed; }
    if (key === 'd') { e.preventDefault(); viewport.scrollLeft += panSpeed; }
    if (e.shiftKey && key === 'd') { e.preventDefault(); window.setTool('draw'); }
    if (e.shiftKey && key === 'e') { e.preventDefault(); window.setTool('erase'); }
    if (e.shiftKey && key === 'l') { e.preventDefault(); window.setTool('line'); }
    if (e.shiftKey && key === 'a') { e.preventDefault(); window.setTool('arrow'); }
    if ((e.ctrlKey || e.metaKey) && key === 'z') { e.preventDefault(); window.undo(); }
    if (key === '+' || key === '=') { e.preventDefault(); window.zoom(1.1); }
    if (key === '-' || key === '_') { e.preventDefault(); window.zoom(0.9); }
    if (key === 'r') { e.preventDefault(); window.resetView(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); viewport.scrollTop -= panSpeed; }
    if (e.key === 'ArrowDown') { e.preventDefault(); viewport.scrollTop += panSpeed; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); viewport.scrollLeft -= panSpeed; }
    if (e.key === 'ArrowRight') { e.preventDefault(); viewport.scrollLeft += panSpeed; }
});

window.uploadMap = function() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = e => {
        const file = e.target.files[0];
        if (!file) return;
        const url = URL.createObjectURL(file);
        mapImage.onload = () => {
            resizeToMap(mapImage.naturalWidth, mapImage.naturalHeight);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            undoStack.push(imageData);
            if (undoStack.length > 50) undoStack.shift();
        };
        mapImage.src = url;
    };
    input.click();
};

window.loadUnitImage = function(e) {
    const file = e.target.files[0];
    if (!file) return;
    currentUnitImage = URL.createObjectURL(file);
    const filenameDisplay = document.getElementById('unit-filename');
    if (filenameDisplay) {
        filenameDisplay.textContent = file.name;
        filenameDisplay.style.color = 'var(--accent)';
    }
};

window.addUnit = function() {
    if (!currentUnitImage) return alert('Please upload a unit PNG first');
    const img = document.createElement('img');
    img.src = currentUnitImage;
    img.className = 'unit';
    img.style.width = '48px';
    img.style.height = 'auto';
    img.style.left = (viewport.scrollLeft + viewport.clientWidth / 2) / scale + 'px';
    img.style.top = (viewport.scrollTop + viewport.clientHeight / 2) / scale + 'px';
    img.style.display = state.layers.units ? 'block' : 'none';
    img.dataset.elementId = Date.now() + '-' + Math.random();
    makeDraggable(img);
    mapWorld.appendChild(img);
    broadcastData({
        type: 'element',
        element: {
            type: 'unit',
            src: currentUnitImage,
            left: img.style.left,
            top: img.style.top,
            width: img.style.width
        }
    });
};

window.addMapText = function() {
    const text = prompt('Enter label text:');
    if (!text) return;
    const div = document.createElement('div');
    div.className = 'map-text';
    div.textContent = text;
    div.style.left = (viewport.scrollLeft + viewport.clientWidth / 2) / scale + 'px';
    div.style.top = (viewport.scrollTop + viewport.clientHeight / 2) / scale + 'px';
    div.dataset.elementId = Date.now() + '-' + Math.random();
    makeDraggable(div);
    mapWorld.appendChild(div);
    broadcastData({
        type: 'element',
        element: {
            type: 'text',
            content: text,
            left: div.style.left,
            top: div.style.top
        }
    });
};

window.addMarker = function() {
    const div = document.createElement('div');
    div.className = 'marker';
    div.style.left = (viewport.scrollLeft + viewport.clientWidth / 2) / scale + 'px';
    div.style.top = (viewport.scrollTop + viewport.clientHeight / 2) / scale + 'px';
    div.dataset.elementId = Date.now() + '-' + Math.random();
    makeDraggable(div);
    mapWorld.appendChild(div);
    broadcastData({
        type: 'element',
        element: {
            type: 'marker',
            left: div.style.left,
            top: div.style.top
        }
    });
};

const mdInput = document.getElementById('markdown-input');
const mdPreview = document.getElementById('markdown-preview');

mdInput.addEventListener('input', () => {
    broadcastData({
        type: 'markdown',
        content: mdInput.value
    });
});

window.setMarkdownMode = function(mode) {
    const editBtn = document.querySelector('.tabs .tab-btn:first-child');
    const previewBtn = document.querySelector('.tabs .tab-btn:last-child');
    if (mode === 'preview') {
        mdPreview.innerHTML = marked.parse(mdInput.value || '*No content yet*');
        mdPreview.style.display = 'block';
        mdInput.style.display = 'none';
        editBtn?.classList.remove('active');
        previewBtn?.classList.add('active');
    } else {
        mdPreview.style.display = 'none';
        mdInput.style.display = 'block';
        editBtn?.classList.add('active');
        previewBtn?.classList.remove('active');
    }
};

window.toggleGrid = function() {
    state.layers.grid = !state.layers.grid;
    if (state.layers.grid) {
        viewport.classList.remove('no-grid');
    } else {
        viewport.classList.add('no-grid');
    }
};

window.toggleUnits = function() {
    state.layers.units = !state.layers.units;
    document.querySelectorAll('.unit').forEach(unit => {
        unit.style.display = state.layers.units ? 'block' : 'none';
    });
};

window.toggleDrawings = function() {
    state.layers.drawings = !state.layers.drawings;
    canvas.style.display = state.layers.drawings ? 'block' : 'none';
};

window.saveSnapshot = function() {
    const snap = document.createElement('canvas');
    const viewWidth = viewport.clientWidth;
    const viewHeight = viewport.clientHeight;
    snap.width = viewWidth;
    snap.height = viewHeight;
    const sctx = snap.getContext('2d');
    const sx = viewport.scrollLeft / scale;
    const sy = viewport.scrollTop / scale;
    const sw = viewWidth / scale;
    const sh = viewHeight / scale;
    if (mapImage.src && mapImage.complete && mapImage.naturalWidth) {
        sctx.drawImage(mapImage, sx, sy, sw, sh, 0, 0, viewWidth, viewHeight);
    } else {
        sctx.fillStyle = '#0f1729';
        sctx.fillRect(0, 0, viewWidth, viewHeight);
        const gridSize = 20 * scale;
        sctx.strokeStyle = 'rgba(79, 209, 197, 0.1)';
        sctx.lineWidth = 1;
        for (let x = -sx * scale % gridSize; x < viewWidth; x += gridSize) {
            sctx.beginPath();
            sctx.moveTo(x, 0);
            sctx.lineTo(x, viewHeight);
            sctx.stroke();
        }
        for (let y = -sy * scale % gridSize; y < viewHeight; y += gridSize) {
            sctx.beginPath();
            sctx.moveTo(0, y);
            sctx.lineTo(viewWidth, y);
            sctx.stroke();
        }
    }
    if (state.layers.drawings) {
        sctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, viewWidth, viewHeight);
    }
    if (state.layers.units) {
        const elements = mapWorld.querySelectorAll('.unit, .map-text, .marker');
        elements.forEach(el => {
            const rect = el.getBoundingClientRect();
            const worldRect = mapWorld.getBoundingClientRect();
            const x = ((rect.left + rect.width / 2 - worldRect.left) / scale - sx) * scale;
            const y = ((rect.top + rect.height / 2 - worldRect.top) / scale - sy) * scale;
            if (x >= 0 && x <= viewWidth && y >= 0 && y <= viewHeight) {
                if (el.tagName === 'IMG') {
                    sctx.drawImage(el, x - rect.width / 2, y - rect.height / 2, rect.width, rect.height);
                } else if (el.classList.contains('map-text')) {
                    sctx.fillStyle = 'rgba(18, 24, 49, 0.95)';
                    sctx.strokeStyle = '#4fd1c5';
                    sctx.lineWidth = 1;
                    const text = el.textContent;
                    sctx.font = '13px Inter';
                    const metrics = sctx.measureText(text);
                    const padding = 10;
                    sctx.fillRect(x - metrics.width / 2 - padding, y - 10 - padding, metrics.width + padding * 2, 26);
                    sctx.strokeRect(x - metrics.width / 2 - padding, y - 10 - padding, metrics.width + padding * 2, 26);
                    sctx.fillStyle = '#e2e8f0';
                    sctx.fillText(text, x - metrics.width / 2, y + 5);
                } else if (el.classList.contains('marker')) {
                    sctx.fillStyle = '#4fd1c5';
                    sctx.strokeStyle = 'white';
                    sctx.lineWidth = 3;
                    sctx.save();
                    sctx.translate(x, y);
                    sctx.rotate(-Math.PI / 4);
                    sctx.beginPath();
                    sctx.arc(0, -6, 12, 0, Math.PI * 2);
                    sctx.fill();
                    sctx.stroke();
                    sctx.fillStyle = 'white';
                    sctx.beginPath();
                    sctx.arc(0, -6, 4, 0, Math.PI * 2);
                    sctx.fill();
                    sctx.restore();
                }
            }
        });
    }
    const a = document.createElement('a');
    a.href = snap.toDataURL('image/png');
    a.download = 'tacticalgrid-snapshot-' + Date.now() + '.png';
    a.click();
};

setDefaultCanvasSize();
updateZoomDisplay();
initPeer();