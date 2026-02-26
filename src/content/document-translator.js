/**
 * document-translator.js
 * Document translation functionality
 */

(function() {
    'use strict';

    try {
        class DocumentTranslator {
    constructor() {
        this.isTranslating = false;
        this.cancelRequested = false;
        this.currentProgress = 0;
        this.totalSegments = 0;
        this.processedSegments = 0;
        this.currentStage = 'idle';
        this.translationCache = new Map();
        this.maxCacheSize = 500;
        this.maxTranslateRetries = 1;
        this.taskTimeoutMs = 45000;
        this.pdfNewlinesEnabled = true;
        this.bigDocPerformanceMode = true;
        this.baseBatchSize = 8;
        this.maxParallelRequests = 4;
        this.isPdfViewerPage = /\/src\/pdf\/web\/academic-viewer\.html$/i.test(window.location.pathname || '');
    }

    async translateDocument(targetLang = 'zh-CN', engine = 'google', bilingual = false) {
        if (this.isTranslating) {
            throw new Error('Document translation already in progress');
        }

        this.isTranslating = true;
        this.cancelRequested = false;
        this.currentStage = 'extracting';
        this.currentProgress = 0;
        this.processedSegments = 0;
        this.bilingualMode = bilingual;
        this.pdfNewlinesEnabled = await this.loadPdfNewlinesSetting();
        await this.loadPerformanceSettings();

        try {
            const segments = this.extractTextSegments();
            this.totalSegments = segments.length;

            if (segments.length === 0) {
                throw new Error('No translatable content found in document');
            }

            const batchSize = this.getAdaptiveBatchSize(segments.length);
            const parallel = this.getAdaptiveParallel(segments.length);
            const results = [];
            this.currentStage = 'translating';

            for (let i = 0; i < segments.length; i += batchSize) {
                if (this.cancelRequested) {
                    throw new Error('DOCUMENT_TRANSLATION_CANCELED');
                }

                const batch = segments.slice(i, i + batchSize);

                const batchResults = await this.translateBatchWithConcurrency(batch, targetLang, engine, i, segments, parallel);

                results.push(...batchResults);

                this.processedSegments += batch.length;
                this.currentProgress = (this.processedSegments / this.totalSegments) * 100;

                await this.delay(this.bigDocPerformanceMode ? 120 : 80);
            }

            if (this.cancelRequested) {
                throw new Error('DOCUMENT_TRANSLATION_CANCELED');
            }

            this.currentStage = 'applying';
            this.applyTranslations(results);
            this.currentStage = 'completed';

            return {
                success: true,
                segmentsProcessed: results.length,
                progress: 100
            };
        } catch (error) {
            console.error('Document translation failed:', error);
            throw error;
        } finally {
            this.isTranslating = false;
            if (this.currentStage !== 'completed') {
                this.currentStage = this.cancelRequested ? 'canceled' : 'idle';
            }
        }
    }

    getAdaptiveBatchSize(totalSegments) {
        if (!this.bigDocPerformanceMode) {
            return Math.max(4, Number(this.baseBatchSize || 8));
        }
        if (totalSegments >= 300) return 3;
        if (totalSegments >= 180) return 4;
        if (totalSegments >= 80) return 6;
        return Math.max(4, Number(this.baseBatchSize || 8));
    }

    getAdaptiveParallel(totalSegments) {
        if (!this.bigDocPerformanceMode) {
            return Math.max(2, Number(this.maxParallelRequests || 4));
        }
        if (totalSegments >= 300) return 2;
        if (totalSegments >= 120) return 3;
        return Math.max(2, Number(this.maxParallelRequests || 4));
    }

    async translateBatchWithConcurrency(batch, targetLang, engine, startIndex, allSegments, parallel = 3) {
        const results = new Array(batch.length);
        let nextIndex = 0;
        const workerCount = Math.max(1, Math.min(parallel, batch.length));

        const workers = Array.from({ length: workerCount }, async () => {
            while (nextIndex < batch.length) {
                if (this.cancelRequested) {
                    throw new Error('DOCUMENT_TRANSLATION_CANCELED');
                }
                const current = nextIndex;
                nextIndex += 1;
                const segment = batch[current];
                results[current] = await this.translateSegment(segment, targetLang, engine, startIndex + current, allSegments);
            }
        });

        await Promise.all(workers);
        return results;
    }

    /**
     * Extract text segments from the document.
     * Uses a Set to deduplicate elements found by multiple selectors.
     */
    extractTextSegments() {
        const segments = [];
        const seen = new Set();

        // Prefer semantic/structural selectors over generic ones
        const selectors = [
            'article p', 'main p', '[role="main"] p',
            'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
            'p', 'li', 'td', 'th', 'caption',
            'blockquote', 'figcaption'
        ];

        for (const selector of selectors) {
            const elements = document.querySelectorAll(selector);
            for (const element of elements) {
                if (seen.has(element)) continue;
                seen.add(element);

                if (this.isLikelyUIElement(element)) continue;

                // Only grab leaf-level text: skip if children contain
                // elements that are also in our selector list
                if (this._hasTranslatableChildren(element, seen)) continue;

                const text = element.textContent || '';
                const normalizedForTranslation = this.normalizeTextForTranslation(text);
                if (normalizedForTranslation.length > 10 && normalizedForTranslation.length < 2000) {
                    segments.push({
                        element: element,
                        originalText: text.trim(),
                        textForTranslation: normalizedForTranslation,
                        originalHTML: element.innerHTML
                    });
                }
            }
        }

        return segments;
    }

    /**
     * Check if element has child elements that we'd also select (avoid double-translating).
     */
    _hasTranslatableChildren(element, seen) {
        const children = element.querySelectorAll('p, li, td, th, h1, h2, h3, h4, h5, h6');
        for (const child of children) {
            if (child !== element && !seen.has(child)) {
                return true;
            }
        }
        return false;
    }

    async translateSegment(segment, targetLang, engine, segmentIndex = 0, allSegments = []) {
        const textToTranslate = segment.textForTranslation || segment.originalText || '';
        const context = this.buildSegmentContext(segmentIndex, allSegments);

        const cacheKey = this.getCacheKey(textToTranslate, targetLang, engine);
        if (this.translationCache.has(cacheKey)) {
            return {
                ...segment,
                translatedText: this.translationCache.get(cacheKey),
                cached: true
            };
        }

        try {
            const translatedText = await this.requestTranslationWithRetry(textToTranslate, targetLang, engine, context);

            this.addToCache(cacheKey, translatedText);

            return {
                ...segment,
                translatedText: translatedText,
                cached: false
            };
        } catch (error) {
            const safeOriginal = String(segment.originalText || '').substring(0, 50);
            console.error(`Failed to translate segment: ${safeOriginal}...`, error);
            return {
                ...segment,
                translatedText: segment.originalText,
                cached: false,
                error: error.message
            };
        }
    }

    /**
     * Request translation from background service using unified task-event protocol.
     */
    async requestTranslation(text, targetLang, engine, context = '') {
        return new Promise((resolve, reject) => {
            if (typeof Utils !== 'undefined' && !Utils.isExtensionContextValid()) {
                reject(new Error('扩展已更新，请刷新页面后重试。'));
                return;
            }

            let taskId = '';
            let settled = false;
            let timeoutId = null;

            const cleanup = () => {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }
                if (typeof Utils !== 'undefined' && Utils.isExtensionContextValid()) {
                    chrome.runtime.onMessage.removeListener(onTaskEvent);
                }
            };

            const finishResolve = (value) => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve(value);
            };

            const finishReject = (error) => {
                if (settled) return;
                settled = true;
                cleanup();
                reject(error);
            };

            const onTaskEvent = (msg) => {
                if (!msg || msg.type !== 'TASK_EVENT') return;
                if (!taskId || msg.taskId !== taskId) return;

                if (msg.event === 'TASK_RESULT') {
                    finishResolve(msg.payload?.translated || '');
                } else if (msg.event === 'TASK_ERROR') {
                    finishReject(new Error(msg.payload?.message || 'Translation failed'));
                } else if (msg.event === 'TASK_DONE' && msg.payload?.status === 'failed') {
                    finishReject(new Error('Translation failed'));
                }
            };

            chrome.runtime.onMessage.addListener(onTaskEvent);

            chrome.runtime.sendMessage({
                type: 'REQUEST_TASK_TRANSLATE',
                text,
                targetLang,
                engine,
                mode: 'document',
                stream: false,
                profile: 'academic',
                context
            }, (response) => {
                if (chrome.runtime.lastError) {
                    finishReject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                if (response && response.success) {
                    taskId = response.taskId || '';
                    if (!taskId) {
                        finishReject(new Error('Task id missing'));
                        return;
                    }

                    timeoutId = setTimeout(() => {
                        finishReject(new Error('文档翻译任务超时，请重试。'));
                    }, this.taskTimeoutMs);
                } else {
                    finishReject(new Error((response && response.error) || 'Translation failed'));
                }
            });
        });
    }

    async requestTranslationWithRetry(text, targetLang, engine, context = '') {
        let attempt = 0;
        let lastError = null;

        while (attempt <= this.maxTranslateRetries) {
            try {
                return await this.requestTranslation(text, targetLang, engine, context);
            } catch (error) {
                lastError = error;
                attempt += 1;
                if (attempt > this.maxTranslateRetries) break;
                await this.delay(120 * attempt);
            }
        }

        throw lastError || new Error('Translation failed');
    }

    buildSegmentContext(segmentIndex, allSegments) {
        if (!Array.isArray(allSegments) || allSegments.length === 0) return '';

        const prev = allSegments[segmentIndex - 1]?.textForTranslation || allSegments[segmentIndex - 1]?.originalText || '';
        const next = allSegments[segmentIndex + 1]?.textForTranslation || allSegments[segmentIndex + 1]?.originalText || '';
        const prevSlice = String(prev).trim().slice(0, 240);
        const nextSlice = String(next).trim().slice(0, 240);

        const parts = [];
        if (prevSlice) parts.push(`Previous paragraph: ${prevSlice}`);
        if (nextSlice) parts.push(`Next paragraph: ${nextSlice}`);
        return parts.join(' | ');
    }

    /**
     * Apply translations. In bilingual mode, inserts translation below original.
     * In replace mode, replaces original text.
     */
    applyTranslations(results) {
        for (const result of results) {
            if (result.element && result.translatedText && !result.error) {
                result.element.setAttribute('data-original-html', result.originalHTML);
                result.element.setAttribute('data-original-text', result.originalText);

                if (this.bilingualMode) {
                    // Bilingual: insert translation node below original
                    const translationNode = document.createElement(result.element.tagName);
                    translationNode.className = 'xiaoet-bilingual-translation';
                    translationNode.textContent = result.translatedText;
                    translationNode.style.cssText = 'color: #4136f1; border-left: 3px solid #4136f1; padding-left: 8px; margin-top: 4px; font-style: italic; opacity: 0.9;';
                    translationNode.setAttribute('data-xiaoet-bilingual', 'true');
                    result.element.after(translationNode);
                } else {
                    // Replace mode: overwrite text (safe: leaf elements only)
                    result.element.textContent = result.translatedText;
                }
            }
        }
    }

    restoreOriginalText() {
        // Remove bilingual translation nodes
        const bilingualNodes = document.querySelectorAll('[data-xiaoet-bilingual]');
        for (const node of bilingualNodes) {
            node.remove();
        }

        // Restore replaced elements
        const elements = document.querySelectorAll('[data-original-html]');
        for (const element of elements) {
            const originalHTML = element.getAttribute('data-original-html');
            if (originalHTML !== null) {
                element.innerHTML = originalHTML;
                element.removeAttribute('data-original-html');
                element.removeAttribute('data-original-text');
            }
        }
    }

    getProgress() {
        return {
            isTranslating: this.isTranslating,
            progress: this.currentProgress,
            processed: this.processedSegments,
            total: this.totalSegments,
            stage: this.currentStage,
            cancelRequested: this.cancelRequested
        };
    }

    cancelTranslation() {
        if (!this.isTranslating) return false;
        this.cancelRequested = true;
        this.currentStage = 'canceling';
        return true;
    }

    /**
     * Check if an element is likely a UI control.
     * Handles SVG elements where className is an SVGAnimatedString.
     */
    isLikelyUIElement(element) {
        const uiClassNames = [
            'button', 'btn', 'nav', 'navigation', 'menu', 'footer',
            'header', 'sidebar', 'advertisement', 'ad', 'cookie',
            'modal', 'popup', 'overlay', 'tooltip', 'dropdown',
            'search', 'input', 'form', 'label'
        ];

        const rawClassName = element.className;
        const className = (typeof rawClassName === 'string' ? rawClassName : (rawClassName?.baseVal || '')).toLowerCase();
        const tagName = element.tagName.toLowerCase();

        for (const name of uiClassNames) {
            if (className.includes(name)) return true;
        }

        return ['nav', 'footer', 'header', 'aside', 'script', 'style'].includes(tagName);
    }

    /**
     * Cache key uses full-text hash via Utils.simpleHash.
     */
    getCacheKey(text, targetLang, engine) {
        const hash = (typeof Utils !== 'undefined' && Utils.simpleHash)
            ? Utils.simpleHash(text)
            : this._fallbackHash(text);
        return `${hash}_${engine}_${targetLang}`;
    }

    _fallbackHash(str) {
        let hash = 5381;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
        }
        return Math.abs(hash).toString(36);
    }

    addToCache(key, value) {
        if (this.translationCache.size >= this.maxCacheSize) {
            const firstKey = this.translationCache.keys().next().value;
            this.translationCache.delete(firstKey);
        }
        this.translationCache.set(key, value);
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async loadPdfNewlinesSetting() {
        if (typeof Utils === 'undefined' || typeof Utils.getSettings !== 'function') {
            return true;
        }

        return new Promise((resolve) => {
            Utils.getSettings({ pdfNewlines: true }, (items) => {
                resolve(items?.pdfNewlines !== false);
            });
        });
    }

    async loadPerformanceSettings() {
        if (typeof Utils === 'undefined' || typeof Utils.getSettings !== 'function') {
            return;
        }

        return new Promise((resolve) => {
            Utils.getSettings({
                bigDocPerformanceMode: true,
                documentBatchSize: 8,
                documentParallelRequests: 4
            }, (items) => {
                this.bigDocPerformanceMode = items?.bigDocPerformanceMode !== false;
                this.baseBatchSize = Math.max(3, Math.min(12, Number(items?.documentBatchSize || 8)));
                this.maxParallelRequests = Math.max(1, Math.min(8, Number(items?.documentParallelRequests || 4)));
                resolve();
            });
        });
    }

    normalizeTextForTranslation(text) {
        const base = String(text || '').trim();
        if (!base) return '';

        // Only apply newline healing in PDF viewer when the option is enabled.
        if (!(this.isPdfViewerPage && this.pdfNewlinesEnabled)) {
            return base;
        }

        return base
            .replace(/(\w)-\s*\n\s*(\w)/g, '$1$2')
            .replace(/[\r\n]+/g, ' ')
            .replace(/\s{2,}/g, ' ')
            .trim();
    }
}

        window.DocumentTranslator = DocumentTranslator;

    } catch (error) {
        console.error('FATAL ERROR in document-translator.js:', error);
    }
})();
