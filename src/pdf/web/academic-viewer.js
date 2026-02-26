/**
 * Academic Viewer V4 - Core Logic (Enhanced & Stabilized)
 */

const { pdfjsLib } = window;
const TEXT_INDEX_CACHE_VERSION = 2;
const MAX_INDEX_CACHE_PAGES = 120;
const SEARCH_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

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
    apiKey: null,
    fileUrl: '',
    fileName: '',
    searchQuery: '',
    searchScope: 'all',
    searchResults: [],
    searchIndex: -1,
    searchCurrentEl: null,
    searchCollapsedPages: new Set(),
    searchResultPage: 1,
    searchPageSize: 40,
    searchHitStats: {},
    searchHistory: [],
    searchHistorySelection: new Set(),
    searchNoticeMessage: '',
    searchNoticeTimer: null,
    searchSessionTimer: null,
    runSearchFn: null,
    textCache: {},
    indexedPages: new Set(),
    indexedPageItems: {},
    indexedPageAccess: {},
    indexWorker: null,
    indexBuildTotal: 0,
    indexBuildDone: 0,
    indexReqCounter: 0,
    indexReqResolvers: {},
    indexSaveTimer: null,
    saveTimer: null,
    scrollRAF: null,
    renderRAF: null,
    pageObserver: null,
    visiblePageRatios: {},
    thumbnailObserver: null,
    isFullscreen: false,
    manualRegionExportArmed: false,
    /** 手动选区状态 — 拖选期间完全接管浏览器选区 */
    manualSel: {
        active: false,       // 是否正在手动拖选
        anchorNode: null,    // 锚点文本节点
        anchorOffset: 0,     // 锚点偏移量
        range: null,         // 当前构建的 Range
        startPage: null      // 锚点所在页码
    },
    isSelectingText: false,
    pendingZoomValue: null,
    zoomApplyTimer: null
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
    thumbnailsView: document.getElementById('thumbnailsView'),
    loadingOverlay: document.getElementById('loadingOverlay'),
    loadingText: document.getElementById('loadingText'),
    loadingProgressBar: document.getElementById('loadingProgressBar'),
    searchInput: document.getElementById('searchInput'),
    searchScope: document.getElementById('searchScope'),
    searchPrev: document.getElementById('searchPrev'),
    searchNext: document.getElementById('searchNext'),
    searchStats: document.getElementById('searchStats'),
    searchResultsView: document.getElementById('searchResultsView'),
    indexStatus: document.getElementById('indexStatus'),
    shortcutHelp: document.getElementById('shortcutHelp'),
    shortcutHelpClose: document.getElementById('shortcutHelpClose'),
    btnAnnoExport: document.getElementById('btnAnnoExport'),
    btnAnnoImport: document.getElementById('btnAnnoImport'),
    annoImportFile: document.getElementById('annoImportFile'),
    btnAnnoSelectText: document.getElementById('btnAnnoSelectText'),
    btnAnnoSelectHighlight: document.getElementById('btnAnnoSelectHighlight'),
    btnAnnoSelectInk: document.getElementById('btnAnnoSelectInk'),
    annoSelectionStats: document.getElementById('annoSelectionStats'),
    btnAnnoHelp: document.getElementById('btnAnnoHelp'),
    annoSelectionPopover: document.getElementById('annoSelectionPopover'),
    annoSelectionPopoverContent: document.getElementById('annoSelectionPopoverContent'),
    annoHelpPopover: document.getElementById('annoHelpPopover'),
    annoActionToast: document.getElementById('annoActionToast'),
    btnAnnoSelectPage: document.getElementById('btnAnnoSelectPage'),
    btnAnnoInvertPage: document.getElementById('btnAnnoInvertPage'),
    btnAnnoApplyEdit: document.getElementById('btnAnnoApplyEdit'),
    btnAnnoDelete: document.getElementById('btnAnnoDelete')
};

state.outlineElements = [];
state.outlineTreeNodes = {};

let annoActionToastTimer = null;

function simpleHashLocal(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) + str.charCodeAt(i);
    }
    return (hash >>> 0).toString(16);
}

function downloadBlobFile(blob, fileName) {
    if (!blob) return;
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function sanitizeFileStem(name) {
    let raw = String(name || 'document');
    // 兼容 file 参数中携带的 URL 编码文件名（如 %E6%B5%B7...）
    // 最多解码两次，避免异常输入导致死循环。
    for (let i = 0; i < 2; i++) {
        try {
            const next = decodeURIComponent(raw.replace(/\+/g, ' '));
            if (next === raw) break;
            raw = next;
        } catch {
            break;
        }
    }
    raw = raw.replace(/\.pdf$/i, '');
    const cleaned = raw.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    return cleaned || 'document';
}

function padNum(value, size = 4) {
    return String(Math.max(0, Number(value || 0))).padStart(size, '0');
}

function buildExportImageFileName(opts = {}) {
    const stem = sanitizeFileStem(state.fileName || 'document');
    const pagePart = `p${padNum(opts.page, 4)}`;
    const kind = opts.kind || 'img';
    const indexPart = opts.index ? `_${kind}${padNum(opts.index, 3)}` : `_${kind}`;
    const sizePart = (opts.width && opts.height) ? `_${opts.width}x${opts.height}` : '';
    const extra = opts.extra ? `_${String(opts.extra).replace(/[^a-zA-Z0-9_-]/g, '')}` : '';
    return `${stem}_${pagePart}${indexPart}${sizePart}${extra}.png`;
}

async function renderPageCanvasForExport(pageNum, exportScale = 2.5) {
    if (!state.pdf) return null;
    const page = await state.pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: Math.max(1, Number(exportScale || 2.5)) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return null;
    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas;
}

function normalizeRawImageToCanvas(imageLike) {
    if (!imageLike) return null;

    if (imageLike instanceof HTMLCanvasElement) {
        return imageLike;
    }

    if (typeof ImageBitmap !== 'undefined' && imageLike instanceof ImageBitmap) {
        const canvas = document.createElement('canvas');
        canvas.width = imageLike.width;
        canvas.height = imageLike.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.drawImage(imageLike, 0, 0);
        return canvas;
    }

    if (imageLike instanceof HTMLImageElement) {
        const canvas = document.createElement('canvas');
        canvas.width = imageLike.naturalWidth || imageLike.width;
        canvas.height = imageLike.naturalHeight || imageLike.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.drawImage(imageLike, 0, 0);
        return canvas;
    }

    const width = Number(imageLike.width || 0);
    const height = Number(imageLike.height || 0);
    const data = imageLike.data;
    if (!width || !height || !data) return null;

    const src = data instanceof Uint8ClampedArray ? data : new Uint8ClampedArray(data);
    let rgba;
    if (src.length === width * height * 4) {
        rgba = src;
    } else if (src.length === width * height * 3) {
        rgba = new Uint8ClampedArray(width * height * 4);
        for (let i = 0, j = 0; i < src.length; i += 3, j += 4) {
            rgba[j] = src[i];
            rgba[j + 1] = src[i + 1];
            rgba[j + 2] = src[i + 2];
            rgba[j + 3] = 255;
        }
    } else if (src.length === width * height) {
        rgba = new Uint8ClampedArray(width * height * 4);
        for (let i = 0, j = 0; i < src.length; i++, j += 4) {
            const g = src[i];
            rgba[j] = g;
            rgba[j + 1] = g;
            rgba[j + 2] = g;
            rgba[j + 3] = 255;
        }
    } else {
        return null;
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
    return canvas;
}

function getPageObjAsync(page, objId) {
    return new Promise((resolve) => {
        let resolved = false;
        const done = (obj) => {
            if (resolved) return;
            resolved = true;
            resolve(obj || null);
        };

        // 超时兜底，避免某些对象回调不触发导致卡住
        const timer = setTimeout(() => done(null), 1200);

        try {
            page.objs?.get?.(objId, (obj) => {
                clearTimeout(timer);
                done(obj);
            });

            // 某些资源在 commonObjs 中
            page.commonObjs?.get?.(objId, (obj) => {
                clearTimeout(timer);
                done(obj);
            });
        } catch {
            clearTimeout(timer);
            done(null);
        }
    });
}

async function extractImagesFromPage(pageNum) {
    if (!state.pdf) return [];
    const page = await state.pdf.getPage(pageNum);
    const operatorList = await page.getOperatorList();
    const OPS = pdfjsLib.OPS || {};
    const imageFns = new Set([
        OPS.paintImageXObject,
        OPS.paintInlineImageXObject,
        OPS.paintJpegXObject,
        OPS.paintImageXObjectRepeat,
        OPS.paintImageMaskXObject,
        OPS.paintImageMaskXObjectRepeat
    ]);

    const results = [];
    const dedupe = new Set();
    let hitImageOps = 0;

    for (let i = 0; i < operatorList.fnArray.length; i++) {
        const fn = operatorList.fnArray[i];
        if (!imageFns.has(fn)) continue;
        hitImageOps += 1;
        const args = operatorList.argsArray[i] || [];
        let imageLike = null;

        if (fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject) {
            imageLike = args[0] || null;
        } else if (fn === OPS.paintImageXObjectRepeat || fn === OPS.paintImageMaskXObjectRepeat) {
            imageLike = args[1] || args[0] || null;
        } else {
            const objId = args[0];
            if (!objId) continue;
            imageLike = await getPageObjAsync(page, objId);
        }

        const canvas = normalizeRawImageToCanvas(imageLike);
        if (!canvas || canvas.width < 8 || canvas.height < 8) continue;

        const thumbCtx = canvas.getContext('2d', { willReadFrequently: true });
        let signature = 'na';
        if (thumbCtx) {
            const sampleW = Math.min(16, canvas.width);
            const sampleH = Math.min(16, canvas.height);
            const sample = thumbCtx.getImageData(0, 0, sampleW, sampleH).data;
            let sum = 0;
            for (let s = 0; s < sample.length; s += 8) {
                sum = (sum + sample[s] + sample[s + 1] + sample[s + 2] + sample[s + 3]) >>> 0;
            }
            signature = String(sum);
        }
        const key = `${canvas.width}x${canvas.height}-${signature}`;
        if (dedupe.has(key)) continue;
        dedupe.add(key);

        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (!blob) continue;
        results.push({
            blob,
            width: canvas.width,
            height: canvas.height
        });
    }

    // 某些 PDF 图像以复杂对象/遮罩存储，操作符命中但对象取不到。
    // 这时提供“整页无损兜底”，保证自动导出有结果。
    if (results.length === 0 && hitImageOps > 0) {
        const fallbackCanvas = await renderPageCanvasForExport(pageNum, 2.5);
        if (fallbackCanvas) {
            const fallbackBlob = await new Promise((resolve) => fallbackCanvas.toBlob(resolve, 'image/png'));
            if (fallbackBlob) {
                results.push({
                    blob: fallbackBlob,
                    width: fallbackCanvas.width,
                    height: fallbackCanvas.height,
                    isFallback: true
                });
            }
        }
    }

    return results;
}

function getDocId() {
    const hashFn = typeof window.simpleHash === 'function' ? window.simpleHash : simpleHashLocal;
    return hashFn(state.fileUrl || state.fileName || 'default-pdf');
}

const STORAGE_KEY_PREFIX = 'acadmaster_pdf';
const LEGACY_STORAGE_KEY_PREFIX = 'xiaoet_pdf';

function readLocalStorageWithLegacy(primaryKey, legacyKey) {
    const primaryRaw = localStorage.getItem(primaryKey);
    if (primaryRaw) {
        return { raw: primaryRaw, usedLegacy: false };
    }
    if (!legacyKey) {
        return { raw: null, usedLegacy: false };
    }
    const legacyRaw = localStorage.getItem(legacyKey);
    if (!legacyRaw) {
        return { raw: null, usedLegacy: false };
    }
    try {
        localStorage.setItem(primaryKey, legacyRaw);
    } catch {
        // ignore migration failure
    }
    return { raw: legacyRaw, usedLegacy: true };
}

function getAnnotationStorageKey() {
    return `${STORAGE_KEY_PREFIX}_annotations_${getDocId()}`;
}

function getLegacyAnnotationStorageKey() {
    return `${LEGACY_STORAGE_KEY_PREFIX}_annotations_${getDocId()}`;
}

function getTextIndexStorageKey() {
    return `${STORAGE_KEY_PREFIX}_text_index_${getDocId()}`;
}

function getLegacyTextIndexStorageKey() {
    return `${LEGACY_STORAGE_KEY_PREFIX}_text_index_${getDocId()}`;
}

function applyAdaptiveRenderLimit() {
    let limit = 10;
    const memory = Number(navigator.deviceMemory || 0);

    if (Number.isFinite(memory) && memory > 0) {
        if (memory <= 2) limit = 4;
        else if (memory <= 4) limit = 6;
        else if (memory >= 8) limit = 14;
    } else {
        const cores = Number(navigator.hardwareConcurrency || 0);
        if (Number.isFinite(cores) && cores > 0) {
            if (cores <= 4) limit = 8;
            else if (cores >= 12) limit = 12;
        }
    }

    if (state.pdf && Number.isFinite(state.pdf.numPages)) {
        limit = Math.min(limit, Math.max(4, Math.min(24, state.pdf.numPages)));
    }

    state.maxRenderedPages = limit;
}

function syncFullscreenUI() {
    const btnFullscreen = document.getElementById('btnFullscreen');
    state.isFullscreen = !!document.fullscreenElement;
    document.body.classList.toggle('fullscreen-mode', state.isFullscreen);

    if (btnFullscreen) {
        btnFullscreen.classList.toggle('active', state.isFullscreen);
        btnFullscreen.title = state.isFullscreen ? '退出全屏 (F11)' : '全屏 (F11)';
        btnFullscreen.setAttribute('aria-label', state.isFullscreen ? '退出全屏' : '进入全屏');
    }
}

async function toggleFullscreen() {
    try {
        if (!document.fullscreenElement) {
            await document.documentElement.requestFullscreen();
        } else {
            await document.exitFullscreen();
        }
    } catch (error) {
        console.warn('全屏切换失败:', error);
        showAnnoActionToast('全屏切换失败', 'warning');
    }
}

function scheduleTextIndexSave() {
    if (state.indexSaveTimer) clearTimeout(state.indexSaveTimer);
    state.indexSaveTimer = setTimeout(() => {
        saveTextIndexNow();
    }, 600);
}

function saveTextIndexNow() {
    try {
        pruneTextIndexCache();
        const payload = {
            version: TEXT_INDEX_CACHE_VERSION,
            fileName: state.fileName,
            numPages: state.pdf?.numPages || 0,
            pages: state.indexedPageItems,
            access: state.indexedPageAccess
        };
        localStorage.setItem(getTextIndexStorageKey(), JSON.stringify(payload));
    } catch (e) {
        console.warn('保存文本索引缓存失败:', e);
    }
}

function loadTextIndexCacheFromStorage() {
    try {
        const key = getTextIndexStorageKey();
        const legacyKey = getLegacyTextIndexStorageKey();
        const { raw } = readLocalStorageWithLegacy(key, legacyKey);
        if (!raw) return;
        const parsed = JSON.parse(raw);

        const isVersionOk = Number(parsed?.version) === TEXT_INDEX_CACHE_VERSION;
        const isNameOk = !parsed?.fileName || parsed.fileName === state.fileName;
        if (!isVersionOk || !isNameOk) {
            localStorage.removeItem(key);
            localStorage.removeItem(legacyKey);
            return;
        }

        const pages = parsed?.pages;
        if (!pages || typeof pages !== 'object') return;
        state.indexedPageItems = {};
        state.indexedPageAccess = {};
        Object.keys(pages).forEach(page => {
            const pageNum = Number(page);
            const items = Array.isArray(pages[page]) ? pages[page] : [];
            if (!Number.isFinite(pageNum) || !items.length) return;
            state.indexedPageItems[pageNum] = items.map(v => String(v || ''));
            state.indexedPages.add(pageNum);
            const ts = Number(parsed?.access?.[pageNum] || Date.now());
            state.indexedPageAccess[pageNum] = ts;
        });
        pruneTextIndexCache();
    } catch (e) {
        console.warn('读取文本索引缓存失败:', e);
    }
}

function touchTextIndexPage(pageNum) {
    const p = Number(pageNum);
    if (!Number.isFinite(p)) return;
    state.indexedPageAccess[p] = Date.now();
}

function pruneTextIndexCache() {
    const pages = Object.keys(state.indexedPageItems).map(Number).filter(Number.isFinite);
    if (pages.length <= MAX_INDEX_CACHE_PAGES) return;
    const sorted = pages.sort((a, b) => {
        const ta = Number(state.indexedPageAccess[a] || 0);
        const tb = Number(state.indexedPageAccess[b] || 0);
        return ta - tb;
    });
    const removeCount = pages.length - MAX_INDEX_CACHE_PAGES;
    for (let i = 0; i < removeCount; i++) {
        const page = sorted[i];
        delete state.indexedPageItems[page];
        delete state.indexedPageAccess[page];
        state.indexedPages.delete(page);
    }
}

function createAnnotationId() {
    return `anno_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeAnnotationCommand(cmd, pageNum) {
    if (!cmd || typeof cmd !== 'object') return null;
    const type = cmd.type;
    if (!['path', 'text', 'eraser', 'highlight'].includes(type)) return null;

    return {
        ...cmd,
        id: cmd.id || createAnnotationId(),
        page: Number(cmd.page || pageNum || 1),
        createdAt: Number(cmd.createdAt || Date.now()),
        updatedAt: Number(cmd.updatedAt || Date.now())
    };
}

function normalizeAnnotationStore(rawStore) {
    const normalized = {};
    if (!rawStore || typeof rawStore !== 'object') return normalized;

    Object.keys(rawStore).forEach(page => {
        const pageNum = Number(page);
        if (!Number.isFinite(pageNum)) return;
        const list = Array.isArray(rawStore[page]) ? rawStore[page] : [];
        normalized[pageNum] = list
            .map(cmd => normalizeAnnotationCommand(cmd, pageNum))
            .filter(Boolean);
    });

    return normalized;
}

function exportAnnotationsPayload() {
    return {
        version: 1,
        exportedAt: new Date().toISOString(),
        docId: getDocId(),
        fileName: state.fileName,
        annotations: pageAnnotations
    };
}

function getSelectedAnnotation() {
    if (!annotationSelection.cmdId || !annotationSelection.page) return null;
    const store = getPageStore(annotationSelection.page);
    return store.find(cmd => cmd.id === annotationSelection.cmdId) || null;
}

function getSelectedAnnotationIds() {
    const ids = new Set(annotationSelection.selectedIds || []);
    if (annotationSelection.cmdId) ids.add(annotationSelection.cmdId);
    return ids;
}

function getSelectedAnnotations() {
    const ids = getSelectedAnnotationIds();
    if (!ids.size) return [];
    const selected = [];
    Object.keys(pageAnnotations).forEach((page) => {
        const store = pageAnnotations[page] || [];
        store.forEach((cmd) => {
            if (ids.has(cmd.id)) selected.push(cmd);
        });
    });
    return selected;
}

function updateAnnotationSelectionUI() {
    const selectedList = getSelectedAnnotations();
    const count = selectedList.length;

    if (elements.btnAnnoApplyEdit) elements.btnAnnoApplyEdit.disabled = count === 0;
    if (elements.btnAnnoDelete) elements.btnAnnoDelete.disabled = count === 0;

    if (!elements.annoSelectionStats) return;
    if (count === 0) {
        elements.annoSelectionStats.textContent = '未选中';
        return;
    }

    let textCount = 0;
    let highlightCount = 0;
    let inkCount = 0;
    selectedList.forEach((cmd) => {
        if (cmd.type === 'text') textCount += 1;
        else if (cmd.type === 'highlight') highlightCount += 1;
        else if (cmd.type === 'path' || cmd.type === 'eraser') inkCount += 1;
    });

    const parts = [];
    if (textCount) parts.push(`文${textCount}`);
    if (highlightCount) parts.push(`高${highlightCount}`);
    if (inkCount) parts.push(`笔${inkCount}`);
    const detail = parts.length ? ` · ${parts.join(' ')}` : '';
    elements.annoSelectionStats.textContent = `已选 ${count}${detail}`;

    if (elements.annoSelectionPopover && !elements.annoSelectionPopover.classList.contains('hidden')) {
        renderSelectionPopoverContent();
    }
}

function showAnnoActionToast(message, level = 'success') {
    const toast = elements.annoActionToast;
    if (!toast || !message) return;
    if (annoActionToastTimer) clearTimeout(annoActionToastTimer);
    toast.textContent = message;
    toast.classList.remove('success', 'warning', 'show');
    toast.classList.add(level === 'warning' ? 'warning' : 'success');
    requestAnimationFrame(() => toast.classList.add('show'));
    annoActionToastTimer = setTimeout(() => {
        toast.classList.remove('show');
        annoActionToastTimer = null;
    }, 1800);
}

function closeAnnoFloatingPanels() {
    elements.annoSelectionPopover?.classList.add('hidden');
    elements.annoHelpPopover?.classList.add('hidden');
}

function positionAnnoFloatingPanel(anchorEl, panelEl) {
    if (!anchorEl || !panelEl) return;
    const rect = anchorEl.getBoundingClientRect();
    panelEl.style.visibility = 'hidden';
    panelEl.classList.remove('hidden');

    const panelRect = panelEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 10;

    let left = rect.left;
    if (left + panelRect.width > vw - gap) left = vw - panelRect.width - gap;
    if (left < gap) left = gap;

    let top = rect.bottom + gap;
    if (top + panelRect.height > vh - gap) {
        top = rect.top - panelRect.height - gap;
    }
    if (top < gap) top = gap;

    panelEl.style.left = `${Math.round(left)}px`;
    panelEl.style.top = `${Math.round(top)}px`;
    panelEl.style.visibility = 'visible';
}

function renderSelectionPopoverContent() {
    const body = elements.annoSelectionPopoverContent;
    if (!body) return;
    const selected = getSelectedAnnotations();
    if (!selected.length) {
        body.textContent = '未选中对象';
        return;
    }

    const byType = { text: 0, highlight: 0, ink: 0 };
    const pages = new Map();
    selected.forEach((cmd) => {
        if (cmd.type === 'text') byType.text += 1;
        else if (cmd.type === 'highlight') byType.highlight += 1;
        else byType.ink += 1;
        const p = Number(cmd.page || 0);
        pages.set(p, Number(pages.get(p) || 0) + 1);
    });

    const pageSummary = [...pages.entries()]
        .sort((a, b) => a[0] - b[0])
        .slice(0, 6)
        .map(([p, c]) => `P${p}:${c}`)
        .join(' / ');
    const pageSuffix = pages.size > 6 ? ' ...' : '';

    body.innerHTML = [
        `<div>总数：${selected.length}</div>`,
        `<div>文本：${byType.text} ｜ 高亮：${byType.highlight} ｜ 笔迹：${byType.ink}</div>`,
        `<div>页分布：${pageSummary || '无'}${pageSuffix}</div>`
    ].join('');
}

function toggleSelectionPopover() {
    const panel = elements.annoSelectionPopover;
    const anchor = elements.annoSelectionStats;
    if (!panel || !anchor) return;
    const willOpen = panel.classList.contains('hidden');
    closeAnnoFloatingPanels();
    if (!willOpen) return;
    renderSelectionPopoverContent();
    positionAnnoFloatingPanel(anchor, panel);
}

function toggleAnnoHelpPopover() {
    const panel = elements.annoHelpPopover;
    const anchor = elements.btnAnnoHelp;
    if (!panel || !anchor) return;
    const willOpen = panel.classList.contains('hidden');
    closeAnnoFloatingPanels();
    if (!willOpen) return;
    positionAnnoFloatingPanel(anchor, panel);
}

function clearSelectedAnnotationVisual() {
    document.querySelectorAll('.hl-rect.selected').forEach(el => el.classList.remove('selected'));
    document.querySelectorAll('.textLayer > span.annotation-selected').forEach(el => el.classList.remove('annotation-selected'));
}

function selectAnnotation(cmd, options = {}) {
    const additive = !!options.additive;
    const prevPage = annotationSelection.page;
    if (!cmd) {
        annotationSelection.cmdId = null;
        annotationSelection.page = null;
        annotationSelection.selectedIds.clear();
        clearSelectedAnnotationVisual();
        if (Number.isFinite(prevPage)) redrawLayer(prevPage);
        updateAnnotationSelectionUI();
        return;
    }

    if (additive) {
        if (annotationSelection.selectedIds.has(cmd.id)) {
            annotationSelection.selectedIds.delete(cmd.id);
            if (annotationSelection.cmdId === cmd.id) {
                const rest = Array.from(annotationSelection.selectedIds);
                annotationSelection.cmdId = rest[0] || null;
                if (!annotationSelection.cmdId) annotationSelection.page = null;
            }
        } else {
            annotationSelection.selectedIds.add(cmd.id);
            annotationSelection.cmdId = cmd.id;
            annotationSelection.page = cmd.page;
        }
    } else {
        annotationSelection.selectedIds.clear();
        annotationSelection.selectedIds.add(cmd.id);
        annotationSelection.cmdId = cmd.id;
        annotationSelection.page = cmd.page;
    }

    if (Number.isFinite(prevPage) && prevPage !== cmd.page) redrawLayer(prevPage);
    redrawLayer(cmd.page);
    updateAnnotationSelectionUI();
}

function applyAnnotationSelectionByIds(nextIds, preferredPage = state.currentPage) {
    const prevIds = getSelectedAnnotationIds();
    const next = new Set(nextIds || []);

    annotationSelection.selectedIds.clear();
    next.forEach(id => annotationSelection.selectedIds.add(id));

    let primary = null;
    if (Number.isFinite(preferredPage)) {
        const pageStore = getPageStore(preferredPage);
        primary = pageStore.find(cmd => annotationSelection.selectedIds.has(cmd.id)) || null;
    }
    if (!primary) {
        const firstId = Array.from(annotationSelection.selectedIds)[0];
        primary = firstId ? findAnnotationById(firstId) : null;
    }

    annotationSelection.cmdId = primary?.id || null;
    annotationSelection.page = primary?.page || null;

    const changedPages = new Set([
        ...getPagesByAnnotationIds(prevIds),
        ...getPagesByAnnotationIds(annotationSelection.selectedIds)
    ]);
    changedPages.forEach(page => redrawLayer(page));
    updateAnnotationSelectionUI();
}

function selectAllAnnotationsOnCurrentPage() {
    const page = Number(state.currentPage || 1);
    const store = getPageStore(page);
    if (!store.length) return false;
    applyAnnotationSelectionByIds(new Set(store.map(cmd => cmd.id)), page);
    return true;
}

function invertSelectionOnCurrentPage() {
    const page = Number(state.currentPage || 1);
    const store = getPageStore(page);
    if (!store.length) return false;

    const next = new Set(getSelectedAnnotationIds());
    store.forEach((cmd) => {
        if (next.has(cmd.id)) next.delete(cmd.id);
        else next.add(cmd.id);
    });

    applyAnnotationSelectionByIds(next, page);
    return true;
}

function selectAnnotationsByTypeOnCurrentPage(typeKey) {
    const page = Number(state.currentPage || 1);
    const store = getPageStore(page);
    if (!store.length) return false;

    const matcher = (cmd) => {
        if (typeKey === 'text') return cmd.type === 'text';
        if (typeKey === 'highlight') return cmd.type === 'highlight';
        if (typeKey === 'ink') return cmd.type === 'path' || cmd.type === 'eraser';
        return true;
    };

    const ids = store.filter(matcher).map(cmd => cmd.id);
    if (!ids.length) return false;

    applyAnnotationSelectionByIds(new Set(ids), page);
    return true;
}

function scheduleAnnotationSave() {
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => {
        saveAnnotationsNow();
    }, 250);
}

function saveAnnotationsNow() {
    try {
        localStorage.setItem(getAnnotationStorageKey(), JSON.stringify(pageAnnotations));
    } catch (e) {
        console.warn('保存批注失败:', e);
    }
}

function loadAnnotationsFromStorage() {
    try {
        const key = getAnnotationStorageKey();
        const { raw } = readLocalStorageWithLegacy(key, getLegacyAnnotationStorageKey());
        if (!raw) return;
        const parsed = normalizeAnnotationStore(JSON.parse(raw));
        Object.keys(parsed).forEach(page => {
            pageAnnotations[page] = parsed[page];
        });
    } catch (e) {
        console.warn('读取批注失败:', e);
    }
}

function updateLoadingProgress(loaded, total) {
    if (!elements.loadingProgressBar || !elements.loadingText) return;
    const percent = total ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
    elements.loadingProgressBar.style.width = `${percent}%`;
    elements.loadingText.textContent = total
        ? `正在加载 PDF... ${percent}%`
        : '正在加载 PDF...';
}

function hideLoadingOverlay() {
    if (!elements.loadingOverlay) return;
    elements.loadingOverlay.classList.add('hidden');
}

function normalizeText(str) {
    return (str || '').toLowerCase();
}

function escapeHtml(str) {
    return (str || '').replace(/[&<>"']/g, (m) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[m]));
}

function highlightSnippet(snippet, query) {
    const safe = escapeHtml(snippet || '');
    if (!query) return safe;
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(${escaped})`, 'ig');
    return safe.replace(re, '<mark>$1</mark>');
}

function getSearchHistoryKey() {
    return 'acadmaster_pdf_search_history_v1';
}

function getLegacySearchHistoryKey() {
    return 'xiaoet_pdf_search_history_v1';
}

function getSearchSessionKey() {
    return `${STORAGE_KEY_PREFIX}_search_session_${getDocId()}`;
}

function getLegacySearchSessionKey() {
    return `${LEGACY_STORAGE_KEY_PREFIX}_search_session_${getDocId()}`;
}

function saveSearchSessionNow() {
    try {
        const payload = {
            version: 1,
            savedAt: Date.now(),
            query: state.searchQuery || '',
            scope: state.searchScope || 'all',
            searchIndex: Number(state.searchIndex || -1),
            searchResultPage: Number(state.searchResultPage || 1),
            collapsedPages: Array.from(state.searchCollapsedPages || []).map(v => Number(v)).filter(Number.isFinite)
        };
        localStorage.setItem(getSearchSessionKey(), JSON.stringify(payload));
    } catch {
        // ignore
    }
}

function scheduleSearchSessionSave() {
    if (state.searchSessionTimer) clearTimeout(state.searchSessionTimer);
    state.searchSessionTimer = setTimeout(() => {
        saveSearchSessionNow();
        state.searchSessionTimer = null;
    }, 200);
}

function loadSearchSession() {
    try {
        const key = getSearchSessionKey();
        const legacyKey = getLegacySearchSessionKey();
        const { raw } = readLocalStorageWithLegacy(key, legacyKey);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;

        const savedAt = Number(parsed.savedAt || 0);
        if (!savedAt || (Date.now() - savedAt) > SEARCH_SESSION_TTL_MS) {
            localStorage.removeItem(key);
            localStorage.removeItem(legacyKey);
            return null;
        }

        const query = String(parsed.query || '').trim();
        const scope = parsed.scope === 'current' ? 'current' : 'all';
        const searchIndex = Number(parsed.searchIndex);
        const searchResultPage = Number(parsed.searchResultPage);
        const collapsedPages = Array.isArray(parsed.collapsedPages)
            ? parsed.collapsedPages.map(v => Number(v)).filter(Number.isFinite)
            : [];

        return {
            query,
            scope,
            searchIndex: Number.isFinite(searchIndex) ? searchIndex : -1,
            searchResultPage: Number.isFinite(searchResultPage) && searchResultPage > 0 ? searchResultPage : 1,
            collapsedPages
        };
    } catch {
        return null;
    }
}

function clearSearchSession(options = {}) {
    const shouldClearInput = options.clearInput !== false;
    const shouldRender = options.render !== false;

    try {
        localStorage.removeItem(getSearchSessionKey());
        localStorage.removeItem(getLegacySearchSessionKey());
    } catch {
        // ignore
    }

    state.searchQuery = '';
    state.searchResults = [];
    state.searchHitStats = {};
    state.searchIndex = -1;
    state.searchCurrentEl = null;
    state.searchResultPage = 1;
    state.searchCollapsedPages.clear();
    state.searchNoticeMessage = '';
    if (state.searchNoticeTimer) {
        clearTimeout(state.searchNoticeTimer);
        state.searchNoticeTimer = null;
    }

    if (shouldClearInput && elements.searchInput) {
        elements.searchInput.value = '';
    }
    if (elements.searchStats) {
        elements.searchStats.textContent = '0/0';
    }

    clearSearchHighlights();
    if (shouldRender) renderSearchResultsList();
}

function showSearchSessionNotice(message, duration = 2200) {
    const text = String(message || '').trim();
    if (state.searchNoticeTimer) {
        clearTimeout(state.searchNoticeTimer);
        state.searchNoticeTimer = null;
    }
    state.searchNoticeMessage = text;
    renderSearchResultsList();
    if (!text) return;

    state.searchNoticeTimer = setTimeout(() => {
        state.searchNoticeMessage = '';
        state.searchNoticeTimer = null;
        renderSearchResultsList();
    }, Math.max(800, Number(duration) || 2200));
}

function loadSearchHistory() {
    try {
        const { raw } = readLocalStorageWithLegacy(getSearchHistoryKey(), getLegacySearchHistoryKey());
        const arr = JSON.parse(raw || '[]');
        if (!Array.isArray(arr)) {
            state.searchHistory = [];
            return;
        }

        state.searchHistory = arr
            .map(item => {
                if (!item) return null;
                if (typeof item === 'string') {
                    return { query: item.trim(), pinned: false };
                }
                if (typeof item === 'object') {
                    return {
                        query: (item.query || '').trim(),
                        pinned: !!item.pinned
                    };
                }
                return null;
            })
            .filter(item => item && item.query)
            .slice(0, 10)
            .sort((a, b) => Number(b.pinned) - Number(a.pinned));
    } catch {
        state.searchHistory = [];
    }
}

function saveSearchHistory() {
    try {
        localStorage.setItem(getSearchHistoryKey(), JSON.stringify(state.searchHistory.slice(0, 10)));
    } catch {
        // ignore
    }
}

function pushSearchHistory(query) {
    const q = (query || '').trim();
    if (!q) return;

    const existing = state.searchHistory.find(item => item.query === q);
    const pinned = !!existing?.pinned;
    const rest = state.searchHistory.filter(item => item.query !== q);
    state.searchHistory = [{ query: q, pinned }, ...rest]
        .slice(0, 10)
        .sort((a, b) => Number(b.pinned) - Number(a.pinned));
    saveSearchHistory();
}

function removeSearchHistoryItem(query) {
    state.searchHistory = state.searchHistory.filter(item => item.query !== query);
    state.searchHistorySelection.delete(query);
    saveSearchHistory();
}

function toggleSearchHistoryPinned(query) {
    state.searchHistory = state.searchHistory.map(item => {
        if (item.query !== query) return item;
        return { ...item, pinned: !item.pinned };
    }).sort((a, b) => Number(b.pinned) - Number(a.pinned));
    saveSearchHistory();
}

function clearSearchHistory() {
    state.searchHistory = [];
    state.searchHistorySelection.clear();
    saveSearchHistory();
}

function removeSelectedSearchHistory() {
    if (!state.searchHistorySelection.size) return;
    state.searchHistory = state.searchHistory.filter(item => !state.searchHistorySelection.has(item.query));
    state.searchHistorySelection.clear();
    saveSearchHistory();
}

function buildContextSnippet(items, centerIndex, maxChars = 120) {
    if (!Array.isArray(items) || centerIndex < 0 || centerIndex >= items.length) return '';
    const left = Math.max(0, centerIndex - 3);
    const right = Math.min(items.length - 1, centerIndex + 3);
    let snippet = items.slice(left, right + 1).map(it => (it?.str || '').trim()).filter(Boolean).join(' ');
    if (snippet.length > maxChars) {
        snippet = `${snippet.slice(0, maxChars - 1)}…`;
    }
    return snippet;
}

function downloadSearchResultsAsJson() {
    if (!state.searchResults.length) return;
    const payload = {
        exportedAt: new Date().toISOString(),
        query: state.searchQuery,
        scope: state.searchScope,
        total: state.searchResults.length,
        results: state.searchResults
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pdf-search-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function downloadSearchResultsAsCsv() {
    if (!state.searchResults.length) return;
    const esc = (val) => `"${String(val ?? '').replace(/"/g, '""')}"`;
    const lines = [
        ['query', 'scope', 'page', 'indexInPage', 'snippet'].map(esc).join(',')
    ];

    state.searchResults.forEach(r => {
        lines.push([
            state.searchQuery,
            state.searchScope,
            r.page,
            r.indexInPage,
            r.snippet
        ].map(esc).join(','));
    });

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pdf-search-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function downloadSearchResultsAsMarkdown() {
    if (!state.searchResults.length) return;
    const header = `# PDF 搜索结果\n\n- 关键词：${state.searchQuery}\n- 范围：${state.searchScope === 'current' ? '当前页' : '全文'}\n- 总数：${state.searchResults.length}\n\n`;
    const body = state.searchResults.map((r, idx) => (
        `## ${idx + 1}. 第 ${r.page} 页（匹配 ${r.indexInPage}）\n\n${r.snippet || '(无预览)'}\n`
    )).join('\n');

    const blob = new Blob([header + body], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pdf-search-${Date.now()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function updateOutlineActive(pageNum = state.currentPage) {
    if (!state.outlineElements || !state.outlineElements.length) return;
    let active = null;
    state.outlineElements.forEach(el => {
        const start = parseInt(el.dataset.page || '0', 10);
        const end = parseInt(el.dataset.endPage || `${start}`, 10);
        if (start && pageNum >= start && pageNum <= end) {
            if (!active || start >= parseInt(active.dataset.page || '0', 10)) {
                active = el;
            }
        }
    });

    state.outlineElements.forEach(el => el.classList.toggle('active', el === active));

    if (active?.dataset?.nodeId) {
        expandOutlineAncestors(active.dataset.nodeId);
        active.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

function expandOutlineAncestors(nodeId) {
    let currentId = nodeId;
    while (currentId) {
        const node = state.outlineTreeNodes[currentId];
        if (!node) break;

        if (node.childrenEl) {
            node.childrenEl.classList.remove('collapsed');
            node.childrenEl.classList.add('expanded');
        }
        if (node.toggleEl) {
            node.toggleEl.classList.remove('collapsed');
            node.toggleEl.textContent = '▾';
        }

        currentId = node.parentId;
    }
}

function clearSearchHighlights() {
    if (state.searchCurrentEl) {
        state.searchCurrentEl.classList.remove('current-search-hit');
        state.searchCurrentEl = null;
    }
    document.querySelectorAll('.textLayer > span.search-hit').forEach(span => {
        span.classList.remove('search-hit', 'current-search-hit');
    });

    if (elements.searchResultsView) {
        elements.searchResultsView.querySelectorAll('.search-result-item.active').forEach(el => el.classList.remove('active'));
    }
}

function applySearchHighlightOnPage(pageNum) {
    if (!state.searchQuery) return;

    const pageEl = document.getElementById(`page-${pageNum}`);
    if (!pageEl) return;

    const textLayer = pageEl.querySelector('.textLayer');
    if (!textLayer) return;

    const spans = textLayer.querySelectorAll('span');
    if (!spans.length) return;

    const keyword = normalizeText(state.searchQuery);
    spans.forEach(span => {
        span.classList.remove('search-hit', 'current-search-hit');
        const txt = normalizeText(span.textContent);
        if (keyword && txt.includes(keyword)) {
            span.classList.add('search-hit');
        }
    });
}

function renderSearchResultsList() {
    if (!elements.searchResultsView) return;

    const noticeHtml = state.searchNoticeMessage
        ? `<div class="search-session-notice">${escapeHtml(state.searchNoticeMessage)}</div>`
        : '';

    if (!state.searchQuery) {
        const historyHtml = state.searchHistory.length
            ? `<div class="search-history-header">
                    <div class="search-history-title">最近搜索</div>
                    <div class="search-history-actions">
                        <button class="search-history-delete-selected" type="button" ${state.searchHistorySelection.size ? '' : 'disabled'}>删除选中</button>
                        <button class="search-session-clear" type="button">清会话</button>
                        <button class="search-history-clear" type="button">清空</button>
                    </div>
               </div>
               <div class="search-history-list">
                 ${state.searchHistory.map(item => `<div class="search-history-item" data-search-history="${escapeHtml(item.query)}">
                     <input class="search-history-check" type="checkbox" ${state.searchHistorySelection.has(item.query) ? 'checked' : ''}>
                     <button class="search-history-pin${item.pinned ? ' pinned' : ''}" type="button" title="置顶/取消置顶">★</button>
                     <button class="search-history-use" type="button">${escapeHtml(item.query)}</button>
                     <button class="search-history-remove" type="button" title="删除">×</button>
                 </div>`).join('')}
               </div>`
            : '<div class="search-empty">输入关键词并回车后，这里会显示搜索结果</div>';
        elements.searchResultsView.innerHTML = `${noticeHtml}${historyHtml}`;
        elements.searchResultsView.querySelector('.search-history-clear')?.addEventListener('click', () => {
            clearSearchHistory();
            renderSearchResultsList();
        });
        elements.searchResultsView.querySelector('.search-history-delete-selected')?.addEventListener('click', () => {
            removeSelectedSearchHistory();
            renderSearchResultsList();
        });
        elements.searchResultsView.querySelector('.search-session-clear')?.addEventListener('click', () => {
            clearSearchSession({ clearInput: true, render: true });
        });
        elements.searchResultsView.querySelectorAll('.search-history-check').forEach(chk => {
            chk.addEventListener('change', () => {
                const wrap = chk.closest('.search-history-item');
                const q = wrap?.dataset?.searchHistory || '';
                if (!q) return;
                if (chk.checked) state.searchHistorySelection.add(q);
                else state.searchHistorySelection.delete(q);
                renderSearchResultsList();
            });
        });
        elements.searchResultsView.querySelectorAll('.search-history-use').forEach(btn => {
            btn.addEventListener('click', () => {
                const q = btn.textContent?.trim() || '';
                if (!q || !state.runSearchFn) return;
                elements.searchInput.value = q;
                state.runSearchFn();
            });
        });
        elements.searchResultsView.querySelectorAll('.search-history-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const wrap = btn.closest('.search-history-item');
                const q = wrap?.dataset?.searchHistory || '';
                if (!q) return;
                removeSearchHistoryItem(q);
                renderSearchResultsList();
            });
        });
        elements.searchResultsView.querySelectorAll('.search-history-pin').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const wrap = btn.closest('.search-history-item');
                const q = wrap?.dataset?.searchHistory || '';
                if (!q) return;
                toggleSearchHistoryPinned(q);
                renderSearchResultsList();
            });
        });
        return;
    }

    if (state.searchResults.length === 0) {
        elements.searchResultsView.innerHTML = `${noticeHtml}<div class="search-empty">未找到匹配结果。建议：缩短关键词、切换“全文/当前页”、检查拼写。</div>`;
        return;
    }

    const totalPages = Math.max(1, Math.ceil(state.searchResults.length / state.searchPageSize));
    if (state.searchResultPage > totalPages) state.searchResultPage = totalPages;
    if (state.searchResultPage < 1) state.searchResultPage = 1;

    const startIndex = (state.searchResultPage - 1) * state.searchPageSize;
    const endIndex = Math.min(state.searchResults.length, startIndex + state.searchPageSize);
    const visibleResults = state.searchResults.slice(startIndex, endIndex);
    const heatSummary = Object.entries(state.searchHitStats || {})
        .map(([page, count]) => ({ page: Number(page), count: Number(count || 0) }))
        .filter(item => Number.isFinite(item.page) && item.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, 3)
        .map(item => `P${item.page}(${item.count})`)
        .join(' / ');

    const grouped = new Map();
    visibleResults.forEach((result, localIdx) => {
        const idx = startIndex + localIdx;
        if (!grouped.has(result.page)) grouped.set(result.page, []);
        grouped.get(result.page).push({ ...result, resultIndex: idx });
    });

    const groupsHtml = Array.from(grouped.entries()).map(([page, items]) => {
        const collapsed = state.searchCollapsedPages.has(page);
        const itemHtml = items.map((result) => {
            const highlightedSnippet = highlightSnippet(result.snippet || '', state.searchQuery);
            const scopeTag = state.searchScope === 'current' ? ' · 当前页' : '';
            return `<button class="search-result-item${result.resultIndex === state.searchIndex ? ' active' : ''}" data-result-index="${result.resultIndex}">
                <div class="search-result-meta">第 ${result.page} 页 · 匹配 ${result.indexInPage}${scopeTag}</div>
                <div class="search-result-snippet">${highlightedSnippet || '(无可预览文本)'}</div>
            </button>`;
        }).join('');

        return `<section class="search-group${collapsed ? ' collapsed' : ''}" data-page="${page}">
            <button class="search-group-header" data-page="${page}" type="button">
                <span>第 ${page} 页</span>
                <span>${items.length} 条</span>
            </button>
            <div class="search-group-list">${itemHtml}</div>
        </section>`;
    }).join('');

        const pagerHtml = `<div class="search-pagination">
            <button class="search-page-btn" data-page-action="prev" ${state.searchResultPage === 1 ? 'disabled' : ''}>上一页</button>
            <span class="search-page-info">${state.searchResultPage}/${totalPages} · 共 ${state.searchResults.length} 条</span>
            ${heatSummary ? `<span class="search-page-info" title="命中热度（Top 3）">热度: ${heatSummary}</span>` : ''}
            <button class="search-page-btn" data-page-action="next" ${state.searchResultPage === totalPages ? 'disabled' : ''}>下一页</button>
            <input class="search-page-jump" type="number" min="1" max="${totalPages}" value="${state.searchResultPage}" title="跳转页码">
            <button class="search-page-go" type="button">跳转</button>
            <button class="search-session-clear" type="button">清会话</button>
            <button class="search-export-btn" data-export-format="json" type="button">JSON</button>
            <button class="search-export-btn" data-export-format="csv" type="button">CSV</button>
            <button class="search-export-btn" data-export-format="md" type="button">MD</button>
        </div>`;

    const html = `${noticeHtml}${groupsHtml}${pagerHtml}`;

    elements.searchResultsView.innerHTML = html;

    elements.searchResultsView.querySelectorAll('.search-group-header').forEach(btn => {
        btn.addEventListener('click', () => {
            const page = parseInt(btn.dataset.page || '0', 10);
            if (!page) return;
            if (state.searchCollapsedPages.has(page)) state.searchCollapsedPages.delete(page);
            else state.searchCollapsedPages.add(page);
            scheduleSearchSessionSave();
            renderSearchResultsList();
        });
    });

    elements.searchResultsView.querySelectorAll('.search-result-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.resultIndex, 10);
            if (Number.isNaN(idx)) return;
            state.searchIndex = idx;
            jumpToSearchResult(idx);
        });
    });

    elements.searchResultsView.querySelectorAll('.search-page-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.pageAction;
            if (action === 'prev' && state.searchResultPage > 1) state.searchResultPage -= 1;
            if (action === 'next') state.searchResultPage += 1;
            scheduleSearchSessionSave();
            renderSearchResultsList();
        });
    });

    const pageJumpInput = elements.searchResultsView.querySelector('.search-page-jump');
    const jumpToPage = () => {
        if (!pageJumpInput) return;
        const val = parseInt(pageJumpInput.value, 10);
        if (Number.isNaN(val)) return;
        state.searchResultPage = Math.min(Math.max(val, 1), totalPages);
        scheduleSearchSessionSave();
        renderSearchResultsList();
    };

    pageJumpInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            jumpToPage();
        }
    });
    elements.searchResultsView.querySelector('.search-page-go')?.addEventListener('click', jumpToPage);
    elements.searchResultsView.querySelector('.search-session-clear')?.addEventListener('click', () => {
        clearSearchSession({ clearInput: true, render: true });
    });
    elements.searchResultsView.querySelectorAll('.search-export-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const format = btn.dataset.exportFormat;
            if (format === 'csv') downloadSearchResultsAsCsv();
            else if (format === 'md') downloadSearchResultsAsMarkdown();
            else downloadSearchResultsAsJson();
        });
    });
}

async function init() {
    const params = new URLSearchParams(window.location.search);
    const fileUrl = params.get('file');

    if (!fileUrl) {
        alert("未找到 PDF 文件路径。");
        return;
    }

    state.fileUrl = fileUrl;
    state.fileName = fileUrl.split('/').pop() || 'document.pdf';

    const lowerUrl = fileUrl.toLowerCase();
    const isLikelyPdf = lowerUrl.endsWith('.pdf') || lowerUrl.includes('.pdf?') || lowerUrl.startsWith('blob:') || lowerUrl.startsWith('data:application/pdf');
    if (!isLikelyPdf) {
        const shouldContinue = confirm('该文件看起来不是标准 PDF 链接，仍要继续加载吗？');
        if (!shouldContinue) return;
    }

    try {
        const headResp = await fetch(fileUrl, { method: 'HEAD' });
        const len = parseInt(headResp.headers.get('content-length') || '0', 10);
        if (len > 120 * 1024 * 1024) {
            const continueLarge = confirm('该 PDF 大于 120MB，可能出现卡顿。是否继续？');
            if (!continueLarge) return;
        }
    } catch {
        // 某些 file:// 或跨域资源无法 HEAD，忽略即可
    }

    applyAdaptiveRenderLimit();

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

        loadingTask.onProgress = ({ loaded, total }) => {
            updateLoadingProgress(loaded, total);
        };

        loadingTask.onPassword = (updatePassword, reason) => {
            const tip = reason === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD
                ? '密码错误，请重新输入该 PDF 的密码：'
                : '该 PDF 需要密码，请输入：';
            const password = prompt(tip) || '';
            updatePassword(password);
        };

        state.pdf = await loadingTask.promise;
        applyAdaptiveRenderLimit();

        elements.pageTotal.textContent = `/ ${state.pdf.numPages}`;
        try {
            elements.title.textContent = decodeURIComponent(fileUrl.split('/').pop().split('?')[0]);
        } catch {
            elements.title.textContent = state.fileName;
        }

        applyDarkMode(state.isDarkMode);
        loadAnnotationsFromStorage();
        loadTextIndexCacheFromStorage();
        initTextIndexWorker();

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
        hideLoadingOverlay();

        document.body.classList.add('loaded');
    } catch (err) {
        console.error("XiaoEt PDF Critical Error:", err);
        alert("加载 PDF 失败: " + err.message);
    }
}

// Function to unrender a page to free up memory
function unrenderPage(pageNum, pageEl) {
    if (state.isSelectingText) return;

    // Clear canvas
    const canvas = pageEl.querySelector('canvas');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        canvas.width = 1;
        canvas.height = 1;
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

function updateCurrentPageByObserver() {
    const ratioEntries = Object.entries(state.visiblePageRatios || {});
    if (!ratioEntries.length) return;

    const containerRect = elements.container?.getBoundingClientRect?.();
    const centerY = containerRect ? (containerRect.top + containerRect.height / 2) : null;
    const centerCandidates = [];

    let bestPage = null;
    let bestRatio = 0;

    ratioEntries.forEach(([page, ratio]) => {
        const pageNum = Number(page);
        const score = Number(ratio || 0);
        if (!Number.isFinite(pageNum) || !Number.isFinite(score) || score <= 0) return;

        if (centerY !== null) {
            const pageEl = document.getElementById(`page-${pageNum}`);
            if (pageEl) {
                const rect = pageEl.getBoundingClientRect();
                const isCrossingCenter = rect.top <= centerY && rect.bottom >= centerY;
                if (isCrossingCenter) {
                    const visualCenter = (rect.top + rect.bottom) / 2;
                    centerCandidates.push({
                        pageNum,
                        ratio: score,
                        distance: Math.abs(visualCenter - centerY)
                    });
                }
            }
        }

        if (score > bestRatio || (score === bestRatio && (bestPage === null || pageNum < bestPage))) {
            bestRatio = score;
            bestPage = pageNum;
        }
    });

    if (centerCandidates.length > 0) {
        const currentOnCenter = centerCandidates.some(item => item.pageNum === state.currentPage);
        if (currentOnCenter) {
            bestPage = state.currentPage;
        } else {
            centerCandidates.sort((a, b) => {
                if (a.distance !== b.distance) return a.distance - b.distance;
                if (a.ratio !== b.ratio) return b.ratio - a.ratio;
                return a.pageNum - b.pageNum;
            });
            bestPage = centerCandidates[0].pageNum;
        }
    }

    if (!bestPage || state.currentPage === bestPage) return;

    state.currentPage = bestPage;
    if (elements.pageNumber) {
        elements.pageNumber.value = String(bestPage);
    }
    updateOutlineActive(bestPage);
}

function setupPageVisibilityObserver() {
    if (state.pageObserver) {
        state.pageObserver.disconnect();
    }

    state.visiblePageRatios = {};

    const thresholds = [];
    for (let i = 0; i <= 20; i++) {
        thresholds.push(i / 20);
    }

    state.pageObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const pageNum = parseInt(entry.target.dataset.pageNumber, 10);
            if (Number.isNaN(pageNum)) return;

            state.visiblePageRatios[pageNum] = entry.isIntersecting ? entry.intersectionRatio : 0;

            if (entry.isIntersecting) {
                const canvas = entry.target.querySelector('canvas');
                const textLayer = entry.target.querySelector('.textLayer');
                if (canvas && textLayer && !entry.target.dataset.rendered && state.renderedPages.size < state.maxRenderedPages) {
                    entry.target.dataset.rendered = 'true';
                    state.renderedPages.add(pageNum);
                    renderPage(pageNum, canvas, textLayer);
                }
            } else if (state.renderedPages.has(pageNum) && state.renderedPages.size > Math.max(4, Math.floor(state.maxRenderedPages * 0.7))) {
                unrenderPage(pageNum, entry.target);
            }
        });

        updateCurrentPageByObserver();
    }, {
        root: elements.container,
        rootMargin: '150% 0px 150% 0px',
        threshold: thresholds
    });

    document.querySelectorAll('.page-container').forEach(pageEl => state.pageObserver.observe(pageEl));
}

async function renderAllPages() {
    setupPageVisibilityObserver();

    const currentPage = Math.min(Math.max(state.currentPage || 1, 1), state.pdf?.numPages || 1);
    const pageEl = document.getElementById(`page-${currentPage}`);
    if (!pageEl || pageEl.dataset.rendered || state.renderedPages.size >= state.maxRenderedPages) return;

    const canvas = pageEl.querySelector('canvas');
    const textLayer = pageEl.querySelector('.textLayer');
    if (!canvas || !textLayer) return;

    pageEl.dataset.rendered = 'true';
    state.renderedPages.add(currentPage);
    renderPage(currentPage, canvas, textLayer);
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
        const outputScale = Math.min(window.devicePixelRatio || 1, 2.5);

        // HiDPI rendering for sharper output on high-density displays
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        const canvasContext = canvas.getContext('2d', { alpha: false });
        canvasContext.setTransform(1, 0, 0, 1, 0, 0);

        // Clear canvas
        canvasContext.fillStyle = 'white';
        canvasContext.fillRect(0, 0, canvas.width, canvas.height);

        // 2. Start new render
        const renderTask = page.render({
            canvasContext,
            viewport,
            intent: 'display',
            transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null
        });
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
                state.textCache[num] = textContent;
                enqueuePageForIndex(num, textContent);
                textLayer.innerHTML = '';
                textLayer.style.setProperty('--scale-factor', viewport.scale);

                // Text Layer Render Task
                await pdfjsLib.renderTextLayer({
                    textContentSource: textContent,
                    container: textLayer,
                    viewport,
                    textDivs: []
                }).promise;

                applySearchHighlightOnPage(num);
            } catch (e) {
                // Text layer error shouldn't fail page render
                if (e.name !== 'RenderingCancelledException') {
                    console.warn("Text layer render failed:", e);
                }
            }
        }

        if (typeof page.cleanup === 'function') {
            page.cleanup();
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
    state.outlineElements = [];
    state.outlineTreeNodes = {};

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
    let outlineNodeCounter = 0;

    const renderItems = (items, target, level = 0, parentId = null) => {
        items.forEach(item => {
            outlineNodeCounter += 1;
            const nodeId = `outline-node-${outlineNodeCounter}`;

            const nodeWrap = document.createElement('div');
            nodeWrap.className = 'outline-node';

            const row = document.createElement('div');
            row.className = 'outline-row';
            row.style.paddingLeft = `${Math.min(level * 12, 48)}px`;

            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'outline-toggle';

            const hasChildren = !!(item.items && item.items.length);
            toggle.textContent = hasChildren ? '▾' : '·';
            if (!hasChildren) toggle.classList.add('leaf');

            const el = document.createElement('div');
            el.className = 'outline-item';
            el.textContent = item.title;
            el.dataset.nodeId = nodeId;
            state.outlineElements.push(el);

            row.appendChild(toggle);
            row.appendChild(el);
            nodeWrap.appendChild(row);

            const childrenContainer = document.createElement('div');
            childrenContainer.className = 'outline-children expanded';

            if (!hasChildren) {
                childrenContainer.classList.add('hidden');
            }

            state.outlineTreeNodes[nodeId] = {
                parentId,
                childrenEl: childrenContainer,
                toggleEl: toggle
            };

            toggle.onclick = (evt) => {
                evt.stopPropagation();
                if (!hasChildren) return;
                const collapsed = childrenContainer.classList.toggle('collapsed');
                childrenContainer.classList.toggle('expanded', !collapsed);
                toggle.classList.toggle('collapsed', collapsed);
                toggle.textContent = collapsed ? '▸' : '▾';
            };

            el.onclick = async () => {
                if (item.dest) {
                    const dest = typeof item.dest === 'string' ? await state.pdf.getDestination(item.dest) : item.dest;
                    const idx = await state.pdf.getPageIndex(dest[0]);
                    document.getElementById(`page-${idx + 1}`).scrollIntoView({ behavior: 'smooth' });
                }
            };

            nodeWrap.appendChild(childrenContainer);
            target.appendChild(nodeWrap);

            if (hasChildren) {
                renderItems(item.items, childrenContainer, level + 1, nodeId);
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

        const maxMap = Math.min(flat.length, state.outlineElements.length);
        for (let i = 0; i < maxMap; i++) {
            const el = state.outlineElements[i];
            el.dataset.page = flat[i].page;
            el.dataset.endPage = flat[i].endPage;
        }

        updateOutlineActive(state.currentPage);
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
    elements.thumbnailsView = thumbContainer;
    thumbContainer.innerHTML = '';

    for (let i = 1; i <= state.pdf.numPages; i++) {
        const item = document.createElement('div');
        item.className = 'thumbnail-item';
        const canvas = document.createElement('canvas');
        canvas.dataset.page = i;
        canvas.dataset.rendered = 'false';
        const span = document.createElement('span');
        span.textContent = `PAGE ${i} `;

        item.appendChild(canvas);
        item.appendChild(span);
        thumbContainer.appendChild(item);

        item.onclick = () => {
            const el = document.getElementById(`page-${i}`);
            if (el) el.scrollIntoView({ behavior: 'smooth' });
        };
    }

    setupThumbnailLazyRender();
}

function setupThumbnailLazyRender() {
    if (state.thumbnailObserver) {
        state.thumbnailObserver.disconnect();
    }

    state.thumbnailObserver = new IntersectionObserver(async (entries) => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const canvas = entry.target;
            if (canvas.dataset.rendered === 'true') continue;

            const pageNum = parseInt(canvas.dataset.page, 10);
            if (Number.isNaN(pageNum)) continue;

            try {
                const page = await state.pdf.getPage(pageNum);
                const viewport = page.getViewport({ scale: 0.15 });
                canvas.height = viewport.height;
                canvas.width = viewport.width;
                await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
                canvas.dataset.rendered = 'true';
                if (typeof page.cleanup === 'function') page.cleanup();
            } catch (e) {
                console.warn('缩略图渲染失败:', pageNum, e);
            }
        }
    }, {
        root: document.getElementById('thumbnailsView'),
        rootMargin: '200px 0px 200px 0px',
        threshold: 0.01
    });

    document.querySelectorAll('#thumbnailsView canvas[data-page]').forEach(c => state.thumbnailObserver.observe(c));
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
    textUnderline: false,
    textStrike: false,
    mode: 'source-over'
};

function getTextDecorationValue(source = annoState) {
    const underline = !!source?.textUnderline;
    const strike = !!source?.textStrike;
    if (underline && strike) return 'underline line-through';
    if (underline) return 'underline';
    if (strike) return 'line-through';
    return 'none';
}

function parseTextDecorationFlags(decoration) {
    const deco = String(decoration || '').toLowerCase();
    return {
        underline: deco.includes('underline'),
        strike: deco.includes('line-through') || deco.includes('strikethrough')
    };
}

function drawTextDecorations(ctx, cmd, metrics) {
    const flags = parseTextDecorationFlags(cmd.decoration);
    if (!flags.underline && !flags.strike) return;

    const fontSize = Number(cmd.size || 14);
    const x = Number(cmd.x || 0);
    const y = Number(cmd.y || 0);
    const width = Number(metrics?.width || 0);
    if (!width) return;

    ctx.save();
    ctx.strokeStyle = cmd.color || '#111827';
    ctx.lineWidth = Math.max(1, Math.round(fontSize / 14));
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = (cmd.alpha !== undefined) ? cmd.alpha : 1.0;

    if (flags.underline) {
        const uy = y + fontSize + Math.max(1, fontSize * 0.08);
        ctx.beginPath();
        ctx.moveTo(x, uy);
        ctx.lineTo(x + width, uy);
        ctx.stroke();
    }

    if (flags.strike) {
        const sy = y + fontSize * 0.56;
        ctx.beginPath();
        ctx.moveTo(x, sy);
        ctx.lineTo(x + width, sy);
        ctx.stroke();
    }

    ctx.restore();
}

const drawingState = {
    isDrawing: false,
    isDraggingText: false,
    draggingCmd: null,
    dragStartPos: null,
    dragOrigin: null,
    isLassoSelecting: false,
    lassoBoxEl: null,
    lassoPage: null,
    lassoStart: null,
    lassoCurrent: null,
    lassoPageRect: null,
    lassoPointerId: null,
    lassoAdditive: false,
    isExportSelecting: false,
    exportBoxEl: null,
    exportPage: null,
    exportStart: null,
    exportCurrent: null,
    exportPointerId: null
};

const annotationSelection = {
    cmdId: null,
    page: null,
    selectedIds: new Set()
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
    scheduleAnnotationSave();
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
    scheduleAnnotationSave();
}

function performRedo() {
    if (redoStack.length === 0) return;
    const cmd = redoStack.pop();
    undoStack.push(cmd);

    // Add back to page store
    getPageStore(cmd.page).push(cmd);

    redrawLayer(cmd.page);
    updateHistoryButtons();
    scheduleAnnotationSave();
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

    if (annotationSelection.cmdId) {
        const hasPrimary = commands.some(c => c.id === annotationSelection.cmdId);
        if (!hasPrimary && annotationSelection.page === pageNum) {
            annotationSelection.cmdId = null;
            annotationSelection.page = null;
        }
    }

    const existingIds = new Set(commands.map(c => c.id));
    annotationSelection.selectedIds.forEach((id) => {
        if (!existingIds.has(id) && annotationSelection.page === pageNum) {
            annotationSelection.selectedIds.delete(id);
        }
    });
    updateAnnotationSelectionUI();
}

/**
 * 逐 span 精确提取选中区域的矩形（纯 Range 版本）。
 * 遍历 textLayer 每个 <span>，对完全选中的 span 直接取 getBoundingClientRect()，
 * 对部分选中的首尾 span 创建子范围取 rect，避免跨 span 碎片化/重叠问题。
 * @param {Range} range - 选区 Range
 * @param {Element} textLayer - 文本层 DOM 节点
 * @param {DOMRect} containerRect - 页面容器的 bounding rect
 */
function getSelectedSpanRects(range, textLayer, containerRect) {
    const spans = textLayer.querySelectorAll('span');
    const rects = [];

    for (const span of spans) {
        // 跳过不与 Range 相交的 span
        try {
            if (!range.intersectsNode(span)) continue;
        } catch { continue; }

        const spanRect = span.getBoundingClientRect();
        if (spanRect.width < 0.5 || spanRect.height < 0.5) continue;

        // 判断是否完全选中：range 的 start 在 span 前面，end 在 span 后面
        const spanRange = document.createRange();
        spanRange.selectNodeContents(span);
        const startsBefore = range.compareBoundaryPoints(Range.START_TO_START, spanRange) <= 0;
        const endsAfter = range.compareBoundaryPoints(Range.END_TO_END, spanRange) >= 0;
        const fullySelected = startsBefore && endsAfter;

        if (fullySelected) {
            // 完整选中 — 直接用 span 的 boundingRect，绝对精确
            rects.push({
                left: spanRect.left - containerRect.left,
                top: spanRect.top - containerRect.top,
                width: spanRect.width,
                height: spanRect.height
            });
        } else {
            // 部分选中（选区的首 / 尾 span）— 创建裁剪后的子范围
            try {
                const subRange = document.createRange();
                subRange.selectNodeContents(span);

                // 裁剪起点：如果选区起点在此 span 内部，使用选区起点
                if (range.startContainer === span ||
                    span.contains(range.startContainer)) {
                    if (range.compareBoundaryPoints(Range.START_TO_START, subRange) > 0) {
                        subRange.setStart(range.startContainer, range.startOffset);
                    }
                }
                // 裁剪终点：如果选区终点在此 span 内部，使用选区终点
                if (range.endContainer === span ||
                    span.contains(range.endContainer)) {
                    if (range.compareBoundaryPoints(Range.END_TO_END, subRange) < 0) {
                        subRange.setEnd(range.endContainer, range.endOffset);
                    }
                }

                // 对单个 span 的子范围，getClientRects 只返回 1 个矩形
                const subRects = subRange.getClientRects();
                for (const r of subRects) {
                    if (r.width < 0.5 || r.height < 0.5) continue;
                    rects.push({
                        left: r.left - containerRect.left,
                        top: r.top - containerRect.top,
                        width: r.width,
                        height: spanRect.height  // 统一用 span 高度，避免行高抖动
                    });
                }
            } catch {
                // 容错：子范围创建失败时回退到整个 span
                rects.push({
                    left: spanRect.left - containerRect.left,
                    top: spanRect.top - containerRect.top,
                    width: spanRect.width,
                    height: spanRect.height
                });
            }
        }
    }

    return rects;
}

function getClosestTextSpan(node) {
    if (!node) return null;
    const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    if (!(element instanceof Element)) return null;
    const span = element.closest('span');
    if (!span) return null;
    if (!(span.parentElement instanceof Element) || !span.parentElement.classList.contains('textLayer')) return null;
    return span;
}

function getFirstTextNode(element) {
    if (!element) return null;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    return walker.nextNode();
}

function getLastTextNode(element) {
    if (!element) return null;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let last = null;
    while (walker.nextNode()) {
        last = walker.currentNode;
    }
    return last;
}

function getMedian(values) {
    if (!values || values.length === 0) return 0;
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
    return sorted[mid];
}


/**
 * 从屏幕坐标 (x,y) 获取 textLayer 内的 caret 位置。
 * 返回 { node, offset, span } 或 null（命中非 textLayer 区域时）。
 */
function caretFromPoint(x, y) {
    let caretRange;
    if (document.caretRangeFromPoint) {
        caretRange = document.caretRangeFromPoint(x, y);
    } else if (document.caretPositionFromPoint) {
        const pos = document.caretPositionFromPoint(x, y);
        if (pos) {
            caretRange = document.createRange();
            caretRange.setStart(pos.offsetNode, pos.offset);
            caretRange.collapse(true);
        }
    }
    if (!caretRange) return null;

    const node = caretRange.startContainer;
    const offset = caretRange.startOffset;
    const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    const span = el?.closest?.('.textLayer > span');
    if (!span) return null;

    return { node, offset, span };
}

/**
 * 从锚点  终点构建 Range，自动处理前后顺序。
 * anchorNode/anchorOffset 是 mousedown 时记录的锚点，
 * extentNode/extentOffset 是实时鼠标对应的 caret 位置。
 */
function buildManualRange(anchorNode, anchorOffset, extentNode, extentOffset) {
    if (!anchorNode || !extentNode) return null;
    const range = document.createRange();
    try {
        // 暂时以 anchorextent 方向设置
        range.setStart(anchorNode, anchorOffset);
        range.setEnd(extentNode, extentOffset);
    } catch {
        return null;
    }

    // 如果 collapsed，说明 extent 在 anchor 前面，交换
    if (range.collapsed) {
        try {
            range.setStart(extentNode, extentOffset);
            range.setEnd(anchorNode, anchorOffset);
        } catch {
            return null;
        }
    }
    if (range.collapsed) return null;
    return range;
}

/**
 * 渲染手动选区覆盖层  从 state.manualSel.range 读取 Range，
 * 复用 getSelectedSpanRects + mergeHighlightRects 绘制 .sel-rect。
 */
function renderManualSelection() {
    clearSelectionOverlay();

    const range = state.manualSel.range;
    if (!range || range.collapsed) return;

    document.querySelectorAll('.page-container').forEach(pageContainer => {
        const textLayer = pageContainer.querySelector('.textLayer');
        if (!textLayer) return;
        try {
            if (!range.intersectsNode(textLayer)) return;
        } catch { return; }

        const selLayer = pageContainer.querySelector('.selection-layer');
        if (!selLayer) return;

        const containerRect = pageContainer.getBoundingClientRect();
        const rawRects = getSelectedSpanRects(range, textLayer, containerRect);
        const merged = mergeHighlightRects(rawRects);

        const frag = document.createDocumentFragment();
        for (const rect of merged) {
            const div = document.createElement('div');
            div.className = 'sel-rect';
            div.style.left = rect.left + 'px';
            div.style.top = rect.top + 'px';
            div.style.width = rect.width + 'px';
            div.style.height = rect.height + 'px';
            frag.appendChild(div);
        }
        selLayer.appendChild(frag);
    });
}

function clearSelectionOverlay() {
    document.querySelectorAll('.selection-layer').forEach(layer => {
        if (layer.childNodes.length) layer.innerHTML = '';
    });
}

/**
 * 将手动构建的 Range 同步到浏览器原生 Selection，
 * 供 Ctrl+C 复制和翻译/批注消费。
 */
function commitManualSelection() {
    const range = state.manualSel.range;
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    if (range && !range.collapsed) {
        sel.addRange(range.cloneRange());
    }
}

/**
 * 合并高亮矩形：按行分组，同一行内水平合并相邻矩形，
 * 输出每行一个干净的矩形条带。
 */
function mergeHighlightRects(rects) {
    if (!rects || rects.length === 0) return [];

    const sorted = rects.slice().sort((a, b) => a.top - b.top || a.left - b.left);

    // 按行分组（top 差距 < 行高 50% 视为同行）
    const lines = [];
    let currentLine = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
        const ref = currentLine[0];
        const cur = sorted[i];
        const lineH = Math.max(ref.height, cur.height);
        if (Math.abs(cur.top - ref.top) < lineH * 0.5) {
            currentLine.push(cur);
        } else {
            lines.push(currentLine);
            currentLine = [cur];
        }
    }
    lines.push(currentLine);

    // 每行内合并
    const merged = [];
    for (const line of lines) {
        line.sort((a, b) => a.left - b.left);

        let lineTop = Infinity, lineBottom = -Infinity;
        for (const r of line) {
            lineTop = Math.min(lineTop, r.top);
            lineBottom = Math.max(lineBottom, r.top + r.height);
        }
        const lineHeight = lineBottom - lineTop;

        let mLeft = line[0].left;
        let mRight = line[0].left + line[0].width;

        for (let i = 1; i < line.length; i++) {
            const r = line[i];
            const rRight = r.left + r.width;
            // 间距 ≤ 2px 合并（PDF span 之间可能有微小间隙）
            if (r.left <= mRight + 2) {
                mRight = Math.max(mRight, rRight);
            } else {
                merged.push({ left: mLeft, top: lineTop, width: mRight - mLeft, height: lineHeight });
                mLeft = r.left;
                mRight = rRight;
            }
        }
        merged.push({ left: mLeft, top: lineTop, width: mRight - mLeft, height: lineHeight });
    }

    return merged;
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
        div.style.pointerEvents = 'auto';
        div.dataset.annoId = cmd.id;
        if (annotationSelection.selectedIds.has(cmd.id) || (annotationSelection.cmdId && annotationSelection.cmdId === cmd.id)) {
            div.classList.add('selected');
        }
        div.addEventListener('click', (e) => {
            e.stopPropagation();
            selectAnnotation(cmd, { additive: e.ctrlKey || e.metaKey });
        });
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

    // Selection Layer — 自定义选区覆盖层，替代原生 ::selection 避免重叠
    const selectionLayer = document.createElement('div');
    selectionLayer.className = 'selection-layer';
    pageContainer.appendChild(selectionLayer);

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
            if (cmd.points.length === 1) {
                const p = cmd.points[0];
                ctx.moveTo(p.x, p.y);
                ctx.lineTo(p.x + 0.1, p.y + 0.1);
            } else if (cmd.points.length === 2) {
                ctx.moveTo(cmd.points[0].x, cmd.points[0].y);
                ctx.lineTo(cmd.points[1].x, cmd.points[1].y);
            } else {
                ctx.moveTo(cmd.points[0].x, cmd.points[0].y);
                for (let i = 1; i < cmd.points.length - 1; i++) {
                    const cp = cmd.points[i];
                    const np = cmd.points[i + 1];
                    const mx = (cp.x + np.x) / 2;
                    const my = (cp.y + np.y) / 2;
                    ctx.quadraticCurveTo(cp.x, cp.y, mx, my);
                }
                const p1 = cmd.points[cmd.points.length - 2];
                const p2 = cmd.points[cmd.points.length - 1];
                ctx.quadraticCurveTo(p1.x, p1.y, p2.x, p2.y);
            }
        }
        ctx.stroke();
    }
    else if (cmd.type === 'text') {
        const weight = cmd.weight || 'normal';
        const style = cmd.style || 'normal';
        ctx.font = `${style} ${weight} ${cmd.size}px system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`;
        ctx.fillStyle = cmd.color;
        // Text always resets mode to source-over unless explicitly needed
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = (cmd.alpha !== undefined) ? cmd.alpha : 1.0;
        ctx.textBaseline = 'top';
        ctx.fillText(cmd.text, cmd.x, cmd.y);
        const metrics = ctx.measureText(cmd.text || '');
        drawTextDecorations(ctx, cmd, metrics);

        if (annotationSelection.selectedIds.has(cmd.id) || (annotationSelection.cmdId && cmd.id === annotationSelection.cmdId)) {
            ctx.strokeStyle = 'rgba(59,130,246,0.85)';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(cmd.x - 2, cmd.y - 1, metrics.width + 4, (cmd.size || 14) + 4);
        }
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
        ctx.font = `${style} ${weight} ${cmd.size}px system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`;
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
        e.preventDefault();
        const pos = getPos(e);
        if (state.activeTool === 'toolText') {
            const hit = hitTestText(pos, pageNum, ctx);
            if (hit) {
                selectAnnotation(hit.cmd, { additive: e.ctrlKey || e.metaKey });
                if (e.shiftKey) {
                    drawingState.isDraggingText = true;
                    drawingState.draggingCmd = hit.cmd;
                    drawingState.dragStartPos = pos;
                    drawingState.dragOrigin = { x: hit.cmd.x, y: hit.cmd.y };
                    return;
                }
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
        e.preventDefault();
        if (drawingState.isDraggingText && drawingState.draggingCmd) {
            const pos = getPos(e);
            const dx = pos.x - drawingState.dragStartPos.x;
            const dy = pos.y - drawingState.dragStartPos.y;
            drawingState.draggingCmd.x = drawingState.dragOrigin.x + dx;
            drawingState.draggingCmd.y = drawingState.dragOrigin.y + dy;
            drawingState.draggingCmd.updatedAt = Date.now();
            redrawLayer(pageNum);
            return;
        }
        if (!drawingState.isDrawing) return;
        const pos = getPos(e);
        currentPathPoints.push(pos);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
    };

    const stopDraw = () => {
        if (drawingState.isDraggingText) {
            drawingState.isDraggingText = false;
            drawingState.draggingCmd = null;
            drawingState.dragStartPos = null;
            drawingState.dragOrigin = null;
            scheduleAnnotationSave();
            return;
        }

        if (!drawingState.isDrawing) return;
        drawingState.isDrawing = false;
        ctx.closePath();

        const cmd = normalizeAnnotationCommand({
            type: state.activeTool === 'toolEraser' ? 'eraser' : 'path',
            page: pageNum,
            color: annoState.color,
            width: state.activeTool === 'toolEraser' ? annoState.width * 2 : annoState.width,
            alpha: annoState.alpha || 1.0,
            mode: annoState.mode || 'source-over',
            points: [...currentPathPoints]
        }, pageNum);

        getPageStore(pageNum).push(cmd);
        pushCommand(cmd);
        redrawLayer(pageNum);
    };

    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', startDraw);
    canvas.addEventListener('pointermove', draw);
    canvas.addEventListener('pointerup', stopDraw);
    canvas.addEventListener('pointerleave', stopDraw);
    canvas.addEventListener('pointercancel', stopDraw);
}

function setupContextStyle(ctx) {
    if (state.activeTool === 'toolEraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineWidth = annoState.width * 2;
    } else if (state.activeTool === 'toolHighlight') {
        ctx.globalCompositeOperation = 'multiply';
        ctx.strokeStyle = annoState.color;
        ctx.lineWidth = Math.max(6, (annoState.width || 2) * 4);
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
    input.style.textDecoration = existingCmd ? (existingCmd.decoration || 'none') : getTextDecorationValue(annoState);
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

            const cmd = normalizeAnnotationCommand({
                id: existingCmd ? existingCmd.id : undefined,
                type: 'text',
                page: pageNum,
                text: text,
                x: x,
                y: y,
                color: existingCmd ? existingCmd.color : annoState.color,
                size: existingCmd ? existingCmd.size : annoState.textSize,
                weight: existingCmd ? (existingCmd.weight || 'normal') : (annoState.fontWeight || 'normal'),
                style: existingCmd ? (existingCmd.style || 'normal') : (annoState.fontStyle || 'normal'),
                decoration: existingCmd ? (existingCmd.decoration || 'none') : getTextDecorationValue(annoState),
                alpha: existingCmd ? (existingCmd.alpha !== undefined ? existingCmd.alpha : 1.0) : annoState.alpha
            }, pageNum);

            getPageStore(pageNum).push(cmd);
            pushCommand(cmd);
            selectAnnotation(cmd);
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

function switchSidebarTab(tabName) {
    const tab = tabName || 'outline';
    state.activeTab = tab;

    const outlineView = elements.outlineView;
    const thumbnailsView = elements.thumbnailsView;
    const searchPanel = document.getElementById('searchPanel');

    if (outlineView) outlineView.classList.toggle('hidden', tab !== 'outline');
    if (thumbnailsView) thumbnailsView.classList.toggle('hidden', tab !== 'thumbnails');
    if (searchPanel) searchPanel.classList.toggle('hidden', tab !== 'search');

    const tabOutline = document.getElementById('tabOutline');
    const tabThumbnails = document.getElementById('tabThumbnails');
    const tabSearch = document.getElementById('tabSearch');

    tabOutline?.classList.toggle('active', tab === 'outline');
    tabThumbnails?.classList.toggle('active', tab === 'thumbnails');
    tabSearch?.classList.toggle('active', tab === 'search');

    if (!state.sidebarVisible) {
        state.sidebarVisible = true;
        elements.sidebar?.classList.remove('closed');
    }

    if (tab === 'thumbnails') {
        renderThumbnails().catch(e => console.warn('Thumbnails load failed:', e));
    }
}

function isShortcutHelpOpen() {
    return !!elements.shortcutHelp && !elements.shortcutHelp.classList.contains('hidden');
}

function openShortcutHelp() {
    if (!elements.shortcutHelp) return;
    elements.shortcutHelp.classList.remove('hidden');
}

function closeShortcutHelp() {
    if (!elements.shortcutHelp) return;
    elements.shortcutHelp.classList.add('hidden');
}

function updateIndexStatus(text) {
    if (!elements.indexStatus) return;
    elements.indexStatus.textContent = text;
}

function initTextIndexWorker() {
    if (state.indexWorker) return;
    try {
        const workerUrl = (typeof chrome !== 'undefined' && chrome.runtime?.getURL)
            ? chrome.runtime.getURL('src/pdf/web/text-index-worker.js')
            : 'text-index-worker.js';
        state.indexWorker = new Worker(workerUrl);
        state.indexBuildTotal = state.pdf?.numPages || 0;
        updateIndexStatus('索引:0%');

        state.indexWorker.onmessage = (event) => {
            const { type, data } = event.data || {};
            if (type === 'INDEX_PROGRESS') {
                state.indexBuildDone = Number(data?.done || 0);
                const total = Math.max(1, Number(data?.total || state.indexBuildTotal || 1));
                const percent = Math.min(100, Math.round((state.indexBuildDone / total) * 100));
                updateIndexStatus(`索引:${percent}%`);
                return;
            }
            if (type === 'SEARCH_RESULT') {
                const requestId = Number(data?.requestId);
                const resolver = state.indexReqResolvers[requestId];
                if (resolver) {
                    delete state.indexReqResolvers[requestId];
                    resolver(data?.results || []);
                }
            }
        };

        state.indexWorker.postMessage({
            type: 'INIT',
            data: { totalPages: state.indexBuildTotal }
        });

        Object.keys(state.indexedPageItems).forEach(page => {
            const pageNum = Number(page);
            const items = state.indexedPageItems[pageNum];
            if (!Number.isFinite(pageNum) || !Array.isArray(items) || !items.length) return;
            state.indexWorker.postMessage({ type: 'INDEX_PAGE', data: { page: pageNum, items } });
        });
    } catch (e) {
        console.warn('索引 Worker 初始化失败，将回退主线程搜索:', e);
        state.indexWorker = null;
        updateIndexStatus('索引:降级');
    }
}

function enqueuePageForIndex(pageNum, textContent) {
    if (!state.indexWorker || !textContent || state.indexedPages.has(pageNum)) return;
    const items = (textContent.items || []).map(it => String(it?.str || ''));
    state.indexedPageItems[pageNum] = items;
    touchTextIndexPage(pageNum);
    pruneTextIndexCache();
    state.indexWorker.postMessage({
        type: 'INDEX_PAGE',
        data: { page: pageNum, items }
    });
    state.indexedPages.add(pageNum);
    scheduleTextIndexSave();
}

async function ensureIndexForRange(fromPage, toPage) {
    if (!state.indexWorker) return;
    for (let i = fromPage; i <= toPage; i++) {
        if (state.indexedPages.has(i)) {
            touchTextIndexPage(i);
            continue;
        }
        let textContent = state.textCache[i];
        if (!textContent) {
            try {
                const page = await state.pdf.getPage(i);
                textContent = await page.getTextContent();
                state.textCache[i] = textContent;
                if (typeof page.cleanup === 'function') page.cleanup();
            } catch {
                continue;
            }
        }
        enqueuePageForIndex(i, textContent);
    }
}

function searchWithIndexWorker(query, fromPage, toPage) {
    if (!state.indexWorker) return Promise.resolve(null);
    state.indexReqCounter += 1;
    const requestId = state.indexReqCounter;
    return new Promise((resolve) => {
        state.indexReqResolvers[requestId] = resolve;
        state.indexWorker.postMessage({
            type: 'SEARCH',
            data: { requestId, query, fromPage, toPage }
        });
    });
}

function exportAnnotations() {
    const payload = exportAnnotationsPayload();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(state.fileName || 'document').replace(/\.pdf$/i, '')}-annotations.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function rebuildUndoStackFromStore() {
    undoStack.length = 0;
    redoStack.length = 0;
    Object.keys(pageAnnotations).forEach(page => {
        const list = pageAnnotations[page] || [];
        list.forEach(cmd => undoStack.push(cmd));
    });
    updateHistoryButtons();
}

function importAnnotationsFromPayload(payload) {
    const source = payload?.annotations || payload;
    const normalized = normalizeAnnotationStore(source);
    Object.keys(pageAnnotations).forEach(k => delete pageAnnotations[k]);
    Object.keys(normalized).forEach(page => {
        pageAnnotations[page] = normalized[page];
    });
    rebuildUndoStackFromStore();
    selectAnnotation(null);
    for (let i = 1; i <= state.pdf.numPages; i++) redrawLayer(i);
    scheduleAnnotationSave();
    updateAnnotationSelectionUI();
}

function deleteSelectedAnnotation() {
    const ids = getSelectedAnnotationIds();
    if (!ids.size) {
        const single = getSelectedAnnotation();
        if (single?.id) ids.add(single.id);
    }
    if (!ids.size) return 0;

    Object.keys(pageAnnotations).forEach((page) => {
        const store = getPageStore(Number(page));
        pageAnnotations[page] = store.filter(cmd => !ids.has(cmd.id));
        redrawLayer(Number(page));
    });

    for (let i = undoStack.length - 1; i >= 0; i--) {
        if (ids.has(undoStack[i].id)) undoStack.splice(i, 1);
    }
    for (let i = redoStack.length - 1; i >= 0; i--) {
        if (ids.has(redoStack[i].id)) redoStack.splice(i, 1);
    }

    selectAnnotation(null);
    scheduleAnnotationSave();
    updateHistoryButtons();
    updateAnnotationSelectionUI();
    return ids.size;
}

function applyStyleToSelectedAnnotation() {
    const selectedList = getSelectedAnnotations();
    if (!selectedList.length) {
        const selected = getSelectedAnnotation();
        if (selected) selectedList.push(selected);
    }
    if (!selectedList.length) return 0;

    const touchedPages = new Set();
    selectedList.forEach((selected) => {
        selected.updatedAt = Date.now();
        if (selected.type === 'text') {
            selected.color = annoState.color;
            selected.size = annoState.textSize;
            selected.weight = annoState.fontWeight;
            selected.style = annoState.fontStyle;
            selected.decoration = getTextDecorationValue(annoState);
            selected.alpha = annoState.alpha;
        } else if (selected.type === 'highlight') {
            selected.color = annoState.color;
            selected.alpha = annoState.alpha;
        } else {
            selected.color = annoState.color;
            selected.width = selected.type === 'eraser' ? (annoState.width * 2) : annoState.width;
            selected.alpha = annoState.alpha;
            selected.mode = selected.type === 'eraser' ? 'destination-out' : 'source-over';
        }
        touchedPages.add(selected.page);
    });

    touchedPages.forEach(page => redrawLayer(page));
    scheduleAnnotationSave();
    return selectedList.length;
}

function updateSelectedTextAnnotationSize(delta) {
    const selected = getSelectedAnnotation();
    if (!selected || selected.type !== 'text') return false;
    const prev = Number(selected.size || 14);
    const next = Math.min(96, Math.max(8, prev + delta));
    if (next === prev) return false;
    selected.size = next;
    selected.updatedAt = Date.now();
    redrawLayer(selected.page);
    scheduleAnnotationSave();
    return true;
}

function findAnnotationById(id) {
    if (!id) return null;
    const pages = Object.keys(pageAnnotations);
    for (let i = 0; i < pages.length; i++) {
        const page = Number(pages[i]);
        const store = getPageStore(page);
        const found = store.find(cmd => cmd.id === id);
        if (found) return found;
    }
    return null;
}

function getPagesByAnnotationIds(ids) {
    const pages = new Set();
    if (!ids || !ids.size) return pages;
    Object.keys(pageAnnotations).forEach((page) => {
        const pageNum = Number(page);
        const store = getPageStore(pageNum);
        if (store.some(cmd => ids.has(cmd.id))) {
            pages.add(pageNum);
        }
    });
    return pages;
}

function getAnnotationBounds(cmd) {
    if (!cmd || !cmd.type) return null;
    if (cmd.type === 'highlight' && Array.isArray(cmd.rects) && cmd.rects.length) {
        const left = Math.min(...cmd.rects.map(r => Number(r.left || 0)));
        const top = Math.min(...cmd.rects.map(r => Number(r.top || 0)));
        const right = Math.max(...cmd.rects.map(r => Number(r.left || 0) + Number(r.width || 0)));
        const bottom = Math.max(...cmd.rects.map(r => Number(r.top || 0) + Number(r.height || 0)));
        return { left, top, right, bottom };
    }

    if ((cmd.type === 'path' || cmd.type === 'eraser') && Array.isArray(cmd.points) && cmd.points.length) {
        const minX = Math.min(...cmd.points.map(p => Number(p.x || 0)));
        const minY = Math.min(...cmd.points.map(p => Number(p.y || 0)));
        const maxX = Math.max(...cmd.points.map(p => Number(p.x || 0)));
        const maxY = Math.max(...cmd.points.map(p => Number(p.y || 0)));
        const pad = Math.max(2, Number(cmd.width || 2) / 2 + 2);
        return {
            left: minX - pad,
            top: minY - pad,
            right: maxX + pad,
            bottom: maxY + pad
        };
    }

    if (cmd.type === 'text') {
        const size = Math.max(8, Number(cmd.size || 14));
        const text = String(cmd.text || '');
        const width = Math.max(8, text.length * size * 0.56 + 6);
        return {
            left: Number(cmd.x || 0) - 2,
            top: Number(cmd.y || 0) - 2,
            right: Number(cmd.x || 0) + width + 2,
            bottom: Number(cmd.y || 0) + size + 4
        };
    }

    return null;
}

function isRectIntersect(a, b) {
    if (!a || !b) return false;
    return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
}

function updateLassoBoxVisual() {
    if (!drawingState.lassoBoxEl || !drawingState.lassoStart || !drawingState.lassoCurrent) return;
    const left = Math.min(drawingState.lassoStart.x, drawingState.lassoCurrent.x);
    const top = Math.min(drawingState.lassoStart.y, drawingState.lassoCurrent.y);
    const width = Math.abs(drawingState.lassoStart.x - drawingState.lassoCurrent.x);
    const height = Math.abs(drawingState.lassoStart.y - drawingState.lassoCurrent.y);
    drawingState.lassoBoxEl.style.left = `${left}px`;
    drawingState.lassoBoxEl.style.top = `${top}px`;
    drawingState.lassoBoxEl.style.width = `${width}px`;
    drawingState.lassoBoxEl.style.height = `${height}px`;
}

function cancelLassoSelection() {
    if (!drawingState.isLassoSelecting) return;
    const pageEl = document.getElementById(`page-${drawingState.lassoPage}`);
    pageEl?.classList.remove('lassoing');
    drawingState.lassoBoxEl?.remove();
    drawingState.isLassoSelecting = false;
    drawingState.lassoBoxEl = null;
    drawingState.lassoPage = null;
    drawingState.lassoStart = null;
    drawingState.lassoCurrent = null;
    drawingState.lassoPageRect = null;
    drawingState.lassoPointerId = null;
    drawingState.lassoAdditive = false;
}

function commitLassoSelection() {
    if (!drawingState.isLassoSelecting || !drawingState.lassoStart || !drawingState.lassoCurrent || !drawingState.lassoPage) {
        cancelLassoSelection();
        return;
    }

    const pageEl = document.getElementById(`page-${drawingState.lassoPage}`);
    if (!pageEl) {
        cancelLassoSelection();
        return;
    }

    const left = Math.min(drawingState.lassoStart.x, drawingState.lassoCurrent.x);
    const top = Math.min(drawingState.lassoStart.y, drawingState.lassoCurrent.y);
    const right = Math.max(drawingState.lassoStart.x, drawingState.lassoCurrent.x);
    const bottom = Math.max(drawingState.lassoStart.y, drawingState.lassoCurrent.y);

    const minSize = 4;
    if ((right - left) < minSize || (bottom - top) < minSize) {
        cancelLassoSelection();
        return;
    }

    const lassoRectPage = { left, top, right, bottom };
    const store = getPageStore(drawingState.lassoPage);
    const hitIds = new Set();
    store.forEach((cmd) => {
        const bound = getAnnotationBounds(cmd);
        if (bound && isRectIntersect(bound, lassoRectPage)) {
            hitIds.add(cmd.id);
        }
    });

    const prevIds = new Set(getSelectedAnnotationIds());
    const nextIds = drawingState.lassoAdditive ? new Set(prevIds) : new Set();
    hitIds.forEach(id => nextIds.add(id));

    applyAnnotationSelectionByIds(nextIds, drawingState.lassoPage);

    cancelLassoSelection();
}

function updateExportBoxVisual() {
    if (!drawingState.exportBoxEl || !drawingState.exportStart || !drawingState.exportCurrent) return;
    const left = Math.min(drawingState.exportStart.x, drawingState.exportCurrent.x);
    const top = Math.min(drawingState.exportStart.y, drawingState.exportCurrent.y);
    const width = Math.abs(drawingState.exportStart.x - drawingState.exportCurrent.x);
    const height = Math.abs(drawingState.exportStart.y - drawingState.exportCurrent.y);
    drawingState.exportBoxEl.style.left = `${left}px`;
    drawingState.exportBoxEl.style.top = `${top}px`;
    drawingState.exportBoxEl.style.width = `${width}px`;
    drawingState.exportBoxEl.style.height = `${height}px`;
}

function cancelExportSelection() {
    if (!drawingState.isExportSelecting) return;
    const pageEl = document.getElementById(`page-${drawingState.exportPage}`);
    pageEl?.classList.remove('lassoing');
    drawingState.exportBoxEl?.remove();
    drawingState.isExportSelecting = false;
    drawingState.exportBoxEl = null;
    drawingState.exportPage = null;
    drawingState.exportStart = null;
    drawingState.exportCurrent = null;
    drawingState.exportPointerId = null;
}

async function commitExportSelection() {
    if (!drawingState.isExportSelecting || !drawingState.exportStart || !drawingState.exportCurrent || !drawingState.exportPage) {
        cancelExportSelection();
        return;
    }

    const pageNum = drawingState.exportPage;
    const pageEl = document.getElementById(`page-${pageNum}`);
    if (!pageEl) {
        cancelExportSelection();
        return;
    }

    const left = Math.min(drawingState.exportStart.x, drawingState.exportCurrent.x);
    const top = Math.min(drawingState.exportStart.y, drawingState.exportCurrent.y);
    const right = Math.max(drawingState.exportStart.x, drawingState.exportCurrent.x);
    const bottom = Math.max(drawingState.exportStart.y, drawingState.exportCurrent.y);
    cancelExportSelection();

    const minSize = 8;
    if ((right - left) < minSize || (bottom - top) < minSize) {
        showAnnoActionToast('框选区域过小，请重试', 'warning');
        return;
    }

    const pageRect = pageEl.getBoundingClientRect();
    const pageW = Math.max(1, pageRect.width);
    const pageH = Math.max(1, pageRect.height);

    const nx1 = Math.min(1, Math.max(0, left / pageW));
    const ny1 = Math.min(1, Math.max(0, top / pageH));
    const nx2 = Math.min(1, Math.max(0, right / pageW));
    const ny2 = Math.min(1, Math.max(0, bottom / pageH));

    const sourceCanvas = await renderPageCanvasForExport(pageNum, 2.5);
    if (!sourceCanvas) {
        showAnnoActionToast('导出失败：页面渲染异常', 'warning');
        return;
    }

    const srcX = Math.max(0, Math.floor(nx1 * sourceCanvas.width));
    const srcY = Math.max(0, Math.floor(ny1 * sourceCanvas.height));
    const srcW = Math.min(sourceCanvas.width - srcX, Math.max(1, Math.floor((nx2 - nx1) * sourceCanvas.width)));
    const srcH = Math.min(sourceCanvas.height - srcY, Math.max(1, Math.floor((ny2 - ny1) * sourceCanvas.height)));

    if (srcW < 2 || srcH < 2) {
        showAnnoActionToast('框选区域无有效内容', 'warning');
        return;
    }

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = srcW;
    exportCanvas.height = srcH;
    const exportCtx = exportCanvas.getContext('2d');
    if (!exportCtx) {
        showAnnoActionToast('导出失败：无法创建画布', 'warning');
        return;
    }
    exportCtx.drawImage(sourceCanvas, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);

    const blob = await new Promise((resolve) => exportCanvas.toBlob(resolve, 'image/png'));
    if (!blob) {
        showAnnoActionToast('导出失败：图片生成异常', 'warning');
        return;
    }

    const fileName = buildExportImageFileName({
        page: pageNum,
        kind: 'region',
        width: srcW,
        height: srcH,
        extra: Date.now()
    });
    downloadBlobFile(blob, fileName);
    showAnnoActionToast('手动框选导出成功');
}

// --- EVENTS ---

function setupEvents() {
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

    setupSearchEvents();

    const updateSelectingState = () => {
        if (state.manualSel.active) {
            state.isSelectingText = true;
            return;
        }
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
            state.isSelectingText = false;
            if (state.pendingZoomValue !== null && state.pendingZoomValue !== undefined) {
                const pending = state.pendingZoomValue;
                state.pendingZoomValue = null;
                updateZoom(pending);
            }
            return;
        }

        const anchorNode = sel.anchorNode;
        const focusNode = sel.focusNode;
        const anchorEl = anchorNode?.nodeType === Node.TEXT_NODE ? anchorNode.parentElement : anchorNode;
        const focusEl = focusNode?.nodeType === Node.TEXT_NODE ? focusNode.parentElement : focusNode;
        const insideTextLayer = !!(anchorEl?.closest?.('.textLayer') || focusEl?.closest?.('.textLayer'));
        state.isSelectingText = insideTextLayer;
    };

    document.addEventListener('selectionchange', updateSelectingState);
    document.addEventListener('mouseup', () => setTimeout(updateSelectingState, 0));

    // ===== 手动选区系统 =====
    // 核心思路：拖选期间完全阻止浏览器原生选区，用 caretRangeFromPoint 自行计算选区，
    // 只在 mouseup 时设置原生 Selection 供 Ctrl+C/翻译/批注消费。
    let selectionRafId = null;

    /**
     * 原生选区 → 覆盖层渲染（仅用于双击选词、三击选行等非拖选场景）。
     */
    function renderSelectionOverlay() {
        selectionRafId = null;
        document.querySelectorAll('.selection-layer').forEach(layer => {
            if (layer.childNodes.length) layer.innerHTML = '';
        });

        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || !selection.rangeCount) return;

        const range = selection.getRangeAt(0);

        document.querySelectorAll('.page-container').forEach(pageContainer => {
            const textLayer = pageContainer.querySelector('.textLayer');
            if (!textLayer) return;
            try {
                if (!range.intersectsNode(textLayer)) return;
            } catch { return; }

            const selLayer = pageContainer.querySelector('.selection-layer');
            if (!selLayer) return;

            const containerRect = pageContainer.getBoundingClientRect();
            const rawRects = getSelectedSpanRects(range, textLayer, containerRect);
            const merged = mergeHighlightRects(rawRects);

            const frag = document.createDocumentFragment();
            for (const rect of merged) {
                const div = document.createElement('div');
                div.className = 'sel-rect';
                div.style.left = rect.left + 'px';
                div.style.top = rect.top + 'px';
                div.style.width = rect.width + 'px';
                div.style.height = rect.height + 'px';
                frag.appendChild(div);
            }
            selLayer.appendChild(frag);
        });
    }

    /**
     * selectionchange 入口 — 仅在非手动拖选时触发覆盖层渲染
     * （双击选词、三击选行、Ctrl+A 等浏览器原生选区行为）。
     */
    function scheduleSelectionRender() {
        // 手动拖选期间，由 pointermove 调用 renderManualSelection()，不走此路径
        if (state.manualSel.active) return;

        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
            clearSelectionOverlay();
            return;
        }

        if (selectionRafId) return;
        selectionRafId = requestAnimationFrame(renderSelectionOverlay);
    }

    document.addEventListener('selectionchange', scheduleSelectionRender);

    elements.container?.addEventListener('pointerdown', (e) => {
        if (!state.manualRegionExportArmed) return;
        if (e.button !== 0) return;
        const pageEl = e.target?.closest?.('.page-container');
        if (!pageEl) return;
        if (drawingState.isDrawing || drawingState.isDraggingText || drawingState.isLassoSelecting) return;

        const pageNum = Number(pageEl.dataset.pageNumber || 0);
        if (!pageNum) return;

        const rect = pageEl.getBoundingClientRect();
        drawingState.isExportSelecting = true;
        drawingState.exportPage = pageNum;
        drawingState.exportPointerId = e.pointerId;
        drawingState.exportStart = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        drawingState.exportCurrent = { x: e.clientX - rect.left, y: e.clientY - rect.top };

        const box = document.createElement('div');
        box.className = 'anno-lasso-box';
        drawingState.exportBoxEl = box;
        pageEl.appendChild(box);
        pageEl.classList.add('lassoing');
        updateExportBoxVisual();

        try { elements.container.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
        e.preventDefault();
        e.stopPropagation();
    }, { passive: false });

    elements.container?.addEventListener('pointermove', (e) => {
        if (!drawingState.isExportSelecting) return;
        if (drawingState.exportPointerId !== null && e.pointerId !== drawingState.exportPointerId) return;
        const pageEl = document.getElementById(`page-${drawingState.exportPage}`);
        const rect = pageEl?.getBoundingClientRect();
        if (!rect) return;
        drawingState.exportCurrent = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        updateExportBoxVisual();
        e.preventDefault();
    }, { passive: false });

    elements.container?.addEventListener('pointerup', (e) => {
        if (!drawingState.isExportSelecting) return;
        if (drawingState.exportPointerId !== null && e.pointerId !== drawingState.exportPointerId) return;
        state.manualRegionExportArmed = false;
        commitExportSelection().catch((err) => {
            console.warn('手动框选导出失败:', err);
            showAnnoActionToast('手动框选导出失败', 'warning');
        });
        try { elements.container.releasePointerCapture?.(e.pointerId); } catch { /* ignore */ }
        e.preventDefault();
    }, { passive: false });

    // ── 手动选区：pointerdown → 记录锚点 / 空白区域取消选区 ──
    elements.container?.addEventListener('pointerdown', (e) => {
        if (state.manualRegionExportArmed || drawingState.isExportSelecting) return;
        // 只接管左键、非 Ctrl（Ctrl 是框选批注）
        if (e.button !== 0 || e.ctrlKey || e.metaKey) return;

        // 检查目标是否在 textLayer 内
        const target = e.target;
        if (!(target instanceof Element)) return;
        const textLayer = target.closest('.textLayer');

        // 点击空白区域（非 textLayer / 非 UI 控件）→ 清除选区
        if (!textLayer) {
            const isUI = target.closest('#sidebar, .top-bar, .floating-panel, .toolbar-options, .zoom-menu, .popover, [contenteditable]');
            if (!isUI) {
                window.getSelection()?.removeAllRanges();
                state.manualSel.range = null;
                clearSelectionOverlay();
            }
            return;
        }

        // 批注工具模式不接管
        if (state.activeTool && ['toolDraw', 'toolText', 'toolEraser'].includes(state.activeTool)) return;

        const caret = caretFromPoint(e.clientX, e.clientY);
        if (!caret) {
            window.getSelection()?.removeAllRanges();
            state.manualSel.range = null;
            clearSelectionOverlay();
            return;
        }

        // 记录锚点
        state.manualSel.active = true;
        state.manualSel.anchorNode = caret.node;
        state.manualSel.anchorOffset = caret.offset;
        state.manualSel.range = null;
        state.manualSel.startPage = Number(textLayer.closest('.page-container')?.dataset?.pageNumber || 0);
        state.isSelectingText = true;

        // 清除之前的原生选区
        window.getSelection()?.removeAllRanges();
    }, { passive: true });

    // ── 手动选区：selectstart 拦截 ──
    // 拖选期间阻止浏览器自行创建选区（根源上消除跳跃）
    document.addEventListener('selectstart', (e) => {
        if (state.manualSel.active || drawingState.isExportSelecting) {
            e.preventDefault();
        }
    });

    // ── 手动选区：pointermove → 构建 Range + 渲染 ──
    document.addEventListener('pointermove', (e) => {
        if (!state.manualSel.active) return;
        if ((e.buttons & 1) !== 1) return;

        const caret = caretFromPoint(e.clientX, e.clientY);
        if (!caret) return;

        const range = buildManualRange(
            state.manualSel.anchorNode,
            state.manualSel.anchorOffset,
            caret.node,
            caret.offset
        );

        if (range) {
            state.manualSel.range = range;
            renderManualSelection();
        }
    }, { passive: true });

    // ── 手动选区：pointerup → 提交到原生 Selection ──
    document.addEventListener('pointerup', (e) => {
        if (!state.manualSel.active) return;

        // 最终一次 caretFromPoint 确保选区精确到 mouseup 位置
        const caret = caretFromPoint(e.clientX, e.clientY);
        if (caret) {
            const range = buildManualRange(
                state.manualSel.anchorNode,
                state.manualSel.anchorOffset,
                caret.node,
                caret.offset
            );
            if (range) {
                state.manualSel.range = range;
                renderManualSelection();
            }
        }

        // 将选区同步到原生 Selection（供 Ctrl+C / 翻译 / 批注使用）
        commitManualSelection();

        state.manualSel.active = false;
        // 延迟重新检查 isSelectingText
        setTimeout(updateSelectingState, 0);
    }, { passive: true });

    elements.container?.addEventListener('pointerdown', (e) => {
        if (state.manualRegionExportArmed || drawingState.isExportSelecting) return;
        if (!(e.ctrlKey || e.metaKey)) return;
        if (e.button !== 0) return;
        const pageEl = e.target?.closest?.('.page-container');
        if (!pageEl) return;
        if (drawingState.isDrawing || drawingState.isDraggingText) return;

        const pageNum = Number(pageEl.dataset.pageNumber || 0);
        if (!pageNum) return;

        const rect = pageEl.getBoundingClientRect();
        drawingState.isLassoSelecting = true;
        drawingState.lassoPage = pageNum;
        drawingState.lassoPointerId = e.pointerId;
        drawingState.lassoCurrent = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        drawingState.lassoStart = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        drawingState.lassoPageRect = rect;
        drawingState.lassoAdditive = !!e.shiftKey;

        const box = document.createElement('div');
        box.className = 'anno-lasso-box';
        drawingState.lassoBoxEl = box;
        pageEl.appendChild(box);
        pageEl.classList.add('lassoing');

        updateLassoBoxVisual();
        try { elements.container.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
        e.preventDefault();
        e.stopPropagation();
    }, { passive: false });

    elements.container?.addEventListener('pointermove', (e) => {
        if (!drawingState.isLassoSelecting) return;
        if (drawingState.lassoPointerId !== null && e.pointerId !== drawingState.lassoPointerId) return;
        const pageEl = document.getElementById(`page-${drawingState.lassoPage}`);
        const rect = pageEl?.getBoundingClientRect();
        if (!rect) return;
        drawingState.lassoCurrent = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        updateLassoBoxVisual();
        e.preventDefault();
    }, { passive: false });

    elements.container?.addEventListener('pointerup', (e) => {
        if (!drawingState.isLassoSelecting) return;
        if (drawingState.lassoPointerId !== null && e.pointerId !== drawingState.lassoPointerId) return;
        commitLassoSelection();
        try { elements.container.releasePointerCapture?.(e.pointerId); } catch { /* ignore */ }
        e.preventDefault();
    }, { passive: false });

    elements.container?.addEventListener('pointercancel', () => {
        cancelLassoSelection();
        cancelExportSelection();
    });

    // Sidebar Toggle
    const sidebarToggle = document.getElementById('sidebarToggle');
    if (sidebarToggle) {
        sidebarToggle.onclick = () => {
            state.sidebarVisible = !state.sidebarVisible;
            elements.sidebar.classList.toggle('closed', !state.sidebarVisible);
        };
    }

    elements.shortcutHelpClose?.addEventListener('click', closeShortcutHelp);
    elements.shortcutHelp?.addEventListener('click', (e) => {
        if (e.target === elements.shortcutHelp) {
            closeShortcutHelp();
        }
    });

    window.addEventListener('wheel', (e) => {
        if (e.ctrlKey) {
            e.preventDefault();
            const direction = e.deltaY < 0 ? 1 : -1;
            updateZoom(state.zoom + (direction * 0.1));
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

    function updateToolbarOptionsPosition() {
        if (!toolbarOptions || !toolbarOptions.classList.contains('visible')) return;
        
        const activeToolBtn = document.querySelector('.btn-tool.active');
        if (activeToolBtn) {
            const rect = activeToolBtn.getBoundingClientRect();
            toolbarOptions.style.top = `${rect.top}px`;
        }
    }

    // Add text selection listener for highlighting
    document.addEventListener('mouseup', handleTextSelection);

    // Add separate text selection listener for translation
    document.addEventListener('mouseup', handleTranslationSelection);

    async function handleTextSelection(e) {
        if (state.activeTool !== 'toolHighlight') return;

        const selection = window.getSelection();
        if (selection.isCollapsed || !selection.rangeCount) return;

        const range = selection.getRangeAt(0);
        // commonAncestorContainer may be an Element (multi-span) or Text node (single-span)
        const ancestor = range.commonAncestorContainer;
        const textLayer = ancestor.nodeType === Node.ELEMENT_NODE
            ? ancestor.closest('.textLayer')
            : ancestor.parentElement?.closest('.textLayer');
        if (!textLayer) return;

        const pageContainer = textLayer.closest('.page-container');
        const pageNum = parseInt(pageContainer.dataset.pageNumber);
        const containerRect = pageContainer.getBoundingClientRect();

        // 逐 span 精确提取选中矩形（避免 getClientRects 跨 span 碎片化/重叠）
        const rawRects = getSelectedSpanRects(range, textLayer, containerRect);

        // 合并同行相邻矩形，输出干净的行级高亮
        const highlightRects = mergeHighlightRects(rawRects);

        if (highlightRects.length > 0) {
            const cmd = normalizeAnnotationCommand({
                type: 'highlight',
                page: pageNum,
                rects: highlightRects,
                color: annoState.color || '#ffeb3b',
                alpha: Number.isFinite(annoState.alpha) ? annoState.alpha : 0.4
            }, pageNum);
            getPageStore(pageNum).push(cmd);
            pushCommand(cmd);
            selectAnnotation(cmd);
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
        const ancestor = range.commonAncestorContainer;
        const textLayer = ancestor.nodeType === Node.ELEMENT_NODE
            ? ancestor.closest('.textLayer')
            : ancestor.parentElement?.closest('.textLayer');
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
                const isStream = (engine === 'deepseek' || engine === 'openai' || engine === 'multi');

                // Request translation via Task protocol
                if (typeof chrome !== 'undefined' && chrome.runtime) {
                    chrome.runtime.sendMessage({
                        type: 'REQUEST_TASK_TRANSLATE',
                        text: selectedText,
                        engine: engine,
                        targetLang: targetLang,
                        profile: 'academic',
                        context: '',
                        mode: 'translate',
                        stream: isStream
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
                updateToolbarOptionsPosition();

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
        if (widthSlider) {
            widthSlider.oninput = (e) => {
                annoState.width = parseInt(e.target.value);
                document.getElementById('strokeWidthVal').textContent = e.target.value + 'px';
            };
        }

        const sizeSlider = document.getElementById('textSize');
        if (sizeSlider) {
            sizeSlider.oninput = (e) => {
                annoState.textSize = parseInt(e.target.value);
                document.getElementById('textSizeVal').textContent = e.target.value + 'px';
            };
        }

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

        const btnUnderline = document.getElementById('btnUnderline');
        if (btnUnderline) {
            btnUnderline.onclick = () => {
                annoState.textUnderline = !annoState.textUnderline;
                btnUnderline.classList.toggle('active', annoState.textUnderline);
            };
        }

        const btnStrike = document.getElementById('btnStrike');
        if (btnStrike) {
            btnStrike.onclick = () => {
                annoState.textStrike = !annoState.textStrike;
                btnStrike.classList.toggle('active', annoState.textStrike);
            };
        }

        // Undo/Redo
        const btnUndo = document.getElementById('btnUndo');
        const btnRedo = document.getElementById('btnRedo');
        if (btnUndo) btnUndo.onclick = performUndo;
        if (btnRedo) btnRedo.onclick = performRedo;

        // Shortcuts - Global Document Listener
        document.addEventListener('keydown', (e) => {
            if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key === '?') {
                e.preventDefault();
                if (isShortcutHelpOpen()) closeShortcutHelp();
                else openShortcutHelp();
                return;
            }

            if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key === 'Escape') {
                closeAnnoFloatingPanels();
            }

            if (isShortcutHelpOpen() && e.key === 'Escape') {
                e.preventDefault();
                closeShortcutHelp();
                return;
            }

            if (e.key === 'Escape' && (state.manualRegionExportArmed || drawingState.isExportSelecting)) {
                e.preventDefault();
                state.manualRegionExportArmed = false;
                cancelExportSelection();
                showAnnoActionToast('已取消手动框选导出', 'warning');
                return;
            }

            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
                e.preventDefault();
                switchSidebarTab('search');
                elements.searchInput?.focus();
                elements.searchInput?.select();
                return;
            }

            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
                const changed = e.shiftKey ? invertSelectionOnCurrentPage() : selectAllAnnotationsOnCurrentPage();
                if (changed) {
                    e.preventDefault();
                    showAnnoActionToast(e.shiftKey ? '已反选当前页对象' : '已全选当前页对象');
                }
                return;
            }

            if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key === '/') {
                e.preventDefault();
                switchSidebarTab('search');
                elements.searchInput?.focus();
                elements.searchInput?.select();
                return;
            }

            if (e.key === 'F3' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g')) {
                e.preventDefault();
                if (state.searchResults.length === 0) return;
                if (e.shiftKey) goToPrevResult();
                else goToNextResult();
                return;
            }

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
                performRedo();
            } else if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
                if (updateSelectedTextAnnotationSize(1)) {
                    e.preventDefault();
                }
            } else if ((e.ctrlKey || e.metaKey) && e.key === '-') {
                if (updateSelectedTextAnnotationSize(-1)) {
                    e.preventDefault();
                }
            } else if (!e.ctrlKey && !e.metaKey && !e.altKey && state.searchResults.length > 0 && (e.key.toLowerCase() === 'j' || e.key.toLowerCase() === 'k')) {
                e.preventDefault();
                if (e.key.toLowerCase() === 'j') goToNextResult();
                else goToPrevResult();
            } else if (!e.ctrlKey && !e.metaKey && !e.altKey && state.searchResults.length > 0 && e.key === 'Enter') {
                e.preventDefault();
                if (state.searchIndex < 0) state.searchIndex = 0;
                jumpToSearchResult(state.searchIndex);
            } else if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key === 'Escape') {
                const searchPanel = document.getElementById('searchPanel');
                if (searchPanel && !searchPanel.classList.contains('hidden')) {
                    e.preventDefault();
                    if ((elements.searchInput?.value || '').trim()) {
                        elements.searchInput.value = '';
                        elements.searchInput.dispatchEvent(new Event('input', { bubbles: true }));
                    } else {
                        switchSidebarTab('outline');
                    }
                }
            } else if (e.key === 'F11') {
                e.preventDefault();
                toggleFullscreen();
            } else if (e.key === 'PageDown') {
                e.preventDefault();
                const next = Math.min(state.pdf.numPages, state.currentPage + 1);
                document.getElementById(`page-${next}`)?.scrollIntoView({ behavior: 'smooth' });
            } else if (e.key === 'PageUp') {
                e.preventDefault();
                const prev = Math.max(1, state.currentPage - 1);
                document.getElementById(`page-${prev}`)?.scrollIntoView({ behavior: 'smooth' });
            } else if (e.key === 'Home') {
                e.preventDefault();
                document.getElementById('page-1')?.scrollIntoView({ behavior: 'smooth' });
            } else if (e.key === 'End') {
                e.preventDefault();
                document.getElementById(`page-${state.pdf.numPages}`)?.scrollIntoView({ behavior: 'smooth' });
            }
        });
    }

    // Actions
    const btnSearchToggle = document.getElementById('btnSearchToggle');
    const searchPanel = document.getElementById('searchPanel');
    const searchClose = document.getElementById('searchClose');

    if (btnSearchToggle && searchPanel) {
        btnSearchToggle.onclick = () => {
            if (state.activeTab === 'search' && state.sidebarVisible) {
                switchSidebarTab('outline');
            } else {
                switchSidebarTab('search');
                elements.searchInput?.focus();
                elements.searchInput?.select();
            }
        };
    }

    if (searchClose && searchPanel) {
        searchClose.onclick = () => {
            switchSidebarTab('outline');
        };
    }

    document.getElementById('tabOutline')?.addEventListener('click', () => switchSidebarTab('outline'));
    document.getElementById('tabThumbnails')?.addEventListener('click', () => switchSidebarTab('thumbnails'));
    document.getElementById('tabSearch')?.addEventListener('click', () => {
        switchSidebarTab('search');
        elements.searchInput?.focus();
    });

    document.getElementById('btnDarkMode').onclick = () => {
        state.isDarkMode = !state.isDarkMode;
        applyDarkMode(state.isDarkMode);
    };

    const btnFullscreen = document.getElementById('btnFullscreen');
    if (btnFullscreen) {
        btnFullscreen.onclick = () => {
            toggleFullscreen();
        };
    }

    document.addEventListener('fullscreenchange', () => {
        syncFullscreenUI();
        if (state.zoomMode !== 'manual') {
            updateZoom(state.zoomMode);
        }
    });
    syncFullscreenUI();

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
                showAnnoActionToast('PDF 下载已开始');
            }
        };
    }

    const exportCurrentPageImagesHandler = async () => {
            try {
                if (!state.pdf) {
                    showAnnoActionToast('PDF 尚未加载完成', 'warning');
                    return;
                }

                const pageNum = Number(state.currentPage || 1);
                showAnnoActionToast(`正在识别第 ${pageNum} 页图片...`);

                const images = await extractImagesFromPage(pageNum);
                if (!images.length) {
                    showAnnoActionToast('当前页未识别到可导出图片', 'warning');
                    return;
                }

                let hasFallback = false;
                for (let i = 0; i < images.length; i++) {
                    const item = images[i];
                    const name = buildExportImageFileName({
                        page: pageNum,
                        index: i + 1,
                        kind: item.isFallback ? 'page' : 'img',
                        width: item.width,
                        height: item.height
                    });
                    downloadBlobFile(item.blob, name);
                    if (item.isFallback) hasFallback = true;
                    if (i < images.length - 1) {
                        await new Promise((resolve) => setTimeout(resolve, 120));
                    }
                }

                showAnnoActionToast(hasFallback
                    ? `未提取到原始图片对象，已无损导出第 ${pageNum} 页图像`
                    : `已导出 ${images.length} 张图片`);
            } catch (error) {
                console.warn('导出页面图片失败:', error);
                showAnnoActionToast('导出图片失败', 'warning');
            }
    };

    const btnExportImages = document.getElementById('btnExportImages');
    if (btnExportImages) {
        btnExportImages.onclick = exportCurrentPageImagesHandler;
    }

    const btnExportImagesMenu = document.getElementById('btnExportImagesMenu');
    if (btnExportImagesMenu) {
        btnExportImagesMenu.onclick = () => {
            exportCurrentPageImagesHandler();
            moreOptionsMenu?.classList.add('hidden');
        };
    }

    const btnManualRegionExportMenu = document.getElementById('btnManualRegionExportMenu');
    if (btnManualRegionExportMenu) {
        btnManualRegionExportMenu.onclick = () => {
            state.manualRegionExportArmed = true;
            showAnnoActionToast('手动框选导出：请在页面上按住左键拖拽一个区域');
            moreOptionsMenu?.classList.add('hidden');
        };
    }

    const exportAllImagesHandler = async () => {
            try {
                if (!state.pdf) {
                    showAnnoActionToast('PDF 尚未加载完成', 'warning');
                    return;
                }

                const totalPages = Number(state.pdf.numPages || 0);
                if (totalPages <= 0) {
                    showAnnoActionToast('未检测到可用页', 'warning');
                    return;
                }

                showAnnoActionToast(`开始识别整本 PDF 图片（共 ${totalPages} 页）...`);

                let totalCount = 0;
                let fallbackPages = 0;

                for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
                    const images = await extractImagesFromPage(pageNum);
                    if (!images.length) continue;

                    for (let i = 0; i < images.length; i++) {
                        const item = images[i];
                        const name = buildExportImageFileName({
                            page: pageNum,
                            index: i + 1,
                            kind: item.isFallback ? 'page' : 'img',
                            width: item.width,
                            height: item.height
                        });
                        downloadBlobFile(item.blob, name);
                        totalCount += 1;
                        if (item.isFallback) fallbackPages += 1;
                        await new Promise((resolve) => setTimeout(resolve, 100));
                    }

                    showAnnoActionToast(`第 ${pageNum}/${totalPages} 页完成，累计导出 ${totalCount} 张`);
                }

                if (totalCount === 0) {
                    showAnnoActionToast('整本 PDF 未识别到可导出图片', 'warning');
                    return;
                }

                showAnnoActionToast(fallbackPages > 0
                    ? `整本导出完成，共 ${totalCount} 张（其中 ${fallbackPages} 页为无损整页兜底）`
                    : `整本导出完成，共 ${totalCount} 张图片`);
            } catch (error) {
                console.warn('导出整本图片失败:', error);
                showAnnoActionToast('导出整本图片失败', 'warning');
            }
    };

    const btnExportAllImages = document.getElementById('btnExportAllImages');
    if (btnExportAllImages) {
        btnExportAllImages.onclick = exportAllImagesHandler;
    }

    const btnExportAllImagesMenu = document.getElementById('btnExportAllImagesMenu');
    if (btnExportAllImagesMenu) {
        btnExportAllImagesMenu.onclick = () => {
            exportAllImagesHandler();
            moreOptionsMenu?.classList.add('hidden');
        };
    }

    const btnMoreOptions = document.getElementById('btnMoreOptions');
    const moreOptionsMenu = document.getElementById('moreOptionsMenu');
    if (btnMoreOptions && moreOptionsMenu) {
        btnMoreOptions.onclick = (e) => {
            e.stopPropagation();
            moreOptionsMenu.classList.toggle('hidden');
        };
        document.addEventListener('click', (e) => {
            if (!moreOptionsMenu.contains(e.target) && e.target !== btnMoreOptions) {
                moreOptionsMenu.classList.add('hidden');
            }
        });
    }

    const btnAnnoImportMenu = document.getElementById('btnAnnoImportMenu');
    if (btnAnnoImportMenu && elements.btnAnnoImport) {
        btnAnnoImportMenu.onclick = () => {
            elements.btnAnnoImport.click();
            moreOptionsMenu?.classList.add('hidden');
        };
    }

    const btnAnnoExportMenu = document.getElementById('btnAnnoExportMenu');
    if (btnAnnoExportMenu && elements.btnAnnoExport) {
        btnAnnoExportMenu.onclick = () => {
            elements.btnAnnoExport.click();
            moreOptionsMenu?.classList.add('hidden');
        };
    }

    elements.btnAnnoExport?.addEventListener('click', () => {
        exportAnnotations();
        showAnnoActionToast('批注导出完成');
    });
    elements.btnAnnoImport?.addEventListener('click', () => elements.annoImportFile?.click());
    elements.annoImportFile?.addEventListener('change', () => {
        const file = elements.annoImportFile.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const payload = JSON.parse(String(reader.result || '{}'));
                importAnnotationsFromPayload(payload);
            } catch (e) {
                console.warn('批注导入失败:', e);
            } finally {
                elements.annoImportFile.value = '';
            }
        };
        reader.readAsText(file, 'utf-8');
    });

    elements.btnAnnoApplyEdit?.addEventListener('click', () => {
        const count = applyStyleToSelectedAnnotation();
        if (count > 0) showAnnoActionToast(`已应用样式到 ${count} 个对象`);
        else showAnnoActionToast('当前无选中对象', 'warning');
    });
    elements.btnAnnoDelete?.addEventListener('click', () => {
        const count = deleteSelectedAnnotation();
        if (count > 0) showAnnoActionToast(`已删除 ${count} 个对象（可撤销）`);
        else showAnnoActionToast('当前无选中对象', 'warning');
    });
    elements.btnAnnoSelectText?.addEventListener('click', () => {
        const changed = selectAnnotationsByTypeOnCurrentPage('text');
        showAnnoActionToast(changed ? '已选择当前页文本批注' : '当前页无文本批注', changed ? 'success' : 'warning');
    });
    elements.btnAnnoSelectHighlight?.addEventListener('click', () => {
        const changed = selectAnnotationsByTypeOnCurrentPage('highlight');
        showAnnoActionToast(changed ? '已选择当前页高亮批注' : '当前页无高亮批注', changed ? 'success' : 'warning');
    });
    elements.btnAnnoSelectInk?.addEventListener('click', () => {
        const changed = selectAnnotationsByTypeOnCurrentPage('ink');
        showAnnoActionToast(changed ? '已选择当前页笔迹批注' : '当前页无笔迹批注', changed ? 'success' : 'warning');
    });
    elements.btnAnnoSelectPage?.addEventListener('click', () => {
        const changed = selectAllAnnotationsOnCurrentPage();
        showAnnoActionToast(changed ? '已全选当前页对象' : '当前页无可选对象', changed ? 'success' : 'warning');
    });
    elements.btnAnnoInvertPage?.addEventListener('click', () => {
        const changed = invertSelectionOnCurrentPage();
        showAnnoActionToast(changed ? '已反选当前页对象' : '当前页无可选对象', changed ? 'success' : 'warning');
    });

    elements.annoSelectionStats?.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleSelectionPopover();
    });
    elements.btnAnnoHelp?.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleAnnoHelpPopover();
    });
    document.addEventListener('click', (e) => {
        const target = e.target;
        if (!(target instanceof HTMLElement)) return;
        if (target.closest('#annoSelectionPopover') || target.closest('#annoHelpPopover') || target.closest('#annoSelectionStats') || target.closest('#btnAnnoHelp')) {
            return;
        }
        closeAnnoFloatingPanels();
    });
    updateAnnotationSelectionUI();

    elements.container.onscroll = null;

    // Clean up on window unload
    window.addEventListener('beforeunload', () => {
        if (state.saveTimer) clearTimeout(state.saveTimer);
        if (state.indexSaveTimer) clearTimeout(state.indexSaveTimer);
        if (state.searchNoticeTimer) clearTimeout(state.searchNoticeTimer);
        if (state.searchSessionTimer) clearTimeout(state.searchSessionTimer);
        saveAnnotationsNow();
        saveTextIndexNow();
        saveSearchSessionNow();

        if (state.pageObserver) state.pageObserver.disconnect();
        if (state.thumbnailObserver) state.thumbnailObserver.disconnect();

        // Cancel all active render tasks
        for (const pageNum in state.renderTasks) {
            try {
                state.renderTasks[pageNum].cancel();
            } catch (e) {
                console.warn(`Error cancelling render task for page ${pageNum}:`, e);
            }
        }

        if (state.indexWorker) {
            state.indexWorker.terminate();
            state.indexWorker = null;
        }

        cancelLassoSelection();
    });
}

async function updateZoom(value) {
    if (state.isSelectingText) {
        state.pendingZoomValue = value;
        return;
    }

    const oldZoom = state.zoom;
    const oldCurrentPage = state.currentPage;
    const oldPageEl = document.getElementById(`page-${oldCurrentPage}`);
    const oldRelativeOffset = oldPageEl ? (elements.container.scrollTop - oldPageEl.offsetTop) : 0;

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

    if (state.zoomApplyTimer) {
        clearTimeout(state.zoomApplyTimer);
        state.zoomApplyTimer = null;
    }

    elements.container.classList.add('zooming');
    const nextZoom = state.zoom;

    await new Promise((resolve) => {
        state.zoomApplyTimer = setTimeout(async () => {
            try {
                if (nextZoom !== state.zoom) {
                    resolve();
                    return;
                }

                await prepareLayout();
                renderAllPages();

                const newPageEl = document.getElementById(`page-${oldCurrentPage}`);
                if (newPageEl) {
                    const ratio = oldZoom > 0 ? (state.zoom / oldZoom) : 1;
                    const nextTop = newPageEl.offsetTop + oldRelativeOffset * ratio;
                    elements.container.scrollTop = Math.max(0, nextTop);
                }
            } finally {
                elements.container.classList.remove('zooming');
                state.zoomApplyTimer = null;
                resolve();
            }
        }, 80);
    });
}

function setupSearchEvents() {
    if (!elements.searchInput || !elements.searchPrev || !elements.searchNext || !elements.searchStats) {
        return;
    }

    if (elements.searchScope) {
        state.searchScope = elements.searchScope.value || 'all';
    }

    loadSearchHistory();
    renderSearchResultsList();

    const restoredSession = loadSearchSession();
    if (restoredSession) {
        state.searchScope = restoredSession.scope;
        if (elements.searchScope) {
            elements.searchScope.value = restoredSession.scope;
        }
        if (restoredSession.query) {
            elements.searchInput.value = restoredSession.query;
            state.searchQuery = restoredSession.query;
            state.searchCollapsedPages = new Set(restoredSession.collapsedPages || []);
            state.searchResultPage = restoredSession.searchResultPage || 1;
        }
    }

    const runSearch = async (options = {}) => {
        const query = elements.searchInput.value.trim();
        state.searchQuery = query;
        state.searchResults = [];
        state.searchIndex = -1;
        state.searchCurrentEl = null;
        state.searchResultPage = 1;
        state.searchCollapsedPages.clear();
        state.searchHitStats = {};
        clearSearchHighlights();

        if (!query) {
            elements.searchStats.textContent = '0/0';
            renderSearchResultsList();
            scheduleSearchSessionSave();
            return;
        }

        const keyword = normalizeText(query);
        pushSearchHistory(query);
        const fromPage = state.searchScope === 'current' ? state.currentPage : 1;
        const toPage = state.searchScope === 'current' ? state.currentPage : state.pdf.numPages;

        let workerResults = null;
        if (state.indexWorker) {
            await ensureIndexForRange(fromPage, toPage);
            workerResults = await searchWithIndexWorker(keyword, fromPage, toPage);
        }

        if (Array.isArray(workerResults)) {
            state.searchResults = workerResults.map(item => ({
                page: Number(item.page),
                indexInPage: Number(item.indexInPage),
                snippet: item.snippet || ''
            }));
        } else {
            for (let i = fromPage; i <= toPage; i++) {
                let textContent = state.textCache[i];
                if (!textContent) {
                    try {
                        const page = await state.pdf.getPage(i);
                        textContent = await page.getTextContent();
                        state.textCache[i] = textContent;
                        if (typeof page.cleanup === 'function') page.cleanup();
                    } catch {
                        continue;
                    }
                }

                let hitIndexInPage = 0;
                (textContent.items || []).forEach((item, itemIndex, arr) => {
                    const joined = normalizeText(item.str);
                    if (joined.includes(keyword)) {
                        hitIndexInPage += 1;
                        state.searchResults.push({
                            page: i,
                            indexInPage: hitIndexInPage,
                            snippet: buildContextSnippet(arr, itemIndex)
                        });
                    }
                });
            }
        }

        state.searchHitStats = state.searchResults.reduce((acc, item) => {
            const page = Number(item.page || 0);
            if (!page) return acc;
            acc[page] = Number(acc[page] || 0) + 1;
            return acc;
        }, {});

        for (let i = fromPage; i <= toPage; i++) {
            applySearchHighlightOnPage(i);
        }

        if (state.searchResults.length > 0) {
            const desiredIndex = Number(options.restoreSearchIndex);
            const hasDesiredIndex = Number.isFinite(desiredIndex) && desiredIndex >= 0 && desiredIndex < state.searchResults.length;
            const nextIndex = hasDesiredIndex ? desiredIndex : 0;

            state.searchIndex = nextIndex;
            state.searchResultPage = Math.floor(nextIndex / state.searchPageSize) + 1;

            if (Array.isArray(options.restoreCollapsedPages)) {
                state.searchCollapsedPages = new Set(options.restoreCollapsedPages.filter(v => Number.isFinite(Number(v))).map(v => Number(v)));
            }

            jumpToSearchResult(nextIndex);
        } else {
            elements.searchStats.textContent = '0/0';
            state.searchCurrentEl = null;
        }

        renderSearchResultsList();
        scheduleSearchSessionSave();
    };

    state.runSearchFn = runSearch;

    elements.searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' && state.searchResults.length > 0) {
            e.preventDefault();
            goToNextResult();
            return;
        }
        if (e.key === 'ArrowUp' && state.searchResults.length > 0) {
            e.preventDefault();
            goToPrevResult();
            return;
        }

        if (e.key === 'Enter' && e.shiftKey) {
            e.preventDefault();
            goToPrevResult();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (state.searchQuery && elements.searchInput.value.trim() === state.searchQuery) {
                goToNextResult();
            } else {
                runSearch();
            }
        }
    });

    elements.searchInput.addEventListener('input', () => {
        if (!elements.searchInput.value.trim()) {
            state.searchQuery = '';
            state.searchResults = [];
            state.searchHitStats = {};
            state.searchIndex = -1;
            state.searchCurrentEl = null;
            state.searchResultPage = 1;
            state.searchCollapsedPages.clear();
            elements.searchStats.textContent = '0/0';
            clearSearchHighlights();
            renderSearchResultsList();
            scheduleSearchSessionSave();
        }
    });

    elements.searchScope?.addEventListener('change', () => {
        state.searchScope = elements.searchScope.value;
        if (elements.searchInput.value.trim()) {
            state.searchResults = [];
            state.searchIndex = -1;
            state.searchResultPage = 1;
            state.searchCollapsedPages.clear();
            state.searchStats.textContent = '0/0';
            clearSearchHighlights();
            renderSearchResultsList();
        }
        scheduleSearchSessionSave();
    });

    elements.searchNext.addEventListener('click', () => {
        if (state.searchResults.length === 0) runSearch();
        else goToNextResult();
    });

    elements.searchPrev.addEventListener('click', () => {
        if (state.searchResults.length === 0) runSearch();
        else goToPrevResult();
    });

    if (restoredSession?.query) {
        runSearch({
            restoreSearchIndex: restoredSession.searchIndex,
            restoreCollapsedPages: restoredSession.collapsedPages
        }).then(() => {
            showSearchSessionNotice('已恢复上次搜索状态');
        }).catch(() => {
            // ignore
        });
    }
}

function goToNextResult() {
    if (state.searchResults.length === 0) return;
    state.searchIndex = (state.searchIndex + 1) % state.searchResults.length;
    jumpToSearchResult(state.searchIndex);
}

function goToPrevResult() {
    if (state.searchResults.length === 0) return;
    state.searchIndex = (state.searchIndex - 1 + state.searchResults.length) % state.searchResults.length;
    jumpToSearchResult(state.searchIndex);
}

function jumpToSearchResult(index) {
    const result = state.searchResults[index];
    if (!result) return;

    const page = result.page;
    state.searchResultPage = Math.floor(index / state.searchPageSize) + 1;
    state.searchCollapsedPages.delete(page);
    scheduleSearchSessionSave();
    renderSearchResultsList();
    elements.searchStats.textContent = `${index + 1}/${state.searchResults.length}`;
    document.getElementById(`page-${page}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

    setTimeout(() => {
        applySearchHighlightOnPage(page);
        const pageEl = document.getElementById(`page-${page}`);
        if (!pageEl) return;

        const hits = pageEl.querySelectorAll('.textLayer > span.search-hit');
        const target = hits[result.indexInPage - 1] || hits[0];
        if (!target) return;

        if (state.searchCurrentEl) {
            state.searchCurrentEl.classList.remove('current-search-hit');
        }

        state.searchCurrentEl = target;
        target.classList.add('current-search-hit');
        target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });

        if (elements.searchResultsView) {
            elements.searchResultsView.querySelectorAll('.search-result-item').forEach(item => {
                item.classList.toggle('active', item.dataset.resultIndex === String(index));
            });
            const activeItem = elements.searchResultsView.querySelector('.search-result-item.active');
            if (activeItem) {
                activeItem.classList.remove('keyboard-focus');
                void activeItem.offsetWidth;
                activeItem.classList.add('keyboard-focus');
            }
            activeItem?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }, 120);
}

function applyDarkMode(enabled) {
    document.documentElement.setAttribute('data-theme', enabled ? 'dark' : 'light');
    state.isDarkMode = enabled;
    localStorage.setItem('pdf-dark-mode', enabled);
}

// Initialize the PDF viewer
init();
