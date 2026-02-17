/**
 * Academic Viewer V4 - Core Logic (Enhanced & Stabilized)
 */

const { pdfjsLib } = window;

const state = {
    pdf: null,
    zoom: 1.2,
    currentPage: 1,
    isDarkMode: localStorage.getItem('pdf-dark-mode') === 'true',
    isEnhancedMode: localStorage.getItem('enhanced-mode') === 'true',
    serverConnected: false,
    fullMarkdown: "", // Cache for full document markdown
    isExtracting: false,
    sidebarVisible: true,
    activeTab: 'outline',
    renderQueue: [],
    renderTasks: {}, // Track active render tasks
    viewMode: 'single', // 'single', 'spread', 'triple'
    zoomMode: 'manual',  // 'manual', 'page-fit', 'page-width'
    visiblePageThreshold: 1.5, // Render pages within 1.5 screen heights
    maxRenderedPages: 10, // Maximum number of pages to keep rendered in memory
    renderedPages: new Set(), // Track currently rendered pages
    garbageCollectionInterval: null, // Interval for cleaning up unused pages
    apiKey: null
};

const elements = {
    viewer: document.getElementById('pdfViewer'),
    container: document.getElementById('viewerContainer'),
    zoomLevel: document.getElementById('zoomLevel'),
    pageNumber: document.getElementById('pageNumber'),
    pageTotal: document.getElementById('pageTotal'),
    title: document.getElementById('docTitle'),
    sidebar: document.getElementById('sidebar'),
    outlineView: document.getElementById('outlineView'),
    thumbnailsView: document.getElementById('thumbnailsView')
};

async function init() {
    const params = new URLSearchParams(window.location.search);
    const fileUrl = params.get('file');

    if (!fileUrl) {
        alert("未找到 PDF 文件路径。");
        return;
    }

    // Set worker source
    pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('src/pdf/build/pdf.worker.js');

    try {
        console.log("XiaoEt: Loading PDF via Core API...", fileUrl);

        // Configuration for stability in extension environment
        const loadingTask = pdfjsLib.getDocument({
            url: fileUrl,
            cMapUrl: chrome.runtime.getURL('src/pdf/web/cmaps/'),
            cMapPacked: true,
            standardFontDataUrl: chrome.runtime.getURL('src/pdf/web/standard_fonts/'),
            // Removed restrictive options that might cause rendering truncation on some PDFs
            disableFontFace: false,
            fontExtraProperties: true
        });

        state.pdf = await loadingTask.promise;

        elements.pageTotal.textContent = `/ ${state.pdf.numPages}`;
        elements.title.textContent = decodeURIComponent(fileUrl.split('/').pop().split('?')[0]);

        applyDarkMode(state.isDarkMode);

        // 1. Pre-generate containers to lock layout
        await prepareLayout();

        // 2. Fetch non-visual data in background
        fetchOutline().catch(e => console.warn("Outline load failed:", e));
        renderThumbnails().catch(e => console.warn("Thumbnails load failed:", e));

        // 3. Setup interaction events
        setupEvents();
        // Server checks removed

        // 4. Start rendering
        renderAllPages();

        document.body.classList.add('loaded');
    } catch (err) {
        console.error("XiaoEt PDF Critical Error:", err);
        alert("加载 PDF 失败: " + err.message);
    }
}

// Optimized rendering: only render what's near the viewport
async function renderVisiblePages() {
    const threshold = state.visiblePageThreshold; // Render pages within threshold screen heights
    const containerTop = elements.container.scrollTop;
    const containerHeight = elements.container.clientHeight;

    for (let i = 1; i <= state.pdf.numPages; i++) {
        const pageEl = document.getElementById(`page-${i}`);
        if (!pageEl) continue;

        const rect = pageEl.getBoundingClientRect();
        const scrollerRect = elements.container.getBoundingClientRect();

        // Relative to scroller top
        const relTop = rect.top - scrollerRect.top;
        const relBottom = rect.bottom - scrollerRect.top;

        if (relBottom > -containerHeight * threshold && relTop < containerHeight * (1 + threshold)) {
            const canvas = pageEl.querySelector('canvas');
            const textLayer = pageEl.querySelector('.textLayer');
            if (canvas && textLayer && !pageEl.dataset.rendered) {
                // Check if we're within the page limit
                if (state.renderedPages.size < state.maxRenderedPages) {
                    pageEl.dataset.rendered = "true";
                    state.renderedPages.add(i);
                    renderPage(i, canvas, textLayer); // Don't await, let them render in parallel-ish
                } else {
                    console.debug('Max rendered pages reached, skipping page', i);
                }
            }
        } else {
            // Unrender pages that are out of view if we exceed the limit
            if (state.renderedPages.has(i) && state.renderedPages.size > state.maxRenderedPages * 0.7) {
                unrenderPage(i, pageEl);
            }
        }
    }
}

// Function to unrender a page to free up memory
function unrenderPage(pageNum, pageEl) {
    // Clear canvas
    const canvas = pageEl.querySelector('canvas');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    // Clear text layer
    const textLayer = pageEl.querySelector('.textLayer');
    if (textLayer) {
        textLayer.innerHTML = '';
    }

    // Cancel any active render tasks
    if (state.renderTasks[pageNum]) {
        state.renderTasks[pageNum].cancel();
        delete state.renderTasks[pageNum];
    }

    // Mark as unrendered
    delete pageEl.dataset.rendered;
    state.renderedPages.delete(pageNum);

    console.debug('Unrendered page', pageNum, 'to manage memory');
}

// Garbage collection function to clean up unused resources
function performGarbageCollection() {
    // Clean up cancelled render tasks
    for (const pageNum in state.renderTasks) {
        // Since we don't have a direct way to check if a task is cancelled,
        // we'll just log the current count for monitoring
        console.debug('Active render tasks:', Object.keys(state.renderTasks).length);
    }

    // Trigger browser's garbage collection indirectly by cleaning up references
    for (let i = 1; i <= state.pdf.numPages; i++) {
        const pageEl = document.getElementById(`page-${i}`);
        if (!pageEl) continue;

        // Check if page is far from viewport and not recently accessed
        const rect = pageEl.getBoundingClientRect();
        const containerRect = elements.container.getBoundingClientRect();
        const relTop = rect.top - containerRect.top;
        const relBottom = rect.bottom - containerRect.top;
        const containerHeight = containerRect.height;

        // If page is significantly far from viewport, consider unrendering it
        if ((relBottom < -containerHeight * state.visiblePageThreshold * 2 ||
             relTop > containerHeight * (1 + state.visiblePageThreshold * 2)) &&
            state.renderedPages.has(i)) {

            if (state.renderedPages.size > state.maxRenderedPages * 0.5) {
                unrenderPage(i, pageEl);
            }
        }
    }
}

async function renderAllPages() {
    // Strategy: Render visible first, then rest
    await renderVisiblePages();

    // Low priority for rest
    setTimeout(async () => {
        for (let i = 1; i <= state.pdf.numPages; i++) {
            const pageEl = document.getElementById(`page-${i}`);
            if (!pageEl || pageEl.dataset.rendered) continue;

            const canvas = pageEl.querySelector('canvas');
            const textLayer = pageEl.querySelector('.textLayer');
            if (canvas && textLayer) {
                pageEl.dataset.rendered = "true";
                await renderPage(i, canvas, textLayer); // Sequential for background to avoid OOM
            }
        }
    }, 500);
}

async function renderPage(num, canvas, textLayer) {
    // 1. Cancel previous render if exists
    if (state.renderTasks[num]) {
        try {
            state.renderTasks[num].cancel();
        } catch (e) {
            console.warn(`Failed to cancel render task for page ${num}:`, e);
        }
        delete state.renderTasks[num];
    }

    try {
        // Check if page element still exists
        const pageEl = document.getElementById(`page-${num}`);
        if (!pageEl || !canvas || !textLayer) {
            console.debug(`Page ${num} elements no longer exist, skipping render`);
            return;
        }

        const page = await state.pdf.getPage(num);
        const viewport = page.getViewport({ scale: state.zoom });

        // Update canvas dimensions
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        const canvasContext = canvas.getContext('2d', { alpha: false });

        // Clear canvas
        canvasContext.fillStyle = 'white';
        canvasContext.fillRect(0, 0, canvas.width, canvas.height);

        // 2. Start new render
        const renderTask = page.render({ canvasContext, viewport, intent: 'display' });
        state.renderTasks[num] = renderTask;

        await renderTask.promise;

        // 3. Cleanup on success
        if (state.renderTasks[num] === renderTask) {
            delete state.renderTasks[num];
        }

        // Only render text layer if page element still exists
        if (pageEl.querySelector('.textLayer') === textLayer) {
            try {
                const textContent = await page.getTextContent();
                textLayer.innerHTML = '';
                textLayer.style.setProperty('--scale-factor', viewport.scale);

                // Text Layer Render Task
                await pdfjsLib.renderTextLayer({
                    textContentSource: textContent,
                    container: textLayer,
                    viewport,
                    textDivs: []
                }).promise;
            } catch (e) {
                // Text layer error shouldn't fail page render
                if (e.name !== 'RenderingCancelledException') {
                    console.warn("Text layer render failed:", e);
                }
            }
        }
    } catch (err) {
        if (err.name === 'RenderingCancelledException') {
            // Expected cancellation
            return;
        }
        console.error("Render failed:", err);
    }
}

// --- SIDEBAR & THUMBNAILS ---

// Store flattened structure: [{ title, page, endPage }]
state.docStructure = [];

async function fetchOutline() {
    const outline = await state.pdf.getOutline();
    const container = elements.outlineView;
    container.innerHTML = '';
    state.docStructure = []; // Reset

    if (!outline || outline.length === 0) {
        container.innerHTML = '<p style="padding:20px; color:#94a3b8; font-size:12px;">该文档暂无目录</p>';
        return;
    }

    // Helper to process outline to UI and Structure
    const processItems = async (items) => {
        const flatList = [];
        for (const item of items) {
            let pageNum = null;
            if (item.dest) {
                try {
                    const dest = typeof item.dest === 'string' ? await state.pdf.getDestination(item.dest) : item.dest;
                    if (dest) {
                        const index = await state.pdf.getPageIndex(dest[0]);
                        pageNum = index + 1;
                    }
                } catch (e) {
                    console.warn("Dest parse error:", e);
                }
            }
            if (pageNum) {
                flatList.push({ title: item.title, page: pageNum });
            }
            if (item.items && item.items.length) {
                const kids = await processItems(item.items);
                flatList.push(...kids);
            }
        }
        return flatList;
    };

    // Render UI (Standard Recursive)
    const renderItems = (items, target) => {
        items.forEach(item => {
            const el = document.createElement('div');
            el.className = 'outline-item';
            el.textContent = item.title;
            el.onclick = async () => {
                if (item.dest) {
                    const dest = typeof item.dest === 'string' ? await state.pdf.getDestination(item.dest) : item.dest;
                    const idx = await state.pdf.getPageIndex(dest[0]);
                    document.getElementById(`page-${idx + 1}`).scrollIntoView({ behavior: 'smooth' });
                }
            };
            target.appendChild(el);
            if (item.items && item.items.length) {
                const sub = document.createElement('div');
                sub.style.paddingLeft = '12px';
                target.appendChild(sub);
                renderItems(item.items, sub);
            }
        });
    };
    renderItems(outline, container);

    // Build Structure Map (Async)
    processItems(outline).then(flat => {
        // Sort by page number
        flat.sort((a, b) => a.page - b.page);

        // Calculate ranges
        for (let i = 0; i < flat.length; i++) {
            const current = flat[i];
            const next = flat[i + 1];
            current.endPage = next ? (next.page - 1) : state.pdf.numPages;
            // Sanity check
            if (current.endPage < current.page) current.endPage = current.page;
        }
        state.docStructure = flat;
        console.log("XiaoEt: Doc Structure Parsed", state.docStructure); // Debug
    });
}

async function renderThumbnails() {
    let thumbContainer = document.getElementById('thumbnailsView');
    if (!thumbContainer) {
        thumbContainer = document.createElement('div');
        thumbContainer.id = 'thumbnailsView';
        thumbContainer.className = 'scroll-area hidden';
        elements.sidebar.appendChild(thumbContainer);
    }
    thumbContainer.innerHTML = '';

    for (let i = 1; i <= state.pdf.numPages; i++) {
        const item = document.createElement('div');
        item.className = 'thumbnail-item';
        const canvas = document.createElement('canvas');
        const span = document.createElement('span');
        span.textContent = `PAGE ${i} `;

        item.appendChild(canvas);
        item.appendChild(span);
        thumbContainer.appendChild(item);

        item.onclick = () => {
            const el = document.getElementById(`page-${i}`);
            if (el) el.scrollIntoView({ behavior: 'smooth' });
        };

        const page = await state.pdf.getPage(i);
        const viewport = page.getViewport({ scale: 0.15 });
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        page.render({ canvasContext: canvas.getContext('2d'), viewport });
    }
}

// --- ANNOTATION SYSTEM V2 ---

const annoState = {
    color: '#ef4444',
    width: 2,
    alpha: 1.0,
    textSize: 14,
    textColor: '#1e293b',
    fontWeight: 'normal',
    fontStyle: 'normal',
    mode: 'source-over'
};

const drawingState = {
    isDrawing: false
};

// Data Store: { 1: [cmd1, cmd2], 2: [] }
const pageAnnotations = {};
const undoStack = [];
const redoStack = [];

function getPageStore(pageNum) {
    if (!pageAnnotations[pageNum]) pageAnnotations[pageNum] = [];
    return pageAnnotations[pageNum];
}

function pushCommand(cmd) {
    undoStack.push(cmd);
    redoStack.length = 0; // Clear redo
    updateHistoryButtons();
}

function performUndo() {
    if (undoStack.length === 0) return;
    const cmd = undoStack.pop();
    redoStack.push(cmd);

    // Remove from page store
    const store = getPageStore(cmd.page);
    const idx = store.indexOf(cmd);
    if (idx > -1) store.splice(idx, 1);

    // Redraw that page
    redrawLayer(cmd.page);
    updateHistoryButtons();
}

function performRedo() {
    if (redoStack.length === 0) return;
    const cmd = redoStack.pop();
    undoStack.push(cmd);

    // Add back to page store
    getPageStore(cmd.page).push(cmd);

    redrawLayer(cmd.page);
    updateHistoryButtons();
}

function updateHistoryButtons() {
    const btnUndo = document.getElementById('btnUndo');
    const btnRedo = document.getElementById('btnRedo');
    if (btnUndo) btnUndo.disabled = undoStack.length === 0;
    if (btnRedo) btnRedo.disabled = redoStack.length === 0;
}

function redrawLayer(pageNum) {
    const container = document.getElementById(`page-${pageNum}`);
    if (!container) return;

    // Clear
    const hlLayer = container.querySelector('.highlight-layer');
    if (hlLayer) hlLayer.innerHTML = '';

    const canvas = container.querySelector('.anno-layer');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1.0;
    ctx.clearRect(0, 0, canvas.width, canvas.height); // Clear

    const commands = getPageStore(pageNum);
    commands.forEach(cmd => {
        if (cmd.type === 'highlight' && hlLayer) {
            renderHighlight(hlLayer, cmd);
        } else {
            executeCommand(ctx, cmd);
        }
    });
}

function renderHighlight(parent, cmd) {
    if (!cmd.rects) return;
    cmd.rects.forEach(rect => {
        const div = document.createElement('div');
        div.className = 'hl-rect';
        div.style.position = 'absolute';
        div.style.left = rect.left + 'px';
        div.style.top = rect.top + 'px';
        div.style.width = rect.width + 'px';
        div.style.height = rect.height + 'px';
        div.style.backgroundColor = cmd.color || '#ffeb3b';
        div.style.opacity = cmd.alpha || 0.4;
        div.style.mixBlendMode = 'multiply';
        parent.appendChild(div);
    });
}

async function prepareLayout() {
    elements.viewer.innerHTML = '';

    // Get first page to determine basic dimensions
    const firstPage = await state.pdf.getPage(1);
    const viewport = firstPage.getViewport({ scale: state.zoom });
    const pageWidth = viewport.width;
    const pageHeight = viewport.height;

    // Layout chunks calculation
    let chunkSize = 1;
    if (state.viewMode === 'spread') chunkSize = 2;
    if (state.viewMode === 'triple') chunkSize = 3;

    if (chunkSize === 1) {
        elements.viewer.classList.remove('spread-view');
        for (let i = 1; i <= state.pdf.numPages; i++) {
            createPageContainer(i, pageWidth, pageHeight, elements.viewer);
        }
    } else {
        elements.viewer.classList.add('spread-view');
        for (let i = 1; i <= state.pdf.numPages; i += chunkSize) {
            const spreadRow = document.createElement('div');
            spreadRow.className = 'page-spread-container';
            elements.viewer.appendChild(spreadRow);

            for (let j = 0; j < chunkSize; j++) {
                const pageNum = i + j;
                if (pageNum <= state.pdf.numPages) {
                    createPageContainer(pageNum, pageWidth, pageHeight, spreadRow);
                }
            }
        }
    }

    // Redraw all visible
    for (let i = 1; i <= state.pdf.numPages; i++) {
        initDrawing(document.querySelector(`#page-${i} .anno-layer`), i);
        redrawLayer(i);
    }
}

function createPageContainer(pageNum, width, height, parent) {
    const pageContainer = document.createElement('div');
    pageContainer.className = 'page-container';
    pageContainer.id = `page-${pageNum}`;
    pageContainer.dataset.pageNumber = pageNum;
    pageContainer.style.width = `${width}px`;
    pageContainer.style.height = `${height}px`;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const textLayer = document.createElement('div');
    textLayer.className = 'textLayer';
    textLayer.style.width = `${width}px`;
    textLayer.style.height = `${height}px`;

    const annoCanvas = document.createElement('canvas');
    annoCanvas.className = 'anno-layer';
    annoCanvas.width = width;
    annoCanvas.height = height;
    annoCanvas.style.width = `${width}px`;
    annoCanvas.style.height = `${height}px`;
    annoCanvas.style.position = 'absolute';
    annoCanvas.style.top = '0';
    annoCanvas.style.left = '0';
    const isDrawingTool = state.activeTool === 'toolDraw' || state.activeTool === 'toolEraser' || state.activeTool === 'toolText';
    annoCanvas.style.zIndex = isDrawingTool ? '25' : '10';
    annoCanvas.style.pointerEvents = (state.activeTool && state.activeTool !== 'toolHighlight') ? 'auto' : 'none';

    pageContainer.appendChild(canvas);
    pageContainer.appendChild(textLayer);

    // Highlight Layer (SVG for better precision and interaction)
    const highlightLayer = document.createElement('div');
    highlightLayer.className = 'highlight-layer';
    highlightLayer.style.position = 'absolute';
    highlightLayer.style.top = '0';
    highlightLayer.style.left = '0';
    highlightLayer.style.width = '100%';
    highlightLayer.style.height = '100%';
    highlightLayer.style.zIndex = '5';
    highlightLayer.style.pointerEvents = 'none';
    pageContainer.appendChild(highlightLayer);

    pageContainer.appendChild(annoCanvas);
    parent.appendChild(pageContainer);
}

function executeCommand(ctx, cmd) {
    ctx.save();

    // Explicitly set mode and alpha for each command to prevent state leaking
    if (cmd.type === 'path') {
        ctx.beginPath();
        ctx.strokeStyle = cmd.color;
        ctx.lineWidth = cmd.width;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.globalAlpha = (cmd.alpha !== undefined) ? cmd.alpha : 1.0;
        ctx.globalCompositeOperation = cmd.mode || 'source-over';

        if (cmd.points && cmd.points.length > 0) {
            ctx.moveTo(cmd.points[0].x, cmd.points[0].y);
            for (let i = 1; i < cmd.points.length; i++) {
                ctx.lineTo(cmd.points[i].x, cmd.points[i].y);
            }
        }
        ctx.stroke();
    }
    else if (cmd.type === 'text') {
        const weight = cmd.weight || 'normal';
        const style = cmd.style || 'normal';
        ctx.font = `${style} ${weight} ${cmd.size}px 'Inter', sans - serif`;
        ctx.fillStyle = cmd.color;
        // Text always resets mode to source-over unless explicitly needed
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = (cmd.alpha !== undefined) ? cmd.alpha : 1.0;
        ctx.textBaseline = 'top';
        ctx.fillText(cmd.text, cmd.x, cmd.y);
    }
    else if (cmd.type === 'eraser') {
        // Eraser ignores color/alpha commands, always destination-out
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineWidth = cmd.width || 10;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.globalAlpha = 1.0;
        ctx.beginPath();
        if (cmd.points && cmd.points.length > 0) {
            ctx.moveTo(cmd.points[0].x, cmd.points[0].y);
            for (let i = 1; i < cmd.points.length; i++) {
                ctx.lineTo(cmd.points[i].x, cmd.points[i].y);
            }
        }
        ctx.stroke();
    }

    ctx.restore();
}

// Global current drawing path
let currentPathPoints = [];

function hitTestText(pos, pageNum, ctx) {
    const commands = getPageStore(pageNum);
    // Reverse search to hit the top-most text first
    for (let i = commands.length - 1; i >= 0; i--) {
        const cmd = commands[i];
        if (cmd.type !== 'text') continue;

        const weight = cmd.weight || 'normal';
        const style = cmd.style || 'normal';
        ctx.font = `${style} ${weight} ${cmd.size}px 'Inter', sans - serif`;
        const metrics = ctx.measureText(cmd.text);
        const width = metrics.width;
        const height = cmd.size; // Close enough for hitbox

        if (pos.x >= cmd.x && pos.x <= cmd.x + width &&
            pos.y >= cmd.y && pos.y <= cmd.y + height) {
            return { cmd, index: i };
        }
    }
    return null;
}

function initDrawing(canvas, pageNum) {
    const ctx = canvas.getContext('2d');

    const getPos = (e) => {
        const rect = canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) * (canvas.width / rect.width),
            y: (e.clientY - rect.top) * (canvas.height / rect.height)
        };
    };

    const startDraw = (e) => {
        const pos = getPos(e);
        if (state.activeTool === 'toolText') {
            const hit = hitTestText(pos, pageNum, ctx);
            if (hit) {
                handleTextClick(e, canvas, pageNum, hit.cmd);
            } else {
                handleTextClick(e, canvas, pageNum);
            }
            return;
        }

        if (!state.activeTool) return;

        drawingState.isDrawing = true;
        currentPathPoints = [pos];

        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
        setupContextStyle(ctx);
    };

    const draw = (e) => {
        if (!drawingState.isDrawing) return;
        const pos = getPos(e);
        currentPathPoints.push(pos);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
    };

    const stopDraw = () => {
        if (!drawingState.isDrawing) return;
        drawingState.isDrawing = false;
        ctx.closePath();

        const cmd = {
            type: state.activeTool === 'toolEraser' ? 'eraser' : 'path',
            page: pageNum,
            color: annoState.color,
            width: state.activeTool === 'toolEraser' ? annoState.width * 2 : annoState.width,
            alpha: annoState.alpha || 1.0,
            mode: annoState.mode || 'source-over',
            points: [...currentPathPoints]
        };

        getPageStore(pageNum).push(cmd);
        pushCommand(cmd);
        redrawLayer(pageNum);
    };

    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDraw);
    canvas.addEventListener('mouseleave', stopDraw);
}

function setupContextStyle(ctx) {
    if (state.activeTool === 'toolEraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineWidth = annoState.width * 2;
    } else if (state.activeTool === 'toolHighlight') {
        ctx.globalCompositeOperation = 'multiply';
        ctx.strokeStyle = annoState.color;
        ctx.lineWidth = 14;
        ctx.globalAlpha = annoState.alpha;
    } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = annoState.color;
        ctx.lineWidth = annoState.width;
        ctx.globalAlpha = annoState.alpha;
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
}

function handleTextClick(e, canvas, pageNum, existingCmd = null) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.clientX;
    const clientY = e.clientY;

    const originalTool = state.activeTool;
    state.activeTool = null;
    updateToolButtonState();

    const input = document.createElement('div');
    input.contentEditable = true;
    input.className = 'text-input-overlay';

    // Position
    if (existingCmd) {
        // Find screen pos from canvas pos
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        input.style.left = (rect.left + (existingCmd.x / scaleX)) + 'px';
        input.style.top = (rect.top + (existingCmd.y / scaleY)) + 'px';
        input.innerText = existingCmd.text;
    } else {
        input.style.left = (clientX) + 'px';
        input.style.top = (clientY) + 'px';
    }

    // Styles
    input.style.color = existingCmd ? existingCmd.color : annoState.color;
    input.style.fontSize = (existingCmd ? existingCmd.size : annoState.textSize) + 'px';
    input.style.fontWeight = existingCmd ? (existingCmd.weight || 'normal') : (annoState.fontWeight || 'normal');
    input.style.fontStyle = existingCmd ? (existingCmd.style || 'normal') : (annoState.fontStyle || 'normal');
    input.style.opacity = existingCmd ? (existingCmd.alpha !== undefined ? existingCmd.alpha : 1.0) : annoState.alpha;

    document.body.appendChild(input);
    setTimeout(() => {
        input.focus();
        if (existingCmd) {
            // Select all text when editing
            const range = document.createRange();
            range.selectNodeContents(input);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        }
    }, 10);

    const finishText = () => {
        const text = input.innerText.trim();

        // Remove existing if editing
        if (existingCmd) {
            const store = getPageStore(pageNum);
            const idx = store.indexOf(existingCmd);
            if (idx > -1) store.splice(idx, 1);

            const undoIdx = undoStack.indexOf(existingCmd);
            if (undoIdx > -1) undoStack.splice(undoIdx, 1);
        }

        if (text) {
            const finalRect = input.getBoundingClientRect();
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;

            const x = (finalRect.left - rect.left) * scaleX;
            const y = (finalRect.top - rect.top) * scaleY + 2;

            const cmd = {
                type: 'text',
                page: pageNum,
                text: text,
                x: x,
                y: y,
                color: existingCmd ? existingCmd.color : annoState.color,
                size: existingCmd ? existingCmd.size : annoState.textSize,
                weight: existingCmd ? (existingCmd.weight || 'normal') : (annoState.fontWeight || 'normal'),
                style: existingCmd ? (existingCmd.style || 'normal') : (annoState.fontStyle || 'normal'),
                alpha: existingCmd ? (existingCmd.alpha !== undefined ? existingCmd.alpha : 1.0) : annoState.alpha
            };

            getPageStore(pageNum).push(cmd);
            pushCommand(cmd);
        }

        redrawLayer(pageNum);

        if (input.parentNode) {
            document.body.removeChild(input);
        }
        state.activeTool = originalTool;
        updateToolButtonState();
        if (state.activeTool) {
            document.querySelectorAll('.anno-layer').forEach(l => l.style.pointerEvents = 'auto');
        }
    };

    input.addEventListener('blur', finishText);
    input.addEventListener('keydown', (k) => {
        if (k.key === 'Enter' && !k.shiftKey) {
            k.preventDefault();
            input.blur();
        }
    });
}

function updateToolButtonState() {
    const toolButtons = document.querySelectorAll('.btn-tool');
    toolButtons.forEach(b => {
        if (b.id === state.activeTool) b.classList.add('active');
        else b.classList.remove('active');
    });
}

// --- EVENTS ---

function setupEvents() {
    const zoomStep = 0.25;

    // Zoom Logic
    // Zoom Logic
    document.getElementById('zoomIn').onclick = () => {
        updateZoom(state.zoom + 0.1);
    };
    document.getElementById('zoomOut').onclick = () => {
        updateZoom(state.zoom - 0.1);
    };

    // View Mode Toggle
    const viewToggle = document.getElementById('viewModeToggle');
    if (viewToggle) {
        // Init visual state
        viewToggle.style.opacity = state.viewMode === 'spread' ? '1' : '0.6';
        if (state.viewMode === 'spread') viewToggle.classList.add('active');

        viewToggle.onclick = async () => {
            // Cycle: single -> spread -> triple
            if (state.viewMode === 'single') state.viewMode = 'spread';
            else if (state.viewMode === 'spread') state.viewMode = 'triple';
            else state.viewMode = 'single';

            console.log("XiaoEt: View Mode changed to:", state.viewMode);

            // Visual feedback
            viewToggle.style.opacity = state.viewMode === 'single' ? '0.6' : '1';
            // Optional: update icon or title based on mode
            const modeNames = { 'single': '单页', 'spread': '双页', 'triple': '三页' };
            viewToggle.title = `视图切换 (${modeNames[state.viewMode]})`;

            // Force recalculation if in auto-zoom modes
            // Force recalculation if in auto-zoom modes
            if (state.zoomMode !== 'manual') {
                await updateZoom(state.zoomMode);
            } else {
                // In manual mode, we still need to refresh the layout
                // If it's the first time going to spread, try to make it visible
                if (state.viewMode === 'spread' && state.zoom < 0.7) {
                    await updateZoom(0.8);
                } else {
                    await updateZoom();
                }
            }

            // Helpful visual hint: jump a bit if we are at the top to show the change
            if (elements.container.scrollTop < 100 && state.viewMode === 'spread' && state.pdf.numPages > 1) {
                elements.container.scrollTo({ top: 100, behavior: 'smooth' });
            }
        };
    }

    // Zoom Menu
    const btnZoomMenu = document.getElementById('btnZoomMenu');
    const zoomMenu = document.getElementById('zoomMenu');

    if (btnZoomMenu && zoomMenu) {
        btnZoomMenu.onclick = (e) => {
            e.stopPropagation();
            zoomMenu.classList.toggle('hidden');
        };

        // Close menu on click outside
        document.addEventListener('click', (e) => {
            if (!zoomMenu.contains(e.target) && !btnZoomMenu.contains(e.target)) {
                zoomMenu.classList.add('hidden');
            }
        });

        // Menu Items
        zoomMenu.querySelectorAll('.menu-item').forEach(item => {
            item.onclick = () => {
                const action = item.dataset.action;
                if (action === 'fit-width') updateZoom('fit-width');
                else if (action === 'fit-page') updateZoom('fit-page');
                else {
                    updateZoom(parseInt(action) / 100);
                }
                zoomMenu.classList.add('hidden');
            };
        });
    }

    // Window Resize
    window.addEventListener('resize', () => {
        if (state.zoomMode !== 'manual') {
            updateZoom();
        }
    });

    // Sidebar Toggle
    const sidebarToggle = document.getElementById('sidebarToggle');
    if (sidebarToggle) {
        sidebarToggle.onclick = () => {
            state.sidebarVisible = !state.sidebarVisible;
            elements.sidebar.classList.toggle('closed', !state.sidebarVisible);
        };
    }

    window.addEventListener('wheel', (e) => {
        if (e.ctrlKey) {
            e.preventDefault();
            const direction = e.deltaY < 0 ? 1 : -1;
            state.zoom = Math.min(Math.max(state.zoom + (direction * 0.1), 0.4), 5.0);
            updateZoom();
        }
    }, { passive: false });

    // Page Navigation
    elements.pageNumber.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const val = parseInt(elements.pageNumber.value);
            if (val >= 1 && val <= state.pdf.numPages) {
                document.getElementById(`page-${val}`).scrollIntoView({ behavior: 'smooth' });
            } else {
                elements.pageNumber.value = state.currentPage;
            }
        }
    });

    // Annotation Tools
    const toolButtons = document.querySelectorAll('.btn-tool');
    const toolbarOptions = document.getElementById('toolbarOptions');
    const optColor = document.getElementById('optColor');
    const optWidth = document.getElementById('optWidth');
    const optTextSize = document.getElementById('optTextSize');

    // Add text selection listener for highlighting
    document.addEventListener('mouseup', handleTextSelection);

    // Add separate text selection listener for translation
    document.addEventListener('mouseup', handleTranslationSelection);

    async function handleTextSelection(e) {
        if (state.activeTool !== 'toolHighlight') return;

        const selection = window.getSelection();
        if (selection.isCollapsed || !selection.rangeCount) return;

        const range = selection.getRangeAt(0);
        const textLayer = range.commonAncestorContainer.parentElement?.closest('.textLayer');
        if (!textLayer) return;

        const pageContainer = textLayer.closest('.page-container');
        const pageNum = parseInt(pageContainer.dataset.pageNumber);
        const rects = range.getClientRects();
        const containerRect = pageContainer.getBoundingClientRect();

        const highlightRects = [];
        for (const rect of rects) {
            highlightRects.push({
                left: rect.left - containerRect.left,
                top: rect.top - containerRect.top,
                width: rect.width,
                height: rect.height
            });
        }

        if (highlightRects.length > 0) {
            const cmd = {
                type: 'highlight',
                page: pageNum,
                rects: highlightRects,
                color: annoState.color || '#ffeb3b',
                alpha: 0.4
            };
            getPageStore(pageNum).push(cmd);
            pushCommand(cmd);
            redrawLayer(pageNum);
            selection.removeAllRanges();
        }
    }

    // Handle text selection for translation purposes
    async function handleTranslationSelection(e) {
        // Don't interfere with annotation tools
        if (state.activeTool && ['toolHighlight', 'toolDraw', 'toolText', 'toolEraser'].includes(state.activeTool)) {
            return;
        }

        const selection = window.getSelection();
        if (selection.isCollapsed || !selection.rangeCount) return;

        const range = selection.getRangeAt(0);
        const textLayer = range.commonAncestorContainer.parentElement?.closest('.textLayer');
        if (!textLayer) return;

        // Get selected text
        const selectedText = selection.toString().trim();
        if (!selectedText || selectedText.length === 0) return;

        // Get position for showing the translation icon
        const rangeRect = range.getBoundingClientRect();
        const x = rangeRect.left + (rangeRect.width / 2);
        const y = rangeRect.bottom + 10;

        // Dispatch custom event to trigger translation UI
        // This will be caught by the main content script if loaded
        const translationEvent = new CustomEvent('xiaoetPdfTextSelected', {
            detail: {
                text: selectedText,
                x: x,
                y: y
            }
        });
        document.dispatchEvent(translationEvent);

        // Alternative approach: try to use the TranslatorUI if available
        if (typeof window.TranslatorUI !== 'undefined' && typeof window.translatorUI !== 'undefined') {
            // Show the translation icon at the calculated position
            window.translatorUI.showIcon(x, y, () => {
                // Trigger translation with the selected text
                const engine = window.translatorUI.engine || 'google';
                const targetLang = window.translatorUI.targetLang || 'zh-CN';

                // Request translation via background script
                if (typeof chrome !== 'undefined' && chrome.runtime) {
                    chrome.runtime.sendMessage({
                        type: 'REQUEST_TRANSLATE',
                        text: selectedText,
                        engine: engine,
                        targetLang: targetLang
                    });
                }
            });
        }
    }

    toolButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const isActive = btn.classList.contains('active');
            toolButtons.forEach(b => b.classList.remove('active'));

            if (!isActive) {
                btn.classList.add('active');
                state.activeTool = btn.id;

                // For highlighting, the canvas MUST be transparent to mouse events to allow text selection
                // Also adjust z-index: Drawing tools must be on top of text layer (15)
                const isDrawing = state.activeTool === 'toolDraw' || state.activeTool === 'toolEraser' || state.activeTool === 'toolText';
                const needsPointer = state.activeTool && state.activeTool !== 'toolHighlight';

                document.querySelectorAll('.anno-layer').forEach(l => {
                    l.style.pointerEvents = needsPointer ? 'auto' : 'none';
                    l.style.zIndex = isDrawing ? '25' : '10';
                });

                // Show Options Toolbar
                toolbarOptions.classList.add('visible');

                // Toggle specific groups
                // Reset all first
                optColor.classList.remove('hidden');
                optWidth.classList.remove('hidden');
                optTextSize.classList.add('hidden'); // Default hidden

                if (btn.id === 'toolHighlight') {
                    annoState.mode = 'multiply';
                    annoState.alpha = 0.4;
                }
                else if (btn.id === 'toolDraw') {
                    annoState.mode = 'source-over';
                    annoState.alpha = 1.0;
                }
                else if (btn.id === 'toolText') {
                    optWidth.classList.add('hidden');
                    optColor.classList.remove('hidden');
                    optTextSize.classList.remove('hidden');
                }
                else if (btn.id === 'toolEraser') {
                    optColor.classList.add('hidden');
                    optWidth.classList.remove('hidden');
                }

            } else {
                state.activeTool = null;
                document.querySelectorAll('.anno-layer').forEach(l => {
                    l.style.pointerEvents = 'none';
                    l.style.zIndex = '10';
                });
                toolbarOptions.classList.remove('visible');
            }
        });
    });

    setupToolbarEvents();

    function setupToolbarEvents() {
        // Color Selection
        document.querySelectorAll('.color-swatch').forEach(swatch => {
            swatch.onclick = () => {
                document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
                swatch.classList.add('active');
                annoState.color = swatch.dataset.color;
            };
        });

        // Custom Color
        const colorInput = document.getElementById('customColor');
        colorInput.oninput = (e) => {
            document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
            annoState.color = e.target.value;
        };

        // Sliders
        const widthSlider = document.getElementById('strokeWidth');
        widthSlider.oninput = (e) => {
            annoState.width = parseInt(e.target.value);
            document.getElementById('strokeWidthVal').textContent = e.target.value + 'px';
        };

        const sizeSlider = document.getElementById('textSize');
        sizeSlider.oninput = (e) => {
            annoState.textSize = parseInt(e.target.value);
            document.getElementById('textSizeVal').textContent = e.target.value + 'px';
        };

        const opacitySlider = document.getElementById('annoOpacity');
        if (opacitySlider) {
            opacitySlider.oninput = (e) => {
                const val = parseInt(e.target.value);
                annoState.alpha = val / 100;
                document.getElementById('annoOpacityVal').textContent = val + '%';
            };
        }

        // Font Styles (Bold/Italic)
        const btnBold = document.getElementById('btnBold');
        if (btnBold) {
            btnBold.onclick = () => {
                annoState.fontWeight = annoState.fontWeight === 'bold' ? 'normal' : 'bold';
                btnBold.classList.toggle('active', annoState.fontWeight === 'bold');
            };
        }

        const btnItalic = document.getElementById('btnItalic');
        if (btnItalic) {
            btnItalic.onclick = () => {
                annoState.fontStyle = annoState.fontStyle === 'italic' ? 'normal' : 'italic';
                btnItalic.classList.toggle('active', annoState.fontStyle === 'italic');
            };
        }

        // Undo/Redo
        document.getElementById('btnUndo').onclick = performUndo;
        document.getElementById('btnRedo').onclick = performRedo;

        // Shortcuts - Global Document Listener
        document.addEventListener('keydown', (e) => {
            // Check if user is typing in an input field or contentEditable
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
                return;
            }

            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                if (e.shiftKey) {
                    performRedo();
                } else {
                    performUndo();
                }
            }
            else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
                e.preventDefault();
                performUndo();
            }
        });
    }

    // Sidebar Tabs (Outline & Thumbnails)
    const tabs = document.querySelectorAll('.sidebar-tabs button');
    tabs.forEach((tab, index) => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // Toggle view visibility
            if (elements.outlineView) elements.outlineView.classList.toggle('hidden', index !== 0);
            if (elements.thumbnailsView) elements.thumbnailsView.classList.toggle('hidden', index !== 1);
        });
    });

    // Actions
    document.getElementById('btnDarkMode').onclick = () => {
        state.isDarkMode = !state.isDarkMode;
        applyDarkMode(state.isDarkMode);
    };

    const btnDownload = document.getElementById('btnDownload');
    if (btnDownload) {
        btnDownload.onclick = () => {
            const params = new URLSearchParams(window.location.search);
            const fileUrl = params.get('file');
            if (fileUrl) {
                const a = document.createElement('a');
                a.href = fileUrl;
                a.download = decodeURIComponent(fileUrl.split('/').pop());
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            }
        };
    }

    elements.container.onscroll = () => {
        renderVisiblePages(); // Dynamic loading

        const pageContainers = document.querySelectorAll('.page-container');
        let currentInView = 1;
        for (const p of pageContainers) {
            const rect = p.getBoundingClientRect();
            // If top of page is in upper half of view
            if (rect.top < window.innerHeight / 2 && rect.bottom > 100) {
                currentInView = parseInt(p.dataset.pageNumber);
                break;
            }
        }
        if (state.currentPage !== currentInView) {
            state.currentPage = currentInView;
            elements.pageNumber.value = currentInView;
        }
    };

    // Start garbage collection interval
    state.garbageCollectionInterval = setInterval(performGarbageCollection, 10000); // Every 10 seconds

    // Clean up on window unload
    window.addEventListener('beforeunload', () => {
        if (state.garbageCollectionInterval) {
            clearInterval(state.garbageCollectionInterval);
        }

        // Cancel all active render tasks
        for (const pageNum in state.renderTasks) {
            try {
                state.renderTasks[pageNum].cancel();
            } catch (e) {
                console.warn(`Error cancelling render task for page ${pageNum}:`, e);
            }
        }
    });
}

async function updateZoom(value) {
    if (value === 'fit-width') {
        state.zoomMode = 'fit-width';
        const page = await state.pdf.getPage(1);
        const viewport = page.getViewport({ scale: 1.0 });
        const containerWidth = elements.container.clientWidth - 60; // Padding consideration
        if (state.viewMode === 'spread') {
            state.zoom = (containerWidth / 2) / viewport.width;
        } else if (state.viewMode === 'triple') {
            state.zoom = (containerWidth / 3) / viewport.width;
        } else {
            state.zoom = containerWidth / viewport.width;
        }
    } else if (value === 'fit-page') {
        state.zoomMode = 'fit-page';
        const page = await state.pdf.getPage(1);
        const viewport = page.getViewport({ scale: 1.0 });
        const containerHeight = elements.container.clientHeight - 40;
        state.zoom = containerHeight / viewport.height;
    } else if (typeof value === 'number') {
        state.zoomMode = 'manual';
        state.zoom = value;
    } else {
        // Refresh based on current mode (e.g. resize)
        if (state.zoomMode === 'fit-width') return updateZoom('fit-width');
        if (state.zoomMode === 'fit-page') return updateZoom('fit-page');
    }

    // Clamp
    if (state.zoom < 0.2) state.zoom = 0.2;
    if (state.zoom > 5.0) state.zoom = 5.0;

    if (elements.zoomLevel) elements.zoomLevel.textContent = `${Math.round(state.zoom * 100)}%`;

    const zoomLabel = document.getElementById('zoomLevel'); // Unified with HTML
    if (zoomLabel) zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;

    await prepareLayout();
    renderAllPages();
}

function applyDarkMode(enabled) {
    document.documentElement.setAttribute('data-theme', enabled ? 'dark' : 'light');
    state.isDarkMode = enabled;
    localStorage.setItem('pdf-dark-mode', enabled);
}

// Initialize the PDF viewer
init();