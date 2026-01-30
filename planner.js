const viewport = document.getElementById('map-viewport');
const mapWorld = document.getElementById('map-world');
const mapImage = document.getElementById('map-image');
const canvas = document.getElementById('draw-layer');
const ctx = canvas.getContext('2d');
const colorPicker = document.getElementById('colorPicker');
const minimapCanvas = document.getElementById('minimap-canvas');
const minimapViewport = document.getElementById('minimap-viewport');
const minimapCtx = minimapCanvas ? minimapCanvas.getContext('2d') : null;

let tool = 'draw';
let drawing = false;
let scale = 1;
let currentUnitImage = null;
let undoStack = [];
let lineStart = null;

// State management
const state = {
    layers: {
        grid: true,
        units: true,
        drawings: true
    }
};

/* ===== COLLABORATION VARIABLES ===== */
let peer = null;
let myPeerId = null;
let connections = {};

/* ===== INIT PEER CONNECTION ===== */
function initPeer() {
    peer = new Peer({
        config: {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:global.stun.twilio.com:3478' }
            ]
        }
    });

    peer.on('open', (id) => {
        myPeerId = id;
        document.getElementById('my-session-id').value = id;
        updateStatus('Ready to connect', false);
        console.log('My peer ID is: ' + id);
    });

    peer.on('connection', (conn) => {
        handleConnection(conn);
    });

    peer.on('error', (err) => {
        console.error('PeerJS error:', err);
        updateStatus('Connection error', false);
    });
}

/* ===== HANDLE PEER CONNECTIONS ===== */
function handleConnection(conn) {
    conn.on('open', () => {
        console.log('Connected to:', conn.peer);
        // Only add to connections list after successful connection
        connections[conn.peer] = conn;
        updatePeersList();
        updateStatus('Connected', true);

        // Send current state to new peer
        sendFullState(conn);
    });

    conn.on('data', (data) => {
        handleIncomingData(data, conn.peer);
    });

    conn.on('close', () => {
        console.log('Connection closed:', conn.peer);
        delete connections[conn.peer];
        updatePeersList();
        if (Object.keys(connections).length === 0) {
            updateStatus('Ready to connect', false);
        }
    });

    conn.on('error', (err) => {
        console.error('Connection error with', conn.peer, err);
        delete connections[conn.peer];
        updatePeersList();
        if (Object.keys(connections).length === 0) {
            updateStatus('Connection failed - invalid ID', false);
            setTimeout(() => {
                updateStatus('Ready to connect', false);
            }, 3000);
        }
    });
}

/* ===== CONNECT TO PEER ===== */
function connectToPeer() {
    const peerIdInput = document.getElementById('peer-session-id');
    const peerId = peerIdInput.value.trim();

    if (!peerId) {
        alert('Please enter a session ID');
        return;
    }

    if (peerId === myPeerId) {
        alert('Cannot connect to yourself!');
        return;
    }

    if (connections[peerId]) {
        alert('Already connected to this peer');
        return;
    }

    updateStatus('Connecting...', false);
    const conn = peer.connect(peerId);

    // Set a timeout for failed connections
    const timeout = setTimeout(() => {
        if (!connections[conn.peer]) {
            console.log('Connection timeout for:', peerId);
            updateStatus('Connection failed - invalid ID or peer offline', false);
            setTimeout(() => {
                if (Object.keys(connections).length === 0) {
                    updateStatus('Ready to connect', false);
                }
            }, 3000);
        }
    }, 10000);

    conn.on('open', () => {
        clearTimeout(timeout);
    });

    handleConnection(conn);
    peerIdInput.value = '';
}

/* ===== SEND DATA TO ALL PEERS ===== */
function broadcastData(data) {
    Object.values(connections).forEach(conn => {
        if (conn.open) {
            try {
                conn.send(data);
            } catch (err) {
                console.error('Error broadcasting to', conn.peer, err);
            }
        }
    });
}

/* ===== SEND FULL STATE TO NEW PEER ===== */
function sendFullState(conn) {
    if (!conn.open) return;

    try {
        // Send canvas drawing
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

/* ===== SERIALIZE ELEMENTS ===== */
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

/* ===== HANDLE INCOMING DATA ===== */
function handleIncomingData(data) {
    try {
        switch(data.type) {
            case 'fullState':
                // Load canvas
                if (data.canvas) {
                    const img = new Image();
                    img.onload = () => {
                        ctx.drawImage(img, 0, 0);
                    };
                    img.src = data.canvas;
                }

                // Load markdown
                if (data.markdown) {
                    document.getElementById('markdown-input').value = data.markdown;
                }

                // Load elements
                if (data.elements) {
                    data.elements.forEach(el => {
                        deserializeElement(el);
                    });
                }
                break;

            case 'draw':
                // Remote drawing
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
                updateElementPosition(data.elementId, data.left, data.top);
                break;

            case 'elementDelete':
                deleteElement(data.elementId);
                break;

            case 'markdown':
                document.getElementById('markdown-input').value = data.content;
                break;
        }
    } catch (err) {
        console.error('Error handling incoming data:', err);
    }
}

/* ===== DESERIALIZE ELEMENT ===== */
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

/* ===== UPDATE ELEMENT POSITION ===== */
function updateElementPosition(elementId, left, top) {
    const el = mapWorld.querySelector(`[data-element-id="${elementId}"]`);
    if (el) {
        el.style.left = left;
        el.style.top = top;
    }
}

/* ===== DELETE ELEMENT ===== */
function deleteElement(elementId) {
    const el = mapWorld.querySelector(`[data-element-id="${elementId}"]`);
    if (el) {
        el.remove();
    }
}

/* ===== UPDATE UI ===== */
function updatePeersList() {
    const container = document.getElementById('connected-peers');
    const count = Object.keys(connections).length;
    document.getElementById('peer-count').textContent = count;

    const collabBtn = document.getElementById('collab-btn');
    const collabCount = document.getElementById('collab-count');

    if (count === 0) {
        container.innerHTML = '<div class="no-peers">No one connected yet</div>';
        collabBtn.classList.remove('connected');
        collabCount.textContent = 'Solo';
    } else {
        container.innerHTML = '';
        Object.keys(connections).forEach(peerId => {
            const peerDiv = document.createElement('div');
            peerDiv.className = 'peer-item';
            peerDiv.innerHTML = `
                <div class="peer-avatar">${peerId.substring(0, 2).toUpperCase()}</div>
                <div class="peer-info">
                    <div class="peer-name">User</div>
                    <div class="peer-id">${peerId.substring(0, 8)}...</div>
                </div>
            `;
            container.appendChild(peerDiv);
        });
        collabBtn.classList.add('connected');
        collabCount.textContent = count + (count === 1 ? ' User' : ' Users');
    }
}

function updateStatus(text, connected) {
    document.getElementById('status-text').textContent = text;
    const indicator = document.getElementById('status-indicator');
    indicator.className = 'status-indicator';
    if (connected) {
        indicator.classList.add('connected');
    } else if (text === 'Connecting...') {
        indicator.classList.add('connecting');
    }
}

// Make functions globally accessible
window.toggleCollabPanel = function() {
    document.getElementById('collab-panel').classList.toggle('active');
}

window.copySessionId = function() {
    const input = document.getElementById('my-session-id');
    input.select();
    document.execCommand('copy');

    const btn = event.target.closest('.copy-btn');
    const originalHTML = btn.innerHTML;
    btn.innerHTML = '✓';
    setTimeout(() => {
        btn.innerHTML = originalHTML;
    }, 1000);
}

window.connectToPeer = connectToPeer;

/* ===== RESIZE & INIT ===== */
function resizeToMap(w, h) {
    mapWorld.style.width = w + 'px';
    mapWorld.style.height = h + 'px';
    canvas.width = w;
    canvas.height = h;

    if (minimapCanvas) {
        updateMinimap();
    }
}

function setDefaultCanvasSize() {
    // Set a default size when no map is loaded (A4-ish landscape proportions)
    const defaultWidth = 2000;
    const defaultHeight = 1414;
    resizeToMap(defaultWidth, defaultHeight);
}

/* ===== UNDO SYSTEM ===== */
function saveState() {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    undoStack.push(imageData);
    if (undoStack.length > 50) undoStack.shift();
}

window.undo = function() {
    if (undoStack.length > 0) {
        const prevState = undoStack.pop();
        ctx.putImageData(prevState, 0, 0);
        updateMinimap();
    }
}

/* ===== DRAWING ===== */
let lastDrawPoint = null;

canvas.addEventListener('mousedown', e => {
    if (tool === 'line' || tool === 'arrow') {
        if (!lineStart) {
            lineStart = { x: e.offsetX, y: e.offsetY };
        } else {
            saveState();
            drawLineOrArrow(lineStart.x, lineStart.y, e.offsetX, e.offsetY);

            // Broadcast to peers
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

    saveState();
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

    // Broadcast drawing to peers (throttled)
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

window.setTool = function(t) {
    tool = t;
    lineStart = null;

    document.querySelectorAll('.tool-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`[data-tool="${t}"]`)?.classList.add('active');

    if (t === 'line' || t === 'arrow') {
        canvas.style.cursor = 'crosshair';
    } else if (t === 'erase') {
        canvas.style.cursor = 'cell';
    } else {
        canvas.style.cursor = 'crosshair';
    }
}

window.clearDraw = function() {
    if (confirm('Clear all drawings?')) {
        saveState();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        updateMinimap();

        // Broadcast to peers
        broadcastData({ type: 'clear' });
    }
}

/* ===== ZOOM ===== */
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
}

function updateZoomDisplay() {
    const display = document.getElementById('zoom-level');
    if (display) {
        display.textContent = Math.round(scale * 100) + '%';
    }
}

window.resetView = function() {
    scale = 1;
    mapWorld.style.transform = `scale(${scale})`;
    viewport.scrollLeft = 0;
    viewport.scrollTop = 0;
    updateZoomDisplay();
    updateMinimapViewport();
}

viewport.addEventListener('wheel', e => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    window.zoom(e.deltaY < 0 ? 1.1 : 0.9);
}, { passive: false });

viewport.addEventListener('scroll', updateMinimapViewport);

/* ===== KEYBOARD SHORTCUTS ===== */
window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
    }

    const key = e.key.toLowerCase();

    const panSpeed = 40;
    if (key === 'w') {
        e.preventDefault();
        viewport.scrollTop -= panSpeed;
    }
    if (key === 's') {
        e.preventDefault();
        viewport.scrollTop += panSpeed;
    }
    if (key === 'a') {
        e.preventDefault();
        viewport.scrollLeft -= panSpeed;
    }
    if (key === 'd') {
        e.preventDefault();
        viewport.scrollLeft += panSpeed;
    }

    if (e.shiftKey && key === 'd') {
        e.preventDefault();
        window.setTool('draw');
    }
    if (e.shiftKey && key === 'e') {
        e.preventDefault();
        window.setTool('erase');
    }
    if (e.shiftKey && key === 'l') {
        e.preventDefault();
        window.setTool('line');
    }
    if (e.shiftKey && key === 'a') {
        e.preventDefault();
        window.setTool('arrow');
    }

    if ((e.ctrlKey || e.metaKey) && key === 'z') {
        e.preventDefault();
        window.undo();
    }

    if (key === '+' || key === '=') {
        e.preventDefault();
        window.zoom(1.1);
    }
    if (key === '-' || key === '_') {
        e.preventDefault();
        window.zoom(0.9);
    }
    if (key === 'r') {
        e.preventDefault();
        window.resetView();
    }

    if (e.key === 'ArrowUp') {
        e.preventDefault();
        viewport.scrollTop -= panSpeed;
    }
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        viewport.scrollTop += panSpeed;
    }
    if (e.key === 'ArrowLeft') {
        e.preventDefault();
        viewport.scrollLeft -= panSpeed;
    }
    if (e.key === 'ArrowRight') {
        e.preventDefault();
        viewport.scrollLeft += panSpeed;
    }
});

/* ===== MAP UPLOAD ===== */
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
            saveState();
        };
        mapImage.src = url;
    };
    input.click();
}

/* ===== UNITS ===== */
window.loadUnitImage = function(e) {
    const file = e.target.files[0];
    if (!file) return;

    currentUnitImage = URL.createObjectURL(file);

    const filenameDisplay = document.getElementById('unit-filename');
    if (filenameDisplay) {
        filenameDisplay.textContent = file.name;
        filenameDisplay.style.color = 'var(--accent)';
    }
}

window.addUnit = function() {
    if (!currentUnitImage) {
        alert('Please upload a unit PNG first');
        return;
    }

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

    // Broadcast to peers
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
}

/* ===== MAP TEXT ===== */
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

    // Broadcast to peers
    broadcastData({
        type: 'element',
        element: {
            type: 'text',
            content: text,
            left: div.style.left,
            top: div.style.top
        }
    });
}

/* ===== MARKERS ===== */
window.addMarker = function() {
    const div = document.createElement('div');
    div.className = 'marker';
    div.style.left = (viewport.scrollLeft + viewport.clientWidth / 2) / scale + 'px';
    div.style.top = (viewport.scrollTop + viewport.clientHeight / 2) / scale + 'px';
    div.dataset.elementId = Date.now() + '-' + Math.random();

    makeDraggable(div);
    mapWorld.appendChild(div);

    // Broadcast to peers
    broadcastData({
        type: 'element',
        element: {
            type: 'marker',
            left: div.style.left,
            top: div.style.top
        }
    });
}

/* ===== DRAG HELPER ===== */
function makeDraggable(el) {
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let initialLeft = 0;
    let initialTop = 0;

    el.addEventListener('mousedown', e => {
        e.preventDefault();
        e.stopPropagation();

        dragging = true;

        initialLeft = parseFloat(el.style.left) || 0;
        initialTop = parseFloat(el.style.top) || 0;

        const worldRect = mapWorld.getBoundingClientRect();
        startX = (e.clientX - worldRect.left) / scale;
        startY = (e.clientY - worldRect.top) / scale;
    });

    const handleMouseMove = (e) => {
        if (!dragging) return;

        const worldRect = mapWorld.getBoundingClientRect();
        const currentX = (e.clientX - worldRect.left) / scale;
        const currentY = (e.clientY - worldRect.top) / scale;

        const deltaX = currentX - startX;
        const deltaY = currentY - startY;

        el.style.left = (initialLeft + deltaX) + 'px';
        el.style.top = (initialTop + deltaY) + 'px';
    };

    const handleMouseUp = () => {
        if (dragging) {
            dragging = false;

            // Broadcast position update
            if (el.dataset.elementId) {
                broadcastData({
                    type: 'elementMove',
                    elementId: el.dataset.elementId,
                    left: el.style.left,
                    top: el.style.top
                });
            }
        }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    el.addEventListener('contextmenu', e => {
        e.preventDefault();
        if (confirm('Delete this element?')) {
            const elementId = el.dataset.elementId;
            el.remove();

            // Broadcast deletion
            if (elementId) {
                broadcastData({
                    type: 'elementDelete',
                    elementId: elementId
                });
            }
        }
    });
}

/* ===== MARKDOWN ===== */
const mdInput = document.getElementById('markdown-input');
const mdPreview = document.getElementById('markdown-preview');

// Sync markdown changes
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
}

/* ===== LAYERS ===== */
window.toggleGrid = function() {
    state.layers.grid = !state.layers.grid;
    if (state.layers.grid) {
        viewport.classList.remove('no-grid');
    } else {
        viewport.classList.add('no-grid');
    }
}

window.toggleUnits = function() {
    state.layers.units = !state.layers.units;
    document.querySelectorAll('.unit').forEach(unit => {
        unit.style.display = state.layers.units ? 'block' : 'none';
    });
}

window.toggleDrawings = function() {
    state.layers.drawings = !state.layers.drawings;
    canvas.style.display = state.layers.drawings ? 'block' : 'none';
}

/* ===== MINIMAP ===== */
function updateMinimap() {
    if (!minimapCanvas) return;

    // If no map image, just show the canvas drawings on a dark background
    if (!mapImage.src || !mapImage.complete || !mapImage.naturalWidth) {
        const aspectRatio = canvas.width / canvas.height;
        minimapCanvas.width = 180;
        minimapCanvas.height = 180 / aspectRatio;

        // Draw dark background
        minimapCtx.fillStyle = '#1a1f3a';
        minimapCtx.fillRect(0, 0, minimapCanvas.width, minimapCanvas.height);

        // Draw canvas content
        minimapCtx.globalAlpha = 0.7;
        minimapCtx.drawImage(canvas, 0, 0, minimapCanvas.width, minimapCanvas.height);
        minimapCtx.globalAlpha = 1.0;

        updateMinimapViewport();
        return;
    }

    const aspectRatio = mapImage.naturalWidth / mapImage.naturalHeight;

    minimapCanvas.width = 180;
    minimapCanvas.height = 180 / aspectRatio;

    minimapCtx.drawImage(mapImage, 0, 0, minimapCanvas.width, minimapCanvas.height);

    minimapCtx.globalAlpha = 0.7;
    minimapCtx.drawImage(canvas, 0, 0, minimapCanvas.width, minimapCanvas.height);
    minimapCtx.globalAlpha = 1.0;

    updateMinimapViewport();
}

function updateMinimapViewport() {
    if (!minimapViewport) return;

    let scaleX, scaleY;

    // Handle case with no map image
    if (!mapImage.src || !mapImage.complete || !mapImage.naturalWidth) {
        scaleX = minimapCanvas.width / canvas.width;
        scaleY = minimapCanvas.height / canvas.height;
    } else {
        scaleX = minimapCanvas.width / mapImage.naturalWidth;
        scaleY = minimapCanvas.height / mapImage.naturalHeight;
    }

    const vpWidth = viewport.clientWidth / scale;
    const vpHeight = viewport.clientHeight / scale;
    const vpLeft = viewport.scrollLeft / scale;
    const vpTop = viewport.scrollTop / scale;

    minimapViewport.style.left = (vpLeft * scaleX) + 'px';
    minimapViewport.style.top = (vpTop * scaleY) + 'px';
    minimapViewport.style.width = (vpWidth * scaleX) + 'px';
    minimapViewport.style.height = (vpHeight * scaleY) + 'px';
}

/* ===== SNAPSHOT ===== */
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

    // Draw background
    if (mapImage.src && mapImage.complete && mapImage.naturalWidth) {
        // Draw map image if available
        sctx.drawImage(mapImage, sx, sy, sw, sh, 0, 0, viewWidth, viewHeight);
    } else {
        // Draw grid background if no map
        sctx.fillStyle = '#0f1729';
        sctx.fillRect(0, 0, viewWidth, viewHeight);

        // Draw grid pattern
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

                    sctx.fillRect(x - metrics.width / 2 - padding, y - 10 - padding,
                        metrics.width + padding * 2, 26);
                    sctx.strokeRect(x - metrics.width / 2 - padding, y - 10 - padding,
                        metrics.width + padding * 2, 26);

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
}

/* ===== INIT ===== */
setDefaultCanvasSize(); // Set default size before map is loaded
updateZoomDisplay();
initPeer();