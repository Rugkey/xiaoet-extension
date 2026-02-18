/**
 * main.js
 * Entry point, Event Coordination
 */

// Initialize modules
console.log("XiaoEt: Initializing...");

// Check immediately if modules are available
console.log("Available modules on window object:", {
    hasTranslatorUI: typeof window.TranslatorUI !== 'undefined',
    hasContextProcessor: typeof window.ContextProcessor !== 'undefined',
    hasOCRTranslator: typeof window.OCRTranslator !== 'undefined',
    hasDocumentTranslator: typeof window.DocumentTranslator !== 'undefined',
    hasContentAdapter: typeof window.ContentAdapter !== 'undefined',
    hasUtils: typeof window.Utils !== 'undefined'
});

// Since all scripts are loaded synchronously in the correct order,
// modules should be available immediately
function waitForEssentialModules() {
    return new Promise((resolve, reject) => {
        // All modules should already be available
        setTimeout(() => {
            resolve(); // Proceed immediately
        }, 0);
    });
}

// Initialize modules directly without waiting since they should be available
console.log("Initializing modules, checking availability...");

// Initialize UI - wait for TranslatorUI to be defined
let ui = null;
if (typeof window.TranslatorUI !== 'undefined') {
    ui = new window.TranslatorUI();
} else {
    console.error("TranslatorUI is not defined!");
    // Exit if TranslatorUI is not available by not continuing execution
    ui = null; // This will cause later checks to fail gracefully
}

// Initialize Content Adapter with safety check
let adapter = null;
if (typeof window.ContentAdapter !== 'undefined') {
    try {
        adapter = new window.ContentAdapter();
        console.log('ContentAdapter initialized');
    } catch (e) {
        console.error('Failed to initialize ContentAdapter:', e);
        adapter = null;
    }
} else {
    console.error('ContentAdapter not available');
}

// Initialize Context Processor
let contextProcessor = null;
if (typeof window.ContextProcessor !== 'undefined') {
    try {
        contextProcessor = new window.ContextProcessor();
        console.log('ContextProcessor initialized');
    } catch (e) {
        console.error('Failed to initialize ContextProcessor:', e);
        contextProcessor = null;
    }
} else {
    console.error('ContextProcessor not available');
}

// Initialize Document Translator
let documentTranslator = null;
if (typeof window.DocumentTranslator !== 'undefined') {
    try {
        documentTranslator = new window.DocumentTranslator();
        console.log('DocumentTranslator initialized');
    } catch (e) {
        console.error('Failed to initialize DocumentTranslator:', e);
        documentTranslator = null;
    }
} else {
    console.error('DocumentTranslator not available');
}

// Initialize OCR Translator (can be done asynchronously)
let ocrTranslator = null;
if (typeof window.OCRTranslator !== 'undefined') {
    try {
        ocrTranslator = new window.OCRTranslator();
        // Initialize OCR asynchronously since it may need to load external libraries
        ocrTranslator.initialize().then(() => {
            console.log('OCRTranslator initialized');
        }).catch(err => {
            console.error('OCR initialization failed:', err);
        });
    } catch (e) {
        console.error('Failed to initialize OCRTranslator:', e);
        ocrTranslator = null;
    }
} else {
    console.error('OCRTranslator not available');
}

    // Only continue if UI is available
    if (!ui) {
        console.error("Critical error: UI not available, terminating initialization.");
    } else {
        // State
        const state = {
            selection: "",
            lastRect: null, // Store selection geometry
            settings: {},
            isDocumentTranslating: false
        };

    // Load initial settings
    Utils.getSettings(['translationEngine', 'targetLang'], (items) => {
        state.settings = items;
        if (items.translationEngine) ui.engine = items.translationEngine;
        if (items.targetLang) ui.targetLang = items.targetLang;
    });

    // --- Message Listeners ---
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.type === 'TRIGGER_SHORTCUT') {
            handleTranslationParams(state.selection);
        }
        else if (msg.type === 'TRIGGER_DOCUMENT_TRANSLATE') {
            handleDocumentTranslation();
        }
        else if (msg.type === 'TRIGGER_RESTORE_DOCUMENT') {
            if (documentTranslator) {
                documentTranslator.restoreOriginalText();
                state.isDocumentTranslating = false;
                alert('文档已恢复为原文');
            } else {
                console.error('DocumentTranslator not available for restoration');
                alert('文档恢复功能暂不可用，请刷新页面重试。');
            }
        }
        else if (msg.type === 'TRIGGER_EXPORT_DOCUMENT') {
            // Export translated document functionality
            exportTranslatedDocument();
        }
        else if (msg.type === 'TRANSLATION_START') {
            if (ui) ui.startStream(msg.original);
        }
        else if (msg.type === 'TRANSLATION_CHUNK') {
            if (ui) ui.appendStreamChunk(msg.chunk);
        }
        else if (msg.type === 'TRANSLATION_END') {
            if (ui) ui.endStream();
        }
        else if (msg.type === 'SHOW_TRANSLATION') {
            // Legacy/Fallback for non-stream
            if (ui) ui.showResult(msg.payload.original, msg.payload.translated, msg.payload.mode);
        }
        else if (msg.type === 'SHOW_ERROR') {
            // For now just console, or simple alert
            console.error(msg.payload);
        }
        else if (msg.type === 'OCR_TRANSLATION_RESULT') {
            // Handle OCR translation result
            if (ui && msg.success) {
                ui.showResult(msg.payload.original, msg.payload.translated, 'ocr');
            } else if (!msg.success) {
                console.error('OCR translation failed:', msg.error);
                if (ui) {
                    ui.showResult('', `OCR翻译失败: ${msg.error}`, 'ocr');
                }
            }
        }
        else if (msg.type === 'DOCUMENT_TRANSLATION_RESULT') {
            // Handle document translation result
            if (ui && msg.success && !state.isDocumentTranslating) {
                ui.showResult('', msg.result, 'document');
            }
        }
    });

    // --- Re-Translate Event from UI ---
    document.addEventListener('xiaoet:retranslate', (e) => {
        if (!ui) {
            console.error("UI not available, cannot perform retranslation");
            return;
        }
        
        const { text, engine, targetLang } = e.detail;
        requestTranslation(text, engine, targetLang);
    });

    // --- PDF Text Selection Event ---
    document.addEventListener('xiaoetPdfTextSelected', (e) => {
        if (!ui) {
            console.error("UI not available, cannot handle PDF text selection");
            return;
        }
        
        const { text, x, y } = e.detail;
        if (text) {
            // Show translation icon at specified position
            if (typeof ui.showIcon === 'function') {
                ui.showIcon(x, y, () => {
                    handleTranslationParams(text);
                });
            }
        }
    });

    // --- Mouse Interaction ---
    document.addEventListener('mouseup', (e) => {
        // Ignore clicks inside our own shadowDOM (host handles events but check target)
        if (ui && ui.host && ui.host.contains(e.target)) return;

        setTimeout(async () => {
            const sel = window.getSelection();
            let text = sel.toString().trim();

            // Validate and sanitize the selected text
            text = Utils.validateAndSanitize(text, 5000); // Limit to 5000 chars

            if (text.length > 0 && sel.rangeCount > 0 && ui) {
                state.selection = text;

                // Get enhanced context using ContextProcessor if available
                let context = '';
                if (contextProcessor) {
                    try {
                        context = await contextProcessor.extractContext(sel, {
                            includeParagraphs: true,
                            includeHeaders: true,
                            includeAdjacentElements: true
                        });
                    } catch (err) {
                        console.warn('Failed to extract context:', err);
                        context = '';
                    }
                } else if (adapter) {
                    // Fallback to adapter context extraction
                    try {
                        context = adapter.getContextAroundSelection(sel);
                    } catch (err) {
                        console.warn('Failed to extract context with adapter:', err);
                        context = '';
                    }
                }

                // Capture rect
                const range = sel.getRangeAt(0);
                const rect = range.getBoundingClientRect();
                state.lastRect = {
                    left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height
                };

                // Show Icon
                ui.showIcon(e.clientX, e.clientY, () => {
                    handleTranslationParams(text, state.lastRect, context);
                });
            } else if (ui) {
                ui.hideIcon();
            }
        }, 10);
    });

    document.addEventListener('mousedown', (e) => {
        if (ui && ui.icon && ui.host && !ui.host.contains(e.target)) {
            ui.hideIcon();
        }
    });

    // --- Keyboard Shortcuts ---
    document.addEventListener('keydown', (e) => {
        // Alt+Shift+D for document translation
        if (e.altKey && e.shiftKey && e.key.toLowerCase() === 'd') {
            e.preventDefault();
            if (ui) {
                handleDocumentTranslation();
            } else {
                console.error("UI not available, cannot handle document translation shortcut");
            }
        }
    });

    function handleTranslationParams(text, rect = null, context = '') {
        if (!ui) {
            console.error("UI not available, cannot perform translation");
            return;
        }
        
        if (!text) return;
        Utils.getSettings(['translationEngine', 'targetLang', 'promptProfile'], (items) => {
            requestTranslation(text, items.translationEngine || 'google', items.targetLang || 'zh-CN', items.promptProfile || 'default', rect, context);
        });
    }

    function handleDocumentTranslation() {
        if (!ui) {
            console.error("UI not available, cannot perform document translation");
            return;
        }

        if (!documentTranslator) {
            console.error("DocumentTranslator not available");
            alert('文档翻译功能暂不可用，请刷新页面重试。');
            return;
        }

        if (state.isDocumentTranslating) {
            // If already translating, offer to restore
            if (confirm('文档正在翻译中，是否恢复原文？')) {
                documentTranslator.restoreOriginalText();
                state.isDocumentTranslating = false;
            }
            return;
        }

        Utils.getSettings(['translationEngine', 'targetLang'], (items) => {
            const engine = items.translationEngine || 'google';
            const targetLang = items.targetLang || 'zh-CN';

            state.isDocumentTranslating = true;
            ui.showLoading(true);

            documentTranslator.translateDocument(targetLang, engine)
                .then(result => {
                    state.isDocumentTranslating = false;
                    if (result.success) {
                        ui.hideCard(); // Hide translation card after document translation
                        alert(`文档翻译完成！共处理了 ${result.segmentsProcessed} 个文本段落。`);
                    }
                })
                .catch(error => {
                    state.isDocumentTranslating = false;
                    console.error('Document translation failed:', error);
                    alert(`文档翻译失败: ${error.message}`);
                });
        });
    }

    function requestTranslation(text, engine, targetLang, profile, rect = null, context = '') {
        if (!ui) {
            console.error("UI not available, cannot perform translation");
            return;
        }
        
        // Check if engine supports streaming
        const isStream = (engine === 'deepseek' || engine === 'openai' || engine === 'multi');

        if (isStream) {
            // Tell BG to open stream (Stream start will call ui.startStream, we need to pass rect or store it in UI?)
            // If we send message, BG sends back START.
            // We can pre-set rect in UI or pass it via message?
            // Easier: Set UI pending rect.
            ui.setPendingRect(rect);

            chrome.runtime.sendMessage({
                type: 'REQUEST_STREAM_TRANSLATE',
                text,
                engine,
                targetLang,
                profile,
                context
            });
        } else {
            ui.showLoading(true, rect); // Pass rect
            chrome.runtime.sendMessage({
                type: 'REQUEST_TRANSLATE',
                text,
                engine,
                targetLang,
                profile,
                context
            });
        }
    }

    // Function to extract context around selected text
    function getContext(selectedText) {
        try {
            const selection = window.getSelection();
            if (!selection || selection.rangeCount === 0) return '';

            const range = selection.getRangeAt(0);
            if (!range) return '';

            // Get surrounding text for context
            const contextRange = range.cloneRange();

            // Expand range to include more context (500 characters before and after)
            const startContainer = range.startContainer;
            const startOffset = range.startOffset;
            const endContainer = range.endContainer;
            const endOffset = range.endOffset;

            // Try to expand backward
            try {
                if (startContainer.nodeType === Node.TEXT_NODE) {
                    const textBefore = startContainer.textContent.substring(0, startOffset);
                    const contextStart = Math.max(0, textBefore.length - 500);
                    contextRange.setStart(startContainer, contextStart);
                } else {
                    // If not a text node, try to find text nodes in siblings
                    let prevSibling = startContainer.previousSibling;
                    let charsCollected = 0;

                    while (prevSibling && charsCollected < 500) {
                        if (prevSibling.nodeType === Node.TEXT_NODE) {
                            const text = prevSibling.textContent;
                            const needed = 500 - charsCollected;
                            const start = Math.max(0, text.length - needed);
                            contextRange.setStart(prevSibling, start);
                            charsCollected += (text.length - start);
                        }
                        prevSibling = prevSibling.previousSibling;
                    }
                }
            } catch (e) {
                console.debug('Could not expand context range backward:', e);
            }

            // Try to expand forward
            try {
                if (endContainer.nodeType === Node.TEXT_NODE) {
                    const textAfter = endContainer.textContent.substring(endOffset);
                    const contextEnd = Math.min(endOffset + 500, endContainer.textContent.length);
                    contextRange.setEnd(endContainer, contextEnd);
                } else {
                    // If not a text node, try to find text nodes in siblings
                    let nextSibling = endContainer.nextSibling;
                    let charsCollected = 0;

                    while (nextSibling && charsCollected < 500) {
                        if (nextSibling.nodeType === Node.TEXT_NODE) {
                            const text = nextSibling.textContent;
                            const needed = 500 - charsCollected;
                            const end = Math.min(needed, text.length);
                            contextRange.setEnd(nextSibling, end);
                            charsCollected += end;
                        }
                        nextSibling = nextSibling.nextSibling;
                    }
                }
            } catch (e) {
                console.debug('Could not expand context range forward:', e);
            }

            // Extract context text
            const contextText = contextRange.toString().substring(0, 1000); // Limit context to 1000 chars
            return contextText;
        } catch (e) {
            console.debug('Could not extract context:', e);
            return '';
        }
    }

    // Add context menu for images to trigger OCR
    document.addEventListener('contextmenu', (e) => {
        if (e.target.tagName === 'IMG' && ui) {
            // Add a temporary context menu option for OCR
            setTimeout(() => {
                if (confirm('是否要翻译此图片中的文字？')) {
                    handleImageOCR(e.target);
                }
            }, 10);
        }
    });

    // Handle OCR for image
    async function handleImageOCR(imgElement) {
        if (!ui) {
            console.error("UI not available, cannot perform OCR translation");
            return;
        }

        // Try to create OCR translator if it doesn't exist
        let ocrTranslatorInstance = ocrTranslator;
        if (!ocrTranslatorInstance) {
            if (typeof window.OCRTranslator !== 'undefined') {
                ocrTranslatorInstance = new window.OCRTranslator();
                try {
                    await ocrTranslatorInstance.initialize();
                    console.log('OCRTranslator initialized on demand');
                } catch (initError) {
                    console.error('Failed to initialize OCRTranslator:', initError);
                    alert('OCR功能初始化失败，请检查网络连接后重试。');
                    return;
                }
            } else {
                console.error("OCRTranslator not available");
                alert('OCR功能暂不可用，请刷新页面后重试。');
                return;
            }
        } else {
            // Check if OCRTranslator is properly initialized
            if (!ocrTranslatorInstance.isInitialized) {
                try {
                    await ocrTranslatorInstance.initialize();
                    console.log('OCRTranslator initialized on demand');
                } catch (initError) {
                    console.error('Failed to initialize OCRTranslator:', initError);
                    alert('OCR功能初始化失败，请检查网络连接后重试。');
                    return;
                }
            }
        }

        try {
            ui.showLoading(true);
            const result = await ocrTranslatorInstance.ocrAndTranslate(imgElement.src, state.settings.targetLang || 'zh-CN', state.settings.translationEngine || 'google');

            // Show the OCR result
            ui.showResult(result.original, result.translated, 'ocr');
        } catch (error) {
            console.error('OCR translation failed:', error);
            alert(`OCR翻译失败: ${error.message}`);
        }
    }

    // Export translated document functionality
    function exportTranslatedDocument() {
        // Get all elements with translated content
        const translatedElements = document.querySelectorAll('[data-original-text]');
        
        if (translatedElements.length === 0) {
            alert('没有找到已翻译的文档内容');
            return;
        }
        
        // Create a simple representation of the translated document
        let exportContent = `# 导出的翻译文档\n\n`;
        
        for (const element of translatedElements) {
            const originalText = element.getAttribute('data-original-text');
            const translatedText = element.textContent;
            
            exportContent += `## 原文:\n${originalText}\n\n`;
            exportContent += `## 翻译:\n${translatedText}\n\n`;
        }
        
        // Create a blob and download it
        const blob = new Blob([exportContent], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `translated-document-${new Date().toISOString().slice(0, 19)}.txt`;
        document.body.appendChild(a);
        a.click();
        
        // Clean up
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);
        
        alert('翻译文档已导出！');
    }
} // End of if (!ui) block
