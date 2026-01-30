export const viewport = document.getElementById('map-viewport');
export const mapWorld = document.getElementById('map-world');
export const mapImage = document.getElementById('map-image');
export const canvas = document.getElementById('draw-layer');
export const ctx = canvas.getContext('2d');
export const colorPicker = document.getElementById('colorPicker');
export const minimapCanvas = document.getElementById('minimap-canvas');
export const minimapViewport = document.getElementById('minimap-viewport');
export const minimapCtx = minimapCanvas ? minimapCanvas.getContext('2d') : null;

export let scale = 1;
export const state = {
    layers: {
        grid: true,
        units: true,
        drawings: true
    }
};

export function resizeToMap(w, h) {
    mapWorld.style.width = w + 'px';
    mapWorld.style.height = h + 'px';
    canvas.width = w;
    canvas.height = h;
    if (minimapCanvas) updateMinimap();
}

export function setDefaultCanvasSize() {
    const defaultWidth = 2000;
    const defaultHeight = 1414;
    resizeToMap(defaultWidth, defaultHeight);
}

export function updateZoomDisplay() {
    const display = document.getElementById('zoom-level');
    if (display) display.textContent = Math.round(scale * 100) + '%';
}

export function updateMinimap() {
    if (!minimapCanvas) return;
    if (!mapImage.src || !mapImage.complete || !mapImage.naturalWidth) {
        const aspectRatio = canvas.width / canvas.height;
        minimapCanvas.width = 180;
        minimapCanvas.height = 180 / aspectRatio;
        minimapCtx.fillStyle = '#1a1f3a';
        minimapCtx.fillRect(0, 0, minimapCanvas.width, minimapCanvas.height);
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

export function updateMinimapViewport() {
    if (!minimapViewport) return;
    let scaleX, scaleY;
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

export function makeDraggable(el) {
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
    const handleMouseMove = e => {
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
        }
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    el.addEventListener('contextmenu', e => {
        e.preventDefault();
        if (confirm('Delete this element?')) {
            el.remove();
        }
    });
}

export function updatePeersList(count, connections) {
    const container = document.getElementById('connected-peers');
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

export function updateStatus(text, connected) {
    document.getElementById('status-text').textContent = text;
    const indicator = document.getElementById('status-indicator');
    indicator.className = 'status-indicator';
    if (connected) {
        indicator.classList.add('connected');
    } else if (text === 'Connecting...') {
        indicator.classList.add('connecting');
    }
}