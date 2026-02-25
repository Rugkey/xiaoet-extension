/**
 * service-worker.js
 * Background script for XiaoEt extension.
 * Handles context menus, PDF redirection, and translation API calls.
 */

try {
    importScripts(chrome.runtime.getURL('src/shared/translation-memory-core.js'));
} catch (e) {
    console.debug('translation-memory-core import failed, using local fallback:', e);
}

// Memory management and performance optimization
const MESSAGE_TYPES = {
    TRIGGER_SHORTCUT: 'TRIGGER_SHORTCUT',
    TRIGGER_DOCUMENT_TRANSLATE: 'TRIGGER_DOCUMENT_TRANSLATE'
};

const TRANSLATION_CACHE = new Map();
const MAX_CACHE_SIZE = 200;
const ACTIVE_STREAMS = new Set();
const TRANSLATION_MEMORY = new Map();
const MAX_TM_SIZE = 300;
let tmInitialized = false;
const TASKS = new Map();
const MAX_TASKS = 300;
const CANCELED_TASKS = new Set();
const TASK_METRICS_STORAGE_KEY = 'taskMetrics';
const MAX_TASK_HISTORY = 300;
const TASK_METRICS = {
    total: 0,
    success: 0,
    failed: 0,
    totalDurationMs: 0,
    byMode: {},
    failedByReason: {},
    history: []
};

// Performance monitoring
let requestCount = 0;
let errorCount = 0;

// Multi-engine fusion configuration
const ENGINE_WEIGHTS = {
    'google': 0.2,
    'deepl': 0.4,
    'deepseek': 0.3,
    'openai': 0.1
};

// Domain-specific prompts
const DOMAIN_PROMPTS = {
    'default': 'You are a professional translator.',
    'academic': 'You are an academic researcher translating scholarly content. Maintain formal tone, preserve technical terminology, and ensure accuracy of scientific concepts.',
    'medical': 'You are a medical professional translating clinical and research content. Preserve medical terminology and ensure clinical accuracy.',
    'legal': 'You are a legal expert translating legal documents. Maintain formal language and preserve legal terminology.',
    'technical': 'You are a technical expert translating technical documentation. Preserve technical terms and maintain precision.',
    'literature': 'You are a literary translator. Preserve the style, tone, rhythm, and literary devices of the original text. Prioritize natural, elegant expression over literal accuracy.',
    'business': 'You are a business translator. Use formal, professional language appropriate for corporate communications, reports, and official documents.'
};

// --- Shared helpers ---

/**
 * Build a full translation prompt from profile and context.
 */
function buildPrompt(profile, targetLang, context) {
    const domainPrompt = DOMAIN_PROMPTS[profile] || DOMAIN_PROMPTS.default;
    let prompt = `${domainPrompt} Translate the following text to ${targetLang}.`;
    if (context && context.length > 0) {
        prompt += ` Context: "${context}". Use the context to inform your translation but only translate the requested text.`;
    }
    prompt += ' Output ONLY the translated text.';
    return prompt;
}

/**
 * Compute a cache key using a proper hash of the FULL text.
 */
function getCacheKey(text, engine, targetLang) {
    return `${simpleHash(text)}_${engine}_${targetLang}`;
}

function getTMKey(text, targetLang) {
    return `${simpleHash(text)}_${targetLang}`;
}

function normalizeTMRecord(key, value) {
    if (typeof value === 'string' && value) {
        return {
            sourceText: '',
            targetLang: key.split('_').pop() || '',
            translated: value,
            normalizedSource: '',
            updatedAt: Date.now(),
            hitCount: 0,
            exactHitCount: 0,
            fuzzyHitCount: 0
        };
    }
    if (!value || typeof value !== 'object' || typeof value.translated !== 'string' || !value.translated) {
        return null;
    }
    const sourceText = typeof value.sourceText === 'string' ? value.sourceText : '';
    return {
        sourceText,
        targetLang: typeof value.targetLang === 'string' ? value.targetLang : (key.split('_').pop() || ''),
        translated: value.translated,
        normalizedSource: typeof value.normalizedSource === 'string' ? value.normalizedSource : normalizeTMText(sourceText),
        updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : Date.now(),
        hitCount: Number.isFinite(value.hitCount) ? value.hitCount : 0,
        exactHitCount: Number.isFinite(value.exactHitCount) ? value.exactHitCount : 0,
        fuzzyHitCount: Number.isFinite(value.fuzzyHitCount) ? value.fuzzyHitCount : 0
    };
}

/**
 * djb2-style hash that processes the full string (not just first 100 chars).
 */
function simpleHash(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
    }
    return Math.abs(hash).toString(36);
}

/**
 * Fetch with HTTP status check. Throws on non-2xx responses.
 */
async function safeFetch(url, options) {
    const response = await fetch(url, options);
    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`API error ${response.status}: ${body.substring(0, 200)}`);
    }
    return response;
}

async function ensureTranslationMemoryLoaded() {
    if (tmInitialized) return;
    try {
        const data = await chrome.storage.local.get({ translationMemory: {} });
        const memoryObj = data.translationMemory || {};
        Object.entries(memoryObj).forEach(([key, value]) => {
            const normalized = normalizeTMRecord(key, value);
            if (normalized) TRANSLATION_MEMORY.set(key, normalized);
        });
    } catch (e) {
        console.debug('Failed to load translation memory:', e);
    }
    tmInitialized = true;
}

function normalizeTMText(text) {
    if (self.TranslationMemoryCore?.normalizeTMText) {
        return self.TranslationMemoryCore.normalizeTMText(text);
    }
    return String(text || '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201c\u201d]/g, '"')
        .trim();
}

function bigramDiceSimilarity(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;

    const gramsA = new Map();
    for (let i = 0; i < a.length - 1; i++) {
        const g = a.slice(i, i + 2);
        gramsA.set(g, (gramsA.get(g) || 0) + 1);
    }

    let intersection = 0;
    let gramsBCount = 0;
    for (let i = 0; i < b.length - 1; i++) {
        const g = b.slice(i, i + 2);
        gramsBCount++;
        const count = gramsA.get(g) || 0;
        if (count > 0) {
            intersection++;
            gramsA.set(g, count - 1);
        }
    }

    const gramsACount = Math.max(a.length - 1, 0);
    const denom = gramsACount + gramsBCount;
    return denom > 0 ? (2 * intersection) / denom : 0;
}

function calcTMSimilarity(queryNorm, candidateNorm) {
    if (self.TranslationMemoryCore?.calcTMSimilarity) {
        return self.TranslationMemoryCore.calcTMSimilarity(queryNorm, candidateNorm);
    }
    if (!queryNorm || !candidateNorm) return 0;
    if (queryNorm === candidateNorm) return 1;
    const dice = bigramDiceSimilarity(queryNorm, candidateNorm);
    const includeBoost = (queryNorm.includes(candidateNorm) || candidateNorm.includes(queryNorm))
        ? Math.min(queryNorm.length, candidateNorm.length) / Math.max(queryNorm.length, candidateNorm.length)
        : 0;
    return Math.max(dice, includeBoost);
}

async function lookupTranslationMemory(text, targetLang, tmOptions = {}) {
    await ensureTranslationMemoryLoaded();
    const exactKey = getTMKey(text, targetLang);
    const exact = TRANSLATION_MEMORY.get(exactKey);
    if (exact?.translated) {
        exact.hitCount = (exact.hitCount || 0) + 1;
        exact.exactHitCount = (exact.exactHitCount || 0) + 1;
        exact.updatedAt = Date.now();
        return { translated: exact.translated, matchType: 'exact', score: 1 };
    }

    const fuzzyEnabled = tmOptions.fuzzyEnabled !== false;
    if (!fuzzyEnabled) return null;

    const queryNorm = normalizeTMText(text);
    if (!queryNorm) return null;

    let best = null;
    let bestScore = 0;
    const threshold = Number(tmOptions.threshold || 0.82);

    for (const [, record] of TRANSLATION_MEMORY.entries()) {
        if (!record || record.targetLang !== targetLang || !record.translated) continue;
        const candidateNorm = record.normalizedSource || normalizeTMText(record.sourceText || '');
        if (!candidateNorm) continue;

        const score = calcTMSimilarity(queryNorm, candidateNorm);
        if (score > bestScore) {
            bestScore = score;
            best = record;
        }
    }

    if (best && bestScore >= threshold) {
        best.hitCount = (best.hitCount || 0) + 1;
        best.fuzzyHitCount = (best.fuzzyHitCount || 0) + 1;
        best.updatedAt = Date.now();
        return { translated: best.translated, matchType: 'fuzzy', score: Number(bestScore.toFixed(3)) };
    }

    return null;
}

async function saveTranslationMemory(text, targetLang, translated) {
    if (!text || !translated) return;
    await ensureTranslationMemoryLoaded();

    const key = getTMKey(text, targetLang);
    if (TRANSLATION_MEMORY.has(key)) {
        TRANSLATION_MEMORY.delete(key);
    }
    TRANSLATION_MEMORY.set(key, {
        sourceText: text,
        targetLang,
        translated,
        normalizedSource: normalizeTMText(text),
        updatedAt: Date.now(),
        hitCount: 0,
        exactHitCount: 0,
        fuzzyHitCount: 0
    });

    if (TRANSLATION_MEMORY.size > MAX_TM_SIZE) {
        const firstKey = TRANSLATION_MEMORY.keys().next().value;
        TRANSLATION_MEMORY.delete(firstKey);
    }

    try {
        await chrome.storage.local.set({ translationMemory: Object.fromEntries(TRANSLATION_MEMORY.entries()) });
    } catch (e) {
        console.debug('Failed to save translation memory:', e);
    }
}

function getTMStats() {
    const now = Date.now();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    const langSet = new Set();
    let totalHits = 0;
    let exactHits = 0;
    let fuzzyHits = 0;
    let recent7d = 0;

    for (const [, record] of TRANSLATION_MEMORY.entries()) {
        if (!record) continue;
        if (record.targetLang) langSet.add(record.targetLang);
        totalHits += Number(record.hitCount || 0);
        exactHits += Number(record.exactHitCount || 0);
        fuzzyHits += Number(record.fuzzyHitCount || 0);
        if (record.updatedAt && (now - Number(record.updatedAt)) <= sevenDays) {
            recent7d++;
        }
    }

    return {
        total: TRANSLATION_MEMORY.size,
        languages: langSet.size,
        totalHits,
        exactHits,
        fuzzyHits,
        recent7d
    };
}

function createTask(tabId, request = {}) {
    const taskId = request.taskId || `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    if (TASKS.size >= MAX_TASKS) {
        const firstKey = TASKS.keys().next().value;
        TASKS.delete(firstKey);
    }
    TASKS.set(taskId, {
        tabId,
        createdAt: Date.now(),
        type: request.type || 'REQUEST_TASK_TRANSLATE',
        mode: request.mode || 'translate',
        engine: request.engine || 'google',
        targetLang: request.targetLang || 'zh-CN'
    });
    return taskId;
}

function isTaskCanceled(taskId) {
    return !!taskId && CANCELED_TASKS.has(taskId);
}

function normalizeErrorForUI(error) {
    const rawMessage = String(error?.message || error || '翻译失败');
    const lower = rawMessage.toLowerCase();

    let code = 'unknown';
    let advice = '请稍后重试，或切换引擎后再试。';

    if (lower.includes('api key') || lower.includes('401') || lower.includes('403') || lower.includes('unauthorized')) {
        code = 'auth';
        advice = '请在设置页检查 API Key 是否填写正确、是否仍有效。';
    } else if (lower.includes('quota') || lower.includes('429') || lower.includes('rate limit') || lower.includes('exceed')) {
        code = 'quota';
        advice = '配额或频率已达上限，建议稍后重试或切换其他引擎。';
    } else if (lower.includes('timeout') || lower.includes('超时')) {
        code = 'timeout';
        advice = '请求超时，建议缩短文本后重试，或切换更快的引擎。';
    } else if (lower.includes('network') || lower.includes('failed to fetch') || lower.includes('connection')) {
        code = 'network';
        advice = '网络连接异常，请检查网络后重试。';
    } else if (lower.includes('csp') || lower.includes('content security policy') || lower.includes('worker-src')) {
        code = 'csp';
        advice = '当前网站安全策略限制了此功能，请切换页面或站点重试。';
    } else if (lower.includes('cancel')) {
        code = 'canceled';
        advice = '任务已取消。';
    }

    return {
        message: rawMessage,
        code,
        advice
    };
}

function emitTaskEvent(tabId, taskId, event, payload = {}) {
    if (!tabId || !taskId) return;
    chrome.tabs.sendMessage(tabId, {
        type: 'TASK_EVENT',
        taskId,
        event,
        payload
    });
}

function runTaskTranslate(tabId, request = {}) {
    const taskId = createTask(tabId, {
        ...request,
        type: 'REQUEST_TASK_TRANSLATE'
    });
    const shouldUseStream = request.stream === true || ['deepseek', 'openai', 'multi'].includes(request.engine);

    setTimeout(() => {
        if (isTaskCanceled(taskId)) return;
        const taskInfo = getTaskInfo(taskId);
        emitTaskEvent(tabId, taskId, 'TASK_CREATED', {
            original: request.text,
            mode: request.mode || 'translate',
            engine: request.engine,
            stream: shouldUseStream,
            createdAt: taskInfo?.createdAt || Date.now()
        });

        if (shouldUseStream) {
            handleStreamTranslation(
                request.text,
                tabId,
                request.engine,
                request.targetLang,
                request.profile || 'default',
                request.context || '',
                taskId
            );
        } else {
            translateText(request.text, tabId, {
                engine: request.engine,
                targetLang: request.targetLang,
                mode: request.mode || 'translate',
                profile: request.profile || 'default',
                context: request.context || '',
                taskId
            }).catch(() => {
                // surfaced by TASK_EVENT
            });
        }
    }, 0);

    return taskId;
}

function cancelTask(taskId, reason = '用户取消任务') {
    if (!taskId) return false;
    const info = getTaskInfo(taskId);
    if (!info) return false;

    CANCELED_TASKS.add(taskId);
    emitTaskEvent(info.tabId, taskId, 'TASK_ERROR', normalizeErrorForUI(reason));
    emitTaskDone(info.tabId, taskId, 'failed', { reason, canceled: true });
    return true;
}

function getTaskInfo(taskId) {
    if (!taskId) return null;
    return TASKS.get(taskId) || null;
}

function emitTaskDone(tabId, taskId, status = 'success', extra = {}) {
    const info = getTaskInfo(taskId);
    const durationMs = info?.createdAt ? Math.max(0, Date.now() - info.createdAt) : null;
    recordTaskMetrics(info?.mode || extra.mode || 'translate', status, durationMs, extra.reason || '');
    emitTaskEvent(tabId, taskId, 'TASK_DONE', {
        status,
        durationMs,
        ...extra
    });
    completeTask(taskId);
}

function completeTask(taskId) {
    if (!taskId) return;
    TASKS.delete(taskId);
    CANCELED_TASKS.delete(taskId);
}

function classifyFailureReason(reason) {
    const text = String(reason || '').toLowerCase();
    if (!text) return 'unknown';
    if (text.includes('timeout') || text.includes('超时')) return 'timeout';
    if (text.includes('api key') || text.includes('unauthorized') || text.includes('401') || text.includes('403') || text.includes('鉴权')) return 'auth';
    if (text.includes('network') || text.includes('fetch') || text.includes('failed to fetch') || text.includes('connection')) return 'network';
    if (text.includes('parse') || text.includes('json')) return 'parse';
    if (text.includes('invalid request')) return 'request';
    return 'other';
}

function recordTaskMetrics(mode, status, durationMs, reason = '') {
    TASK_METRICS.total += 1;
    if (status === 'success') TASK_METRICS.success += 1;
    else TASK_METRICS.failed += 1;

    if (Number.isFinite(durationMs)) {
        TASK_METRICS.totalDurationMs += Number(durationMs);
    }

    const key = String(mode || 'translate');
    if (!TASK_METRICS.byMode[key]) {
        TASK_METRICS.byMode[key] = { total: 0, success: 0, failed: 0 };
    }
    TASK_METRICS.byMode[key].total += 1;
    if (status === 'success') TASK_METRICS.byMode[key].success += 1;
    else {
        TASK_METRICS.byMode[key].failed += 1;
        const reasonKey = classifyFailureReason(reason);
        TASK_METRICS.failedByReason[reasonKey] = Number(TASK_METRICS.failedByReason[reasonKey] || 0) + 1;
    }

    TASK_METRICS.history.push({
        ts: Date.now(),
        mode: key,
        status,
        durationMs: Number(durationMs) || 0,
        reason: status === 'failed' ? classifyFailureReason(reason) : ''
    });
    if (TASK_METRICS.history.length > MAX_TASK_HISTORY) {
        TASK_METRICS.history = TASK_METRICS.history.slice(-MAX_TASK_HISTORY);
    }

    persistTaskMetricsToStorage();
}

function getTaskStats() {
    const calcWindow = (list) => {
        const total = list.length;
        const success = list.filter(item => item.status === 'success').length;
        const failed = total - success;
        const durationSum = list.reduce((sum, item) => sum + (Number(item.durationMs) || 0), 0);
        return {
            total,
            success,
            failed,
            successRate: total > 0 ? Number(((success / total) * 100).toFixed(1)) : 0,
            avgDurationMs: total > 0 ? Math.round(durationSum / total) : 0
        };
    };

    const avgDurationMs = TASK_METRICS.total > 0
        ? Math.round(TASK_METRICS.totalDurationMs / TASK_METRICS.total)
        : 0;
    const successRate = TASK_METRICS.total > 0
        ? Number(((TASK_METRICS.success / TASK_METRICS.total) * 100).toFixed(1))
        : 0;

    const now = Date.now();
    const last1hList = TASK_METRICS.history.filter(item => (now - Number(item.ts || 0)) <= 60 * 60 * 1000);
    const last50List = TASK_METRICS.history.slice(-50);

    return {
        total: TASK_METRICS.total,
        success: TASK_METRICS.success,
        failed: TASK_METRICS.failed,
        successRate,
        avgDurationMs,
        byMode: TASK_METRICS.byMode,
        failedByReason: TASK_METRICS.failedByReason,
        recent1h: calcWindow(last1hList),
        recent50: calcWindow(last50List)
    };
}

function mergeTaskMetrics(raw) {
    if (!raw || typeof raw !== 'object') return;
    TASK_METRICS.total = Number(raw.total || 0);
    TASK_METRICS.success = Number(raw.success || 0);
    TASK_METRICS.failed = Number(raw.failed || 0);
    TASK_METRICS.totalDurationMs = Number(raw.totalDurationMs || 0);
    TASK_METRICS.byMode = raw.byMode && typeof raw.byMode === 'object' ? raw.byMode : {};
    TASK_METRICS.failedByReason = raw.failedByReason && typeof raw.failedByReason === 'object' ? raw.failedByReason : {};
    TASK_METRICS.history = Array.isArray(raw.history) ? raw.history.slice(-MAX_TASK_HISTORY) : [];
}

async function loadTaskMetricsFromStorage() {
    try {
        const data = await chrome.storage.local.get({ [TASK_METRICS_STORAGE_KEY]: null });
        mergeTaskMetrics(data[TASK_METRICS_STORAGE_KEY]);
    } catch (e) {
        console.debug('Failed to load task metrics:', e);
    }
}

async function persistTaskMetricsToStorage() {
    try {
        await chrome.storage.local.set({ [TASK_METRICS_STORAGE_KEY]: TASK_METRICS });
    } catch (e) {
        console.debug('Failed to persist task metrics:', e);
    }
}

function getTMEntries() {
    return Array.from(TRANSLATION_MEMORY.entries())
        .map(([key, item]) => ({
            key,
            sourceText: item.sourceText || '',
            targetLang: item.targetLang || '',
            translated: item.translated || '',
            hitCount: Number(item.hitCount || 0),
            exactHitCount: Number(item.exactHitCount || 0),
            fuzzyHitCount: Number(item.fuzzyHitCount || 0),
            updatedAt: Number(item.updatedAt || 0)
        }))
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

async function deleteTranslationMemoryEntry(entryKey) {
    await ensureTranslationMemoryLoaded();
    if (!entryKey || typeof entryKey !== 'string') return false;
    const existed = TRANSLATION_MEMORY.delete(entryKey);
    if (existed) {
        await chrome.storage.local.set({ translationMemory: Object.fromEntries(TRANSLATION_MEMORY.entries()) });
    }
    return existed;
}

async function updateTranslationMemoryEntry(entryKey, patch = {}) {
    await ensureTranslationMemoryLoaded();
    if (!entryKey || typeof entryKey !== 'string') return { updated: false };

    const existing = TRANSLATION_MEMORY.get(entryKey);
    if (!existing) return { updated: false };

    const sourceText = String((patch.sourceText ?? existing.sourceText) || '').trim();
    const targetLang = String((patch.targetLang ?? existing.targetLang) || '').trim();
    const translated = String((patch.translated ?? existing.translated) || '').trim();

    if (!targetLang || !translated) {
        return { updated: false, error: 'targetLang or translated is empty' };
    }

    const nextKey = sourceText ? getTMKey(sourceText, targetLang) : entryKey;
    const nextRecord = {
        ...existing,
        sourceText,
        targetLang,
        translated,
        normalizedSource: normalizeTMText(sourceText),
        updatedAt: Date.now()
    };

    if (nextKey !== entryKey) {
        TRANSLATION_MEMORY.delete(entryKey);
    }
    TRANSLATION_MEMORY.set(nextKey, nextRecord);

    await chrome.storage.local.set({ translationMemory: Object.fromEntries(TRANSLATION_MEMORY.entries()) });
    return { updated: true, key: nextKey };
}

async function importTranslationMemory(payload) {
    await ensureTranslationMemoryLoaded();
    let importedCount = 0;

    const normalizedPairs = [];
    if (Array.isArray(payload)) {
        payload.forEach((item, index) => normalizedPairs.push([`import_${index}`, item]));
    } else if (payload && typeof payload === 'object') {
        Object.entries(payload).forEach(([key, value]) => normalizedPairs.push([key, value]));
    }

    for (const [rawKey, rawValue] of normalizedPairs) {
        const record = normalizeTMRecord(rawKey, rawValue);
        if (!record || !record.translated) continue;

        const key = record.sourceText
            ? getTMKey(record.sourceText, record.targetLang || 'zh-CN')
            : (rawKey.includes('_') ? rawKey : `${rawKey}_${record.targetLang || 'zh-CN'}`);

        TRANSLATION_MEMORY.set(key, record);
        importedCount++;
    }

    while (TRANSLATION_MEMORY.size > MAX_TM_SIZE) {
        const firstKey = TRANSLATION_MEMORY.keys().next().value;
        TRANSLATION_MEMORY.delete(firstKey);
    }

    await chrome.storage.local.set({ translationMemory: Object.fromEntries(TRANSLATION_MEMORY.entries()) });
    return importedCount;
}

// 1. INITIALIZATION
loadTaskMetricsFromStorage();

chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
            id: "translate-selection",
            title: "Translate Selection",
            contexts: ["selection"]
        });
        chrome.contextMenus.create({
            id: "translate-image",
            title: "Translate Image Text",
            contexts: ["image"]
        });
    });

    // Use chrome.alarms instead of setInterval (MV3 service workers are short-lived)
    chrome.alarms.create('cleanup-cache', { periodInMinutes: 5 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'cleanup-cache') {
        cleanupCache();
    }
});

// 2. PDF REDIRECTION
function isRedirectedToAcademicViewer(url) {
    if (!url || typeof url !== 'string') return false;
    return url.startsWith(chrome.runtime.getURL('src/pdf/web/academic-viewer.html'));
}

function isSupportedPdfUrl(url) {
    if (!url || typeof url !== 'string') return false;
    if (isRedirectedToAcademicViewer(url)) return false;
    if (!/^(file|https?):\/\//i.test(url)) return false;

    const cleanUrl = url.split('#')[0];
    return /\.pdf(?:$|\?)/i.test(cleanUrl);
}

function redirectPdfTab(tabId, rawUrl) {
    if (!tabId || !isSupportedPdfUrl(rawUrl)) return;
    const viewerUrl = chrome.runtime.getURL(`src/pdf/web/academic-viewer.html?file=${encodeURIComponent(rawUrl)}`);
    chrome.tabs.update(tabId, { url: viewerUrl }, () => {
        if (chrome.runtime.lastError) {
            console.debug('PDF redirect skipped:', chrome.runtime.lastError.message);
        }
    });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const candidateUrl = changeInfo.url || tab?.url || '';
    if (!candidateUrl) return;
    if (changeInfo.status && changeInfo.status !== 'loading') return;
    redirectPdfTab(tabId, candidateUrl);
});

if (chrome.webNavigation && chrome.webNavigation.onBeforeNavigate) {
    chrome.webNavigation.onBeforeNavigate.addListener((details) => {
        if (details.frameId !== 0) return;
        redirectPdfTab(details.tabId, details.url);
    });
}

// 3. CONTEXT MENU CLICKS
chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "translate-selection" && info.selectionText) {
        chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["src/content/utils.js", "src/content/styles.js", "src/content/drag.js", "src/content/ui.js", "src/content/main.js"]
        }, () => {
            if (chrome.runtime.lastError) {
                console.log("Script injection status:", chrome.runtime.lastError.message);
            }
            translateText(info.selectionText, tab.id, { mode: 'translate' });
        });
    } else if (info.menuItemId === 'translate-image' && info.srcUrl && tab?.id) {
        chrome.tabs.sendMessage(tab.id, {
            type: 'TRIGGER_IMAGE_OCR',
            imageUrl: info.srcUrl
        });
    }
});

// 4. SHORTCUTS
chrome.commands.onCommand.addListener((command) => {
    // Keep command routing explicit so manifest commands stay behaviorally complete.
    if (command === "translate_selection") {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, { type: MESSAGE_TYPES.TRIGGER_SHORTCUT });
            }
        });
    } else if (command === 'translate_document') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, { type: MESSAGE_TYPES.TRIGGER_DOCUMENT_TRANSLATE });
            }
        });
    }
});

// 5. MESSAGE HANDLING
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!isValidRequest(request)) {
        console.warn('Invalid request received:', request);
        sendResponse({ success: false, error: 'Invalid request' });
        return;
    }

    if (request.type === 'REQUEST_TASK_TRANSLATE') {
        const tabId = sender?.tab?.id;
        if (!tabId) {
            sendResponse({ success: false, error: 'No sender tab found' });
            return;
        }

        const taskId = runTaskTranslate(tabId, request);
        sendResponse({ success: true, taskId });
    } else if (request.type === 'REQUEST_CANCEL_TASK') {
        const canceled = cancelTask(request.taskId, request.reason || '用户取消任务');
        sendResponse({ success: canceled, canceled });
    } else if (request.type === 'REQUEST_BATCH_TRANSLATE') {
        (async () => {
            try {
                const resultList = await translateBatch(request.texts, request.context, request.engine, request.targetLang);
                sendResponse({ success: true, data: resultList });
            } catch (e) {
                sendResponse({ success: false, error: e.message });
            }
        })();
        return true;
    } else if (request.type === 'TEST_API_KEY') {
        (async () => {
            try {
                const testText = 'Hello';
                const result = await translateSingle(testText, {
                    engine: request.engine,
                    targetLang: 'zh-CN',
                    profile: 'default'
                });
                sendResponse({ success: true, result: result.text });
            } catch (e) {
                sendResponse({ success: false, error: e.message });
            }
        })();
        return true;
    } else if (request.type === 'GET_TRANSLATION_HISTORY') {
        (async () => {
            try {
                const data = await chrome.storage.local.get({ translationHistory: [] });
                sendResponse({ success: true, history: data.translationHistory });
            } catch (e) {
                sendResponse({ success: false, error: e.message });
            }
        })();
        return true;
    } else if (request.type === 'CLEAR_TRANSLATION_HISTORY') {
        (async () => {
            try {
                // History cleanup should not wipe TM. TM has its own explicit clear action.
                await chrome.storage.local.set({ translationHistory: [] });
                sendResponse({ success: true });
            } catch (e) {
                sendResponse({ success: false, error: e.message });
            }
        })();
        return true;
    } else if (request.type === 'GET_TM_STATS') {
        (async () => {
            try {
                await ensureTranslationMemoryLoaded();
                sendResponse({ success: true, stats: getTMStats() });
            } catch (e) {
                sendResponse({ success: false, error: e.message });
            }
        })();
        return true;
    } else if (request.type === 'GET_TASK_STATS') {
        sendResponse({ success: true, stats: getTaskStats() });
    } else if (request.type === 'CLEAR_TRANSLATION_MEMORY') {
        (async () => {
            try {
                await chrome.storage.local.set({ translationMemory: {} });
                TRANSLATION_MEMORY.clear();
                tmInitialized = true;
                sendResponse({ success: true });
            } catch (e) {
                sendResponse({ success: false, error: e.message });
            }
        })();
        return true;
    } else if (request.type === 'EXPORT_TRANSLATION_MEMORY') {
        (async () => {
            try {
                await ensureTranslationMemoryLoaded();
                sendResponse({ success: true, data: Object.fromEntries(TRANSLATION_MEMORY.entries()) });
            } catch (e) {
                sendResponse({ success: false, error: e.message });
            }
        })();
        return true;
    } else if (request.type === 'GET_TM_ENTRIES') {
        (async () => {
            try {
                await ensureTranslationMemoryLoaded();
                sendResponse({ success: true, entries: getTMEntries() });
            } catch (e) {
                sendResponse({ success: false, error: e.message });
            }
        })();
        return true;
    } else if (request.type === 'IMPORT_TRANSLATION_MEMORY') {
        (async () => {
            try {
                const count = await importTranslationMemory(request.data);
                sendResponse({ success: true, imported: count });
            } catch (e) {
                sendResponse({ success: false, error: e.message });
            }
        })();
        return true;
    } else if (request.type === 'DELETE_TM_ENTRY') {
        (async () => {
            try {
                const deleted = await deleteTranslationMemoryEntry(request.key);
                sendResponse({ success: true, deleted });
            } catch (e) {
                sendResponse({ success: false, error: e.message });
            }
        })();
        return true;
    } else if (request.type === 'UPDATE_TM_ENTRY') {
        (async () => {
            try {
                const result = await updateTranslationMemoryEntry(request.key, request.patch || {});
                sendResponse({ success: !!result.updated, ...result });
            } catch (e) {
                sendResponse({ success: false, error: e.message });
            }
        })();
        return true;
    } else if (request.type === 'TRIGGER_RESTORE_DOCUMENT') {
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
            if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: 'TRIGGER_RESTORE_DOCUMENT' });
        });
        sendResponse({ success: true });
    } else if (request.type === 'TRIGGER_EXPORT_DOCUMENT') {
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
            if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: 'TRIGGER_EXPORT_DOCUMENT' });
        });
        sendResponse({ success: true });
    } else if (request.type === 'SETTINGS_UPDATED') {
        TRANSLATION_CACHE.clear();
        sendResponse({ success: true });
    }
});

// 5.1 VALIDATION HELPER
function isValidRequest(request) {
    if (!request || typeof request !== 'object') return false;

    if (request.type === 'REQUEST_TASK_TRANSLATE') {
        if (!request.text || typeof request.text !== 'string') return false;
        if (request.text.length > 10000) return false;
        if (!['google', 'deepseek', 'deepl', 'openai', 'multi'].includes(request.engine)) return false;
        if (!request.targetLang || typeof request.targetLang !== 'string') return false;
    }

    if (request.type === 'REQUEST_BATCH_TRANSLATE') {
        if (!Array.isArray(request.texts) || request.texts.length > 100) return false;
        if (request.texts.some(text => typeof text !== 'string' || text.length > 5000)) return false;
    }

    return true;
}

// 5.2 CACHE MANAGEMENT
function cleanupCache() {
    if (TRANSLATION_CACHE.size > MAX_CACHE_SIZE) {
        const entries = Array.from(TRANSLATION_CACHE.entries());
        const entriesToRemove = entries.slice(0, Math.floor(MAX_CACHE_SIZE * 0.3));
        for (const [key] of entriesToRemove) {
            TRANSLATION_CACHE.delete(key);
        }
    }
}

// 6. TRANSLATION & AI LOGIC

/**
 * Get stored settings including API keys and user-selected model.
 */
async function getSettings() {
    return chrome.storage.local.get({
        deepseekKey: '',
        openaiKey: '',
        deeplKey: '',
        translationModel: '',
        glossaryEnabled: true,
        termGlossary: [],
        tmFuzzyEnabled: true,
        tmFuzzyThreshold: 0.82
    });
}

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeGlossary(glossary) {
    if (!Array.isArray(glossary)) return [];
    return glossary
        .map(item => {
            if (!item || typeof item !== 'object') return null;
            const source = (item.source || '').trim();
            const target = (item.target || '').trim();
            if (!source || !target) return null;
            return { source, target };
        })
        .filter(Boolean)
        .sort((a, b) => b.source.length - a.source.length);
}

function applyGlossaryToTranslation(text, glossary) {
    if (!text || !Array.isArray(glossary) || glossary.length === 0) return text;
    let output = text;

    for (const item of glossary) {
        const source = item.source;
        const target = item.target;
        const hasAsciiWord = /^[\w\- ]+$/.test(source);
        if (hasAsciiWord) {
            const pattern = new RegExp(`\\b${escapeRegExp(source)}\\b`, 'gi');
            output = output.replace(pattern, target);
        } else {
            output = output.split(source).join(target);
        }
    }

    return output;
}

/**
 * Translate text and send result back to the content script tab.
 * Returns the translated text for callers that need the result.
 */
async function translateText(text, tabId, options) {
    requestCount++;

    try {
        const { engine, targetLang = 'zh-CN', mode, profile = 'default', context = '', taskId = '' } = options;
        if (taskId && isTaskCanceled(taskId)) {
            throw new Error('任务已取消');
        }
        const runtimeSettings = await getSettings();

        if (taskId) {
            emitTaskEvent(tabId, taskId, 'TASK_PROGRESS', {
                stage: 'running',
                percent: 5,
                mode: mode || 'translate'
            });
        }

        const tmHit = await lookupTranslationMemory(text, targetLang, {
            fuzzyEnabled: runtimeSettings.tmFuzzyEnabled,
            threshold: runtimeSettings.tmFuzzyThreshold
        });
        if (tmHit?.translated) {
            if (taskId && isTaskCanceled(taskId)) {
                throw new Error('任务已取消');
            }
            if (taskId) {
                emitTaskEvent(tabId, taskId, 'TASK_RESULT', {
                    original: text,
                    translated: tmHit.translated,
                    mode: mode || 'translate',
                    detectedLang: null,
                    fallbackEngine: tmHit.matchType === 'fuzzy' ? `tm-fuzzy(${tmHit.score})` : 'tm'
                });
                emitTaskDone(tabId, taskId, 'success', { source: 'tm' });
            } else {
                chrome.tabs.sendMessage(tabId, {
                    type: 'SHOW_TRANSLATION',
                    payload: {
                        original: text,
                        translated: tmHit.translated,
                        mode: mode || 'translate',
                        detectedLang: null,
                        fallbackEngine: tmHit.matchType === 'fuzzy' ? `tm-fuzzy(${tmHit.score})` : 'tm'
                    }
                });
            }
            return tmHit.translated;
        }

        const cacheKey = getCacheKey(text, engine, targetLang);
        if (TRANSLATION_CACHE.has(cacheKey)) {
            const cached = TRANSLATION_CACHE.get(cacheKey);
            if (taskId && isTaskCanceled(taskId)) {
                throw new Error('任务已取消');
            }
            if (taskId) {
                emitTaskEvent(tabId, taskId, 'TASK_RESULT', {
                    original: text,
                    translated: cached.text,
                    mode: mode || 'translate',
                    detectedLang: cached.detectedLang,
                    fallbackEngine: cached.fallbackEngine
                });
                emitTaskDone(tabId, taskId, 'success', { source: 'cache' });
            } else {
                chrome.tabs.sendMessage(tabId, {
                    type: 'SHOW_TRANSLATION',
                    payload: { original: text, translated: cached.text, mode: mode || 'translate', detectedLang: cached.detectedLang, fallbackEngine: cached.fallbackEngine }
                });
            }
            return cached.text;
        }

        let result;

        if (engine === 'multi') {
            const fused = await fuseMultipleEngines(text, targetLang, profile, context);
            result = { text: fused, detectedLang: null };
        } else {
            result = await translateSingle(text, { engine, targetLang, profile, context });
        }

        const translatedText = typeof result === 'object' ? result.text : result;
        const detectedLang = typeof result === 'object' ? result.detectedLang : null;
        const fallbackEngine = typeof result === 'object' ? result.fallbackEngine : null;

        if (taskId && isTaskCanceled(taskId)) {
            throw new Error('任务已取消');
        }

        if (translatedText && translatedText.length > 0) {
            if (TRANSLATION_CACHE.size >= MAX_CACHE_SIZE) {
                const firstKey = TRANSLATION_CACHE.keys().next().value;
                TRANSLATION_CACHE.delete(firstKey);
            }
            TRANSLATION_CACHE.set(cacheKey, { text: translatedText, detectedLang, fallbackEngine });
        }

        // Save to translation history
        saveToHistory(text, translatedText, engine, targetLang, detectedLang);

        if (taskId) {
            emitTaskEvent(tabId, taskId, 'TASK_RESULT', {
                original: text,
                translated: translatedText,
                mode: mode || 'translate',
                detectedLang,
                fallbackEngine
            });
            emitTaskDone(tabId, taskId, 'success', { source: 'engine' });
        } else {
            chrome.tabs.sendMessage(tabId, {
                type: 'SHOW_TRANSLATION',
                payload: { original: text, translated: translatedText, mode: mode || 'translate', detectedLang, fallbackEngine }
            });
        }

        return translatedText;
    } catch (e) {
        errorCount++;
        console.error('Translation error:', e);
        if (options.taskId) {
            emitTaskEvent(tabId, options.taskId, 'TASK_ERROR', normalizeErrorForUI(e));
            emitTaskDone(tabId, options.taskId, 'failed', { reason: e.message || 'Translation failed' });
        } else {
            chrome.tabs.sendMessage(tabId, { type: 'SHOW_ERROR', payload: normalizeErrorForUI(e) });
        }
        throw e;
    }
}

/**
 * Save translation to history (max 50 entries).
 */
async function saveToHistory(original, translated, engine, targetLang, detectedLang) {
    try {
        await saveTranslationMemory(original, targetLang, translated);

        const data = await chrome.storage.local.get({ translationHistory: [] });
        const history = data.translationHistory;
        history.unshift({
            original: original.substring(0, 500),
            translated: (translated || '').substring(0, 500),
            engine,
            targetLang,
            detectedLang,
            timestamp: Date.now()
        });
        if (history.length > 50) history.length = 50;
        await chrome.storage.local.set({ translationHistory: history });
    } catch (e) {
        console.debug('Failed to save history:', e);
    }
}

/**
 * Translate a single text segment and return the result directly (no tab messaging).
 * Returns { text, detectedLang } when possible.
 * Auto-falls back to Google Translate if configured engine fails.
 */
async function translateSingle(text, options) {
    const { engine, targetLang = 'zh-CN', profile = 'default', context = '' } = options;
    const settings = await getSettings();
    const glossary = settings.glossaryEnabled === false ? [] : normalizeGlossary(settings.termGlossary);

    // Auto language direction: if text looks like it's already in the target language,
    // flip to English (or the opposite direction)
    let effectiveTargetLang = targetLang;
    const autoDetected = await detectLanguageQuick(text);
    if (autoDetected && autoDetected === targetLang.split('-')[0]) {
        effectiveTargetLang = (targetLang.startsWith('zh') || targetLang === 'ja' || targetLang === 'ko') ? 'en' : 'zh-CN';
    }

    try {
        if (engine === 'google') {
            const result = await translateWithGoogle(text, effectiveTargetLang);
            return { text: applyGlossaryToTranslation(result.text, glossary), detectedLang: result.detectedLang };
        } else if (engine === 'deepl') {
            const result = await translateWithDeepL(text, settings.deeplKey, effectiveTargetLang);
            return { text: applyGlossaryToTranslation(result, glossary), detectedLang: null };
        } else if (engine === 'deepseek') {
            const prompt = buildPrompt(profile, effectiveTargetLang, context);
            const model = settings.translationModel || 'deepseek-chat';
            const result = await translateWithDeepSeek(text, settings.deepseekKey, prompt, model);
            return { text: applyGlossaryToTranslation(result, glossary), detectedLang: null };
        } else if (engine === 'openai') {
            const prompt = buildPrompt(profile, effectiveTargetLang, context);
            const model = settings.translationModel || 'gpt-4o';
            const result = await translateWithOpenAI(text, settings.openaiKey, model, prompt);
            return { text: applyGlossaryToTranslation(result, glossary), detectedLang: null };
        }
    } catch (e) {
        // Auto-fallback to Google Translate
        if (engine !== 'google') {
            console.warn(`${engine} failed, falling back to Google:`, e.message);
            try {
                const fallbackResult = await translateWithGoogle(text, effectiveTargetLang);
                return { text: applyGlossaryToTranslation(fallbackResult.text, glossary), detectedLang: fallbackResult.detectedLang, fallbackEngine: 'google' };
            } catch (fallbackErr) {
                throw e; // Re-throw original error if fallback also fails
            }
        }
        throw e;
    }

    const result = await translateWithGoogle(text, effectiveTargetLang);
    return { text: applyGlossaryToTranslation(result.text, glossary), detectedLang: result.detectedLang };
}

/**
 * Quick language detection based on character ranges (no API call).
 * Returns 'zh', 'ja', 'ko', 'en', 'ar', 'ru', or null.
 */
function detectLanguageQuick(text) {
    const sample = text.substring(0, 200);
    const cjkChars = (sample.match(/[\u4e00-\u9fff]/g) || []).length;
    const hiragana = (sample.match(/[\u3040-\u309f]/g) || []).length;
    const katakana = (sample.match(/[\u30a0-\u30ff]/g) || []).length;
    const hangul = (sample.match(/[\uac00-\ud7af]/g) || []).length;
    const latin = (sample.match(/[a-zA-Z]/g) || []).length;
    const cyrillic = (sample.match(/[\u0400-\u04ff]/g) || []).length;
    const arabic = (sample.match(/[\u0600-\u06ff]/g) || []).length;
    const total = sample.length || 1;

    if ((hiragana + katakana) / total > 0.1) return 'ja';
    if (hangul / total > 0.2) return 'ko';
    if (cjkChars / total > 0.2) return 'zh';
    if (cyrillic / total > 0.2) return 'ru';
    if (arabic / total > 0.2) return 'ar';
    if (latin / total > 0.4) return 'en';
    return null;
}

// Multi-engine fusion
async function fuseMultipleEngines(text, targetLang, profile = 'default', context = '') {
    const settings = await getSettings();
    const results = {};

    try {
        const googleResult = await translateWithGoogle(text, targetLang);
        results.google = googleResult.text;
    } catch (e) {
        console.warn('Google translation failed:', e);
    }

    if (settings.deeplKey) {
        try {
            results.deepl = await translateWithDeepL(text, settings.deeplKey, targetLang);
        } catch (e) {
            console.warn('DeepL translation failed:', e);
        }
    }

    if (settings.deepseekKey) {
        try {
            const prompt = buildPrompt(profile, targetLang, context);
            results.deepseek = await translateWithDeepSeek(text, settings.deepseekKey, prompt, "deepseek-chat");
        } catch (e) {
            console.warn('DeepSeek translation failed:', e);
        }
    }

    if (settings.openaiKey) {
        try {
            const prompt = buildPrompt(profile, targetLang, context);
            const model = settings.translationModel || 'gpt-4o';
            results.openai = await translateWithOpenAI(text, settings.openaiKey, model, prompt);
        } catch (e) {
            console.warn('OpenAI translation failed:', e);
        }
    }

    return fuseResults(results);
}

/**
 * Select the best result purely by ENGINE_WEIGHTS (no hardcoded overrides).
 */
function fuseResults(results) {
    const availableResults = Object.keys(results).filter(engine => results[engine]);

    if (availableResults.length === 0) {
        return "No translation engines available. Please check your API keys.";
    }

    if (availableResults.length === 1) {
        return results[availableResults[0]];
    }

    let bestResult = "";
    let bestWeight = -1;

    for (const engine of availableResults) {
        const weight = ENGINE_WEIGHTS[engine] || 0;
        if (weight > bestWeight) {
            bestWeight = weight;
            bestResult = results[engine];
        }
    }

    return bestResult || "Translation failed";
}

async function handleStreamTranslation(text, tabId, engine, targetLang, profile = 'default', context = '', taskId = '') {
    const streamId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    ACTIVE_STREAMS.add(streamId);
    let streamFailed = false;
    let taskDoneEmitted = false;

    if (!taskId) {
        ACTIVE_STREAMS.delete(streamId);
        return;
    }

    try {
        if (isTaskCanceled(taskId)) return;
        const settings = await getSettings();

        let apiKey = '';
        let model = '';

        if (engine === 'deepseek') {
            apiKey = settings.deepseekKey;
            model = settings.translationModel || 'deepseek-chat';
        } else if (engine === 'openai') {
            apiKey = settings.openaiKey;
            model = settings.translationModel || 'gpt-4o';
        } else if (engine === 'multi') {
            if (settings.deepseekKey) {
                apiKey = settings.deepseekKey;
                engine = 'deepseek';
                model = 'deepseek-chat';
            } else if (settings.openaiKey) {
                apiKey = settings.openaiKey;
                engine = 'openai';
                model = settings.translationModel || 'gpt-4o';
            } else {
                emitTaskEvent(tabId, taskId, 'TASK_ERROR', normalizeErrorForUI('Error: No API keys configured for streaming engines.'));
                emitTaskDone(tabId, taskId, 'failed', { reason: 'No API keys configured for streaming engines.' });
                taskDoneEmitted = true;
                return;
            }
        }

        if (!apiKey) {
            emitTaskEvent(tabId, taskId, 'TASK_ERROR', normalizeErrorForUI(`Error: Please configure ${engine} API Key in options.`));
            emitTaskDone(tabId, taskId, 'failed', { reason: `Please configure ${engine} API Key in options.` });
            taskDoneEmitted = true;
            return;
        }

        const systemPrompt = buildPrompt(profile, targetLang, context);

        emitTaskEvent(tabId, taskId, 'TASK_PROGRESS', { stage: 'start', original: text, percent: 10, mode: 'stream' });

        if (!ACTIVE_STREAMS.has(streamId)) return;
        if (isTaskCanceled(taskId)) return;

        if (engine === 'deepseek') {
            await streamDeepSeek(text, apiKey, systemPrompt, model, (chunk) => {
                if (ACTIVE_STREAMS.has(streamId)) {
                    emitTaskEvent(tabId, taskId, 'TASK_PROGRESS', { stage: 'streaming', chunk });
                }
            });
        } else if (engine === 'openai') {
            await streamOpenAI(text, apiKey, model, systemPrompt, (chunk) => {
                if (ACTIVE_STREAMS.has(streamId)) {
                    emitTaskEvent(tabId, taskId, 'TASK_PROGRESS', { stage: 'streaming', chunk });
                }
            });
        }

    } catch (e) {
        streamFailed = true;
        console.error('Stream translation error:', e);
        emitTaskEvent(tabId, taskId, 'TASK_ERROR', normalizeErrorForUI(e));
        emitTaskDone(tabId, taskId, 'failed', { reason: e.message || 'Stream translation failed', source: 'stream' });
        taskDoneEmitted = true;
    } finally {
        ACTIVE_STREAMS.delete(streamId);
        if (!streamFailed && !taskDoneEmitted) {
            if (isTaskCanceled(taskId)) {
                emitTaskDone(tabId, taskId, 'failed', {
                    reason: '任务已取消',
                    canceled: true,
                    source: 'stream'
                });
            } else {
                emitTaskDone(tabId, taskId, 'success', { source: 'stream' });
            }
        }
    }
}


// 7. API HELPERS (all use safeFetch for HTTP status checking)

async function translateWithGoogle(text, targetLang) {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
    const response = await safeFetch(url);
    const data = await response.json();
    const translated = data[0].map(item => item[0]).join('');
    const detectedLang = data[2] || 'auto';
    return { text: translated, detectedLang };
}

async function translateWithDeepL(text, apiKey, targetLang) {
    const host = apiKey.endsWith(':fx') ? 'api-free.deepl.com' : 'api.deepl.com';
    const lang = targetLang === 'zh-CN' ? 'ZH' : targetLang.toUpperCase();
    const response = await safeFetch(`https://${host}/v2/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `DeepL-Auth-Key ${apiKey}` },
        body: JSON.stringify({ text: [text], target_lang: lang })
    });
    const data = await response.json();
    return data.translations[0].text;
}

async function translateWithDeepSeek(text, apiKey, systemPrompt, model) {
    const response = await safeFetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
            model: model || "deepseek-chat",
            messages: [{ role: "system", content: systemPrompt }, { role: "user", content: text }]
        })
    });
    const data = await response.json();
    return data.choices[0].message.content;
}

async function translateWithOpenAI(text, apiKey, model, systemPrompt) {
    const response = await safeFetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
            model: model || "gpt-4o",
            messages: [{ role: "system", content: systemPrompt }, { role: "user", content: text }]
        })
    });
    const data = await response.json();
    return data.choices[0].message.content;
}

async function streamDeepSeek(text, apiKey, systemPrompt, model, onChunk) {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
            model: typeof model === 'string' ? model : "deepseek-chat",
            messages: [{ role: "system", content: systemPrompt }, { role: "user", content: text }],
            stream: true,
            max_tokens: 4096,
            temperature: 0.3
        })
    });
    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`DeepSeek stream error ${response.status}: ${body.substring(0, 200)}`);
    }
    await processStream(response, onChunk);
}

async function streamOpenAI(text, apiKey, model, systemPrompt, onChunk) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
            model: model || "gpt-4o",
            messages: [{ role: "system", content: systemPrompt }, { role: "user", content: text }],
            stream: true,
            max_tokens: 4096,
            temperature: 0.3
        })
    });
    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`OpenAI stream error ${response.status}: ${body.substring(0, 200)}`);
    }
    await processStream(response, onChunk);
}

async function processStream(response, onChunk) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let totalReceived = 0;
    const MAX_RESPONSE_SIZE = 10 * 1024 * 1024;

    try {
        while (true) {
            const { done, value } = await reader.read();

            if (value) {
                buffer += decoder.decode(value, { stream: !done });
                totalReceived += value.length;

                if (totalReceived > MAX_RESPONSE_SIZE) {
                    console.warn('Response exceeded size limit, stopping stream');
                    break;
                }
            }

            const lines = buffer.split('\n');
            buffer = done ? "" : (lines.pop() || "");

            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith('data: ') && trimmed !== 'data: [DONE]') {
                    try {
                        const jsonStr = trimmed.substring(6);
                        const json = JSON.parse(jsonStr);
                        const content = json.choices[0]?.delta?.content;
                        if (content) onChunk(content);
                    } catch (e) {
                        console.debug('Failed to parse JSON chunk:', e);
                    }
                }
            }

            if (done) break;
        }
    } finally {
        reader.releaseLock();
    }
}

/**
 * Batch translate with concurrency control (5 parallel requests).
 * Respects the engine parameter.
 */
async function translateBatch(texts, context, engine, targetLang) {
    const concurrency = 5;
    const results = new Array(texts.length);
    let index = 0;

    async function worker() {
        while (index < texts.length) {
            const i = index++;
            const result = await translateSingle(texts[i], { engine, targetLang, profile: 'default', context });
            results[i] = typeof result === 'object' ? result.text : result;
        }
    }

    const workers = [];
    for (let w = 0; w < Math.min(concurrency, texts.length); w++) {
        workers.push(worker());
    }
    await Promise.all(workers);

    return results;
}
