/**
 * main.js
 * Entry point, Event Coordination
 */

const MESSAGE_TYPES = {
    TASK_EVENT: 'TASK_EVENT',
    TRIGGER_SHORTCUT: 'TRIGGER_SHORTCUT',
    TRIGGER_DOCUMENT_TRANSLATE: 'TRIGGER_DOCUMENT_TRANSLATE',
    TRIGGER_IMAGE_OCR: 'TRIGGER_IMAGE_OCR',
    TRIGGER_RESTORE_DOCUMENT: 'TRIGGER_RESTORE_DOCUMENT',
    TRIGGER_EXPORT_DOCUMENT: 'TRIGGER_EXPORT_DOCUMENT',
    SHOW_TRANSLATION: 'SHOW_TRANSLATION',
    SHOW_ERROR: 'SHOW_ERROR'
};

// Initialize modules (loaded synchronously via manifest.json content_scripts)
let ui = null;
if (typeof window.TranslatorUI !== 'undefined') {
    ui = new window.TranslatorUI();
} else {
    console.error("TranslatorUI is not defined!");
}

let adapter = null;
if (typeof window.ContentAdapter !== 'undefined') {
    try {
        adapter = new window.ContentAdapter();
    } catch (e) {
        console.error('Failed to initialize ContentAdapter:', e);
    }
}

let contextProcessor = null;
if (typeof window.ContextProcessor !== 'undefined') {
    try {
        contextProcessor = new window.ContextProcessor();
    } catch (e) {
        console.error('Failed to initialize ContextProcessor:', e);
    }
}

let documentTranslator = null;
if (typeof window.DocumentTranslator !== 'undefined') {
    try {
        documentTranslator = new window.DocumentTranslator();
    } catch (e) {
        console.error('Failed to initialize DocumentTranslator:', e);
    }
}

let ocrTranslator = null;
if (typeof window.OCRTranslator !== 'undefined') {
    try {
        ocrTranslator = window.__xiaoetOcrTranslator || new window.OCRTranslator();
        window.__xiaoetOcrTranslator = ocrTranslator;
        // Do NOT call initialize() here — Tesseract.js creates blob: Workers
        // which are blocked by CSP on sites like GitHub. Initialization is
        // deferred to the first actual OCR request (in handleImageOCR).
    } catch (e) {
        console.error('Failed to create OCRTranslator:', e);
    }
}

// Cleanup OCR worker on page unload
window.addEventListener('beforeunload', () => {
    if (ocrTranslator && typeof ocrTranslator.destroy === 'function') {
        ocrTranslator.destroy();
    }
});

if (!ui) {
    console.error("Critical error: UI not available, terminating initialization.");
} else {
    const state = {
        selection: "",
        lastRect: null,
        settings: {},
        isDocumentTranslating: false,
        progressTimer: null,
        activeTaskId: '',
        activeTaskMode: ''
    };

    function showNotice(message, level = 'info') {
        if (typeof ui.showToast === 'function') {
            ui.showToast(message, level);
            return;
        }
        if (typeof ui.setTaskState === 'function') {
            ui.setTaskState(message, level);
        }
    }

    // Load initial settings (including dark mode)
    Utils.getSettings({
        translationEngine: 'google',
        targetLang: 'zh-CN',
        promptProfile: 'default',
        isDarkMode: false,
        onboardingCompleted: false
    }, (items) => {
        state.settings = items;
        if (items.translationEngine) ui.engine = items.translationEngine;
        if (items.targetLang) ui.targetLang = items.targetLang;
        // Sync dark mode to ShadowDOM host
        applyDarkMode(items.isDarkMode);

        if (!items.onboardingCompleted) {
            showNotice('欢迎使用学术大拿：选中文本可翻译，Alt+Shift+X（或 Ctrl+Shift+X）快捷翻译，设置页可配置引擎。', 'info');
            Utils.setSettings({ onboardingCompleted: true });
        }
    });

    // Live settings sync: listen for settings changes from other tabs/options page
    if (Utils.isExtensionContextValid()) {
        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName !== 'local') return;
            for (const [key, { newValue }] of Object.entries(changes)) {
                state.settings[key] = newValue;
                if (key === 'translationEngine' && ui) ui.engine = newValue;
                if (key === 'targetLang' && ui) ui.targetLang = newValue;
                if (key === 'isDarkMode') applyDarkMode(newValue);
            }
        });
    }

    function applyDarkMode(isDark) {
        if (ui && ui.host) {
            if (isDark) {
                ui.host.classList.add('dark-mode');
            } else {
                ui.host.classList.remove('dark-mode');
            }
        }
    }

    // --- Message Listeners ---
    if (Utils.isExtensionContextValid()) {
        chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.type === MESSAGE_TYPES.TASK_EVENT) {
            handleTaskEvent(msg);
        }
        if (msg.type === MESSAGE_TYPES.TRIGGER_SHORTCUT) {
            const shortcutSelection = getSelectionText();
            if (shortcutSelection) {
                state.selection = shortcutSelection;
            }
            handleTranslationParams(state.selection || shortcutSelection);
        }
        else if (msg.type === MESSAGE_TYPES.TRIGGER_DOCUMENT_TRANSLATE) {
            handleDocumentTranslation();
        }
        else if (msg.type === MESSAGE_TYPES.TRIGGER_IMAGE_OCR) {
            if (msg.imageUrl) {
                const targetImage = Array.from(document.images || []).find(img => img.src === msg.imageUrl);
                if (targetImage) {
                    handleImageOCR(targetImage);
                } else {
                    ui.showError('未找到目标图片，请在图片所在页面重试。');
                }
            }
        }
        else if (msg.type === MESSAGE_TYPES.TRIGGER_RESTORE_DOCUMENT) {
            if (documentTranslator) {
                documentTranslator.restoreOriginalText();
                state.isDocumentTranslating = false;
                stopProgressPolling();
                showNotice('文档已恢复为原文', 'success');
            } else {
                ui.showError('文档恢复功能暂不可用，请刷新页面重试。');
            }
        }
        else if (msg.type === MESSAGE_TYPES.TRIGGER_EXPORT_DOCUMENT) {
            exportTranslatedDocument();
        }
        else if (msg.type === MESSAGE_TYPES.SHOW_TRANSLATION) {
            ui.showResult(
                msg.payload.original,
                msg.payload.translated,
                msg.payload.mode,
                msg.payload.detectedLang,
                msg.payload.fallbackEngine
            );
        }
        else if (msg.type === MESSAGE_TYPES.SHOW_ERROR) {
            // Show error in card UI instead of just console
            ui.showError(msg.payload);
        }
    });
    } // end if (Utils.isExtensionContextValid())

    function getSelectionText() {
        const selection = window.getSelection();
        const rawText = selection ? selection.toString().trim() : '';
        return Utils.validateAndSanitize(rawText, 5000);
    }

    function handleTaskEvent(msg) {
        if (!msg || !msg.taskId || msg.taskId !== state.activeTaskId) return;
        const payload = msg.payload || {};

        if (msg.event === 'TASK_CREATED') {
            state.activeTaskMode = payload.mode || '';
            if (typeof ui.setCancelable === 'function') {
                ui.setCancelable(true, msg.taskId);
            }
            if (typeof ui.setTaskState === 'function') ui.setTaskState('任务已创建', 'info');
            ui.setPendingRect(state.lastRect);
            if (payload.stream) {
                ui.startStream(payload.original || state.selection || '');
            } else {
                ui.showLoading(true, state.lastRect);
            }
        } else if (msg.event === 'TASK_PROGRESS') {
            if (typeof ui.setTaskState === 'function') ui.setTaskState('翻译进行中…', 'info');
            if (typeof payload.chunk === 'string') {
                ui.appendStreamChunk(payload.chunk);
            }
            if (typeof payload.percent === 'number') {
                ui.updateProgress(payload.percent);
            }
        } else if (msg.event === 'TASK_RESULT') {
            if (typeof ui.setTaskState === 'function') ui.setTaskState('已完成', 'success');
            ui.showResult(
                payload.original,
                payload.translated,
                payload.mode,
                payload.detectedLang,
                payload.fallbackEngine
            );
        } else if (msg.event === 'TASK_ERROR') {
            if (typeof ui.setTaskState === 'function') ui.setTaskState('任务失败', 'error');
            ui.showError(payload);
        } else if (msg.event === 'TASK_DONE') {
            if (payload.status === 'failed') {
                if (typeof ui.setTaskState === 'function') ui.setTaskState('任务失败', 'error');
                if (!ui.streamActive && !payload.canceled) {
                    ui.showError('翻译任务失败，请稍后重试。');
                }
            }
            ui.endStream();
            state.activeTaskId = '';
            state.activeTaskMode = '';
            if (typeof ui.setCancelable === 'function') {
                ui.setCancelable(false, '');
            }
        }
    }

    // --- Re-Translate Event from UI ---
    document.addEventListener('xiaoet:retranslate', (e) => {
        const { text, engine, targetLang } = e.detail;
        requestTranslation(text, engine, targetLang);
    });

    document.addEventListener('xiaoet:cancel-task', (e) => {
        const taskId = e?.detail?.taskId || state.activeTaskId;
        if (!taskId || !Utils.isExtensionContextValid()) return;
        chrome.runtime.sendMessage({
            type: 'REQUEST_CANCEL_TASK',
            taskId,
            reason: '用户在页面取消任务'
        }, () => {
            showNotice('已请求取消当前任务', 'info');
        });
    });

    document.addEventListener('xiaoet:cancel-document', () => {
        if (!documentTranslator || !state.isDocumentTranslating) return;
        documentTranslator.cancelTranslation();
        showNotice('正在取消文档翻译…', 'info');
    });

    // --- PDF Text Selection Event ---
    document.addEventListener('xiaoetPdfTextSelected', (e) => {
        const { text, x, y } = e.detail;
        if (text && typeof ui.showIcon === 'function') {
            ui.showIcon(x, y, () => {
                handleTranslationParams(text);
            });
        }
    });

    // --- Mouse Interaction ---
    document.addEventListener('mouseup', (e) => {
        if (ui.host && ui.host.contains(e.target)) return;

        setTimeout(async () => {
            const sel = window.getSelection();
            let text = sel.toString().trim();
            text = Utils.validateAndSanitize(text, 5000);

            if (text.length > 0 && sel.rangeCount > 0) {
                state.selection = text;

                let context = '';
                if (contextProcessor) {
                    try {
                        context = await contextProcessor.extractContext(sel, {
                            includeParagraphs: true,
                            includeHeaders: true,
                            includeAdjacentElements: true
                        });
                    } catch (err) {
                        context = '';
                    }
                } else if (adapter) {
                    try {
                        context = adapter.getContextAroundSelection(sel);
                    } catch (err) {
                        context = '';
                    }
                }

                const range = sel.getRangeAt(0);
                const rect = range.getBoundingClientRect();
                state.lastRect = {
                    left: rect.left, top: rect.top, right: rect.right,
                    bottom: rect.bottom, width: rect.width, height: rect.height
                };

                ui.showIcon(e.clientX, e.clientY, () => {
                    handleTranslationParams(text, state.lastRect, context);
                });
            } else {
                ui.hideIcon();
            }
        }, 10);
    });

    document.addEventListener('mousedown', (e) => {
        if (ui.icon && ui.host && !ui.host.contains(e.target)) {
            ui.hideIcon();
        }
    });

    // --- Keyboard Shortcuts ---
    document.addEventListener('keydown', (e) => {
        const key = (e.key || '').toLowerCase();
        const isSelectionShortcut = (e.shiftKey && e.altKey && (key === 'x' || e.code === 'KeyX')) || (e.shiftKey && e.ctrlKey && !e.altKey && (key === 'x' || e.code === 'KeyX'));
        const isDocumentShortcut = (e.shiftKey && e.altKey && (key === 'd' || e.code === 'KeyD')) || (e.shiftKey && e.ctrlKey && !e.altKey && (key === 'd' || e.code === 'KeyD'));

        if (isSelectionShortcut) {
            e.preventDefault();
            const shortcutSelection = getSelectionText();
            if (shortcutSelection) {
                state.selection = shortcutSelection;
            }
            handleTranslationParams(state.selection || shortcutSelection);
        }
        if (isDocumentShortcut) {
            e.preventDefault();
            handleDocumentTranslation();
        }
    });

    function handleTranslationParams(text, rect = null, context = '') {
        if (!text) return;
        Utils.getSettings(['translationEngine', 'targetLang', 'promptProfile'], (items) => {
            requestTranslation(text, items.translationEngine || 'google', items.targetLang || 'zh-CN', items.promptProfile || 'default', rect, context);
        });
    }

    function handleDocumentTranslation() {
        if (!documentTranslator) {
            ui.showError('文档翻译功能暂不可用，请刷新页面重试。');
            return;
        }

        if (state.isDocumentTranslating) {
            documentTranslator.cancelTranslation();
            showNotice('已请求取消文档翻译', 'info');
            return;
        }

        Utils.getSettings(['translationEngine', 'targetLang', 'bilingualMode'], (items) => {
            const engine = items.translationEngine || 'google';
            const targetLang = items.targetLang || 'zh-CN';
            const bilingual = items.bilingualMode || false;

            state.isDocumentTranslating = true;
            if (typeof ui.showDocumentPanel === 'function') {
                ui.showDocumentPanel();
            } else {
                ui.showLoading(true);
            }

            // Start progress polling
            startProgressPolling();

            documentTranslator.translateDocument(targetLang, engine, bilingual)
                .then(result => {
                    state.isDocumentTranslating = false;
                    stopProgressPolling();
                    if (result.success) {
                        ui.hideCard();
                        showNotice(`文档翻译完成，已处理 ${result.segmentsProcessed} 个文本段落。`, 'success');
                    }
                })
                .catch(error => {
                    state.isDocumentTranslating = false;
                    stopProgressPolling();
                    console.error('Document translation failed:', error);
                    if (String(error?.message || '').includes('DOCUMENT_TRANSLATION_CANCELED')) {
                        showNotice('文档翻译已取消', 'info');
                    } else {
                        ui.showError(`文档翻译失败: ${error.message}`);
                    }
                });
        });
    }

    function startProgressPolling() {
        stopProgressPolling();
        state.progressTimer = setInterval(() => {
            if (documentTranslator && state.isDocumentTranslating) {
                const progress = documentTranslator.getProgress();
                ui.updateProgress(progress.progress);
                if (typeof ui.setDocumentStage === 'function') {
                    ui.setDocumentStage(progress.stage || 'translating');
                }
            }
        }, 500);
    }

    function stopProgressPolling() {
        if (state.progressTimer) {
            clearInterval(state.progressTimer);
            state.progressTimer = null;
        }
    }

    function requestTranslation(text, engine, targetLang, profile, rect = null, context = '') {
        if (!Utils.isExtensionContextValid()) {
            ui.showError('扩展已更新，请刷新页面后重试。');
            return;
        }

        const isStream = (engine === 'deepseek' || engine === 'openai' || engine === 'multi');
        state.lastRect = rect || state.lastRect;

        chrome.runtime.sendMessage({
            type: 'REQUEST_TASK_TRANSLATE',
            text,
            engine,
            targetLang,
            profile,
            context,
            mode: 'translate',
            stream: isStream
        }, (response) => {
            if (chrome.runtime.lastError) {
                ui.showError(chrome.runtime.lastError.message || '任务创建失败');
                return;
            }
            if (!response || !response.success) {
                ui.showError((response && response.error) || '任务创建失败');
                return;
            }
            state.activeTaskId = response.taskId || '';
        });
    }

    // Add context menu for images to trigger OCR
    document.addEventListener('contextmenu', (e) => {
        if (e.target.tagName === 'IMG' && e.shiftKey) {
            setTimeout(() => {
                showNotice('已触发图片 OCR（Shift+右键）', 'info');
                handleImageOCR(e.target);
            }, 10);
        }
    });

    async function handleImageOCR(imgElement) {
        let ocrInstance = ocrTranslator;
        if (!ocrInstance) {
            if (typeof window.OCRTranslator !== 'undefined') {
                ocrInstance = window.__xiaoetOcrTranslator || new window.OCRTranslator();
                window.__xiaoetOcrTranslator = ocrInstance;
                try {
                    await ocrInstance.initialize();
                } catch (initError) {
                    ui.showError('OCR功能初始化失败，请检查网络连接后重试。');
                    return;
                }
            } else {
                ui.showError('OCR功能暂不可用，请刷新页面后重试。');
                return;
            }
        } else if (!ocrInstance.isInitialized) {
            try {
                await ocrInstance.initialize();
            } catch (initError) {
                ui.showError('OCR功能初始化失败，请检查网络连接后重试。');
                return;
            }
        }

        try {
            ui.showLoading(true);
            const result = await ocrInstance.ocrAndTranslate(
                imgElement.src,
                state.settings.targetLang || 'zh-CN',
                state.settings.translationEngine || 'google'
            );
            ui.showResult(result.original, result.translated, 'ocr');
        } catch (error) {
            console.error('OCR translation failed:', error);
            ui.showError(`OCR翻译失败: ${error.message}`);
        }
    }

    function exportTranslatedDocument() {
        const translatedElements = document.querySelectorAll('[data-original-text]');

        if (translatedElements.length === 0) {
            showNotice('没有找到可导出的翻译内容', 'warning');
            return;
        }

        let exportContent = `# 导出的翻译文档\n\n`;
        for (const element of translatedElements) {
            const originalText = element.getAttribute('data-original-text');
            const translatedText = element.textContent;
            exportContent += `## 原文:\n${originalText}\n\n`;
            exportContent += `## 翻译:\n${translatedText}\n\n`;
        }

        const blob = new Blob([exportContent], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `translated-document-${new Date().toISOString().slice(0, 19)}.txt`;
        document.body.appendChild(a);
        a.click();

        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);

        showNotice('翻译文档已导出', 'success');
    }
}
