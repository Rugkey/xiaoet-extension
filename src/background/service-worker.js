/**
 * service-worker.js
 * Background script for XiaoEt extension.
 * Handles context menus, PDF redirection, and translation API calls.
 */

// Memory management and performance optimization
const TRANSLATION_CACHE = new Map();
const MAX_CACHE_SIZE = 200; // Increased cache size for better performance
const ACTIVE_STREAMS = new Set();

// Performance monitoring
let requestCount = 0;
let errorCount = 0;
const PERFORMANCE_LOG = [];

// Multi-engine fusion configuration
const ENGINE_WEIGHTS = {
    'google': 0.2,   // Fast and reliable for general text
    'deepl': 0.4,    // High quality translations
    'deepseek': 0.3, // Good for academic content
    'openai': 0.1     // Context-aware translations
};

// Domain-specific prompts
const DOMAIN_PROMPTS = {
    'default': 'You are a professional translator.',
    'academic': 'You are an academic researcher translating scholarly content. Maintain formal tone, preserve technical terminology, and ensure accuracy of scientific concepts.',
    'medical': 'You are a medical professional translating clinical and research content. Preserve medical terminology and ensure clinical accuracy.',
    'legal': 'You are a legal expert translating legal documents. Maintain formal language and preserve legal terminology.',
    'technical': 'You are a technical expert translating technical documentation. Preserve technical terms and maintain precision.'
};

// 1. INITIALIZATION
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
            id: "translate-selection",
            title: "Translate Selection",
            contexts: ["selection"]
        });
    });
    
    // Clean up cache periodically
    setInterval(cleanupCache, 300000); // Every 5 minutes
});

// 2. PDF REDIRECTION
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'loading' && tab.url) {
        // Local files
        if (tab.url.startsWith('file://') && /\.pdf$/i.test(tab.url)) {
            const viewerUrl = chrome.runtime.getURL(`src/pdf/web/academic-viewer.html?file=${encodeURIComponent(tab.url)}`);
            chrome.tabs.update(tabId, { url: viewerUrl });
        }
    }
});

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
    }
});

// 4. SHORTCUTS
chrome.commands.onCommand.addListener((command) => {
    if (command === "translate_selection") {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, { type: 'TRIGGER_SHORTCUT' });
            }
        });
    }
});

// 5. MESSAGE HANDLING
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Input validation and sanitization
    if (!isValidRequest(request)) {
        console.warn('Invalid request received:', request);
        sendResponse({ success: false, error: 'Invalid request' });
        return;
    }

    if (request.type === 'REQUEST_TRANSLATE') {
        translateText(request.text, sender.tab.id, {
            engine: request.engine,
            targetLang: request.targetLang,
            mode: request.mode || 'translate',
            profile: request.profile || 'default',
            context: request.context || ''
        });
        sendResponse({ success: true });
    } else if (request.type === 'REQUEST_STREAM_TRANSLATE') {
        handleStreamTranslation(request.text, sender.tab.id, request.engine, request.targetLang, request.profile || 'default', request.context || '');
        sendResponse({ success: true });
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
    } else if (request.type === 'REQUEST_OCR_TRANSLATE') {
        (async () => {
            try {
                const result = await translateText(request.text, sender.tab.id, {
                    engine: request.engine,
                    targetLang: request.targetLang,
                    mode: 'ocr',
                    profile: 'default'
                });
                sendResponse({ success: true, result: result, id: request.id });
            } catch (e) {
                sendResponse({ success: false, error: e.message, id: request.id });
            }
        })();
        return true;
    } else if (request.type === 'REQUEST_DOCUMENT_TRANSLATE') {
        (async () => {
            try {
                const result = await translateText(request.text, sender.tab.id, {
                    engine: request.engine,
                    targetLang: request.targetLang,
                    mode: 'document',
                    profile: 'default'
                });
                sendResponse({ success: true, result: result, id: request.id });
            } catch (e) {
                sendResponse({ success: false, error: e.message, id: request.id });
            }
        })();
        return true;
    } else if (request.type === 'TRIGGER_RESTORE_DOCUMENT') {
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
            chrome.tabs.sendMessage(tabs[0].id, { type: 'TRIGGER_RESTORE_DOCUMENT' });
        });
        sendResponse({ success: true });
    } else if (request.type === 'TRIGGER_EXPORT_DOCUMENT') {
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
            chrome.tabs.sendMessage(tabs[0].id, { type: 'TRIGGER_EXPORT_DOCUMENT' });
        });
        sendResponse({ success: true });
    }
});

// 5.1 VALIDATION HELPER
function isValidRequest(request) {
    if (!request || typeof request !== 'object') return false;
    
    if (request.type === 'REQUEST_TRANSLATE' || request.type === 'REQUEST_STREAM_TRANSLATE') {
        if (!request.text || typeof request.text !== 'string') return false;
        if (request.text.length > 10000) return false; // Limit text length
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
        // Remove oldest entries (LRU - Least Recently Used)
        const entries = Array.from(TRANSLATION_CACHE.entries());
        const entriesToRemove = entries.slice(0, Math.floor(MAX_CACHE_SIZE * 0.3)); // Remove 30%

        for (const [key] of entriesToRemove) {
            TRANSLATION_CACHE.delete(key);
        }
    }
    
    // Log performance stats
    logPerformanceStats();
}

function getCacheKey(text, engine, targetLang) {
    // Create a more specific key that includes the first 100 chars of text plus params
    return `${text.substring(0, 100)}_${engine}_${targetLang}_${text.length}`;
}

// Performance logging
function logPerformanceStats() {
    const stats = {
        timestamp: Date.now(),
        cacheSize: TRANSLATION_CACHE.size,
        requestCount: requestCount,
        errorCount: errorCount,
        cacheHitRate: TRANSLATION_CACHE.size > 0 ? 
            (requestCount - errorCount) / requestCount * 100 : 0
    };
    
    PERFORMANCE_LOG.push(stats);
    
    // Keep only last 100 entries
    if (PERFORMANCE_LOG.length > 100) {
        PERFORMANCE_LOG.shift();
    }
    
    // Output stats to console (in production, this could be sent to a logging service)
    console.log(`Performance Stats: Cache Size: ${stats.cacheSize}, Requests: ${stats.requestCount}, Errors: ${stats.errorCount}, Hit Rate: ${stats.cacheHitRate.toFixed(2)}%`);
}

// 6. TRANSLATION & AI LOGIC

async function translateText(text, tabId, options) {
    requestCount++; // Increment request counter
    
    try {
        const { engine, targetLang, mode, profile = 'default', context = '' } = options;

        // Check cache first
        const cacheKey = getCacheKey(text, engine, targetLang);
        if (TRANSLATION_CACHE.has(cacheKey)) {
            const cachedResult = TRANSLATION_CACHE.get(cacheKey);
            chrome.tabs.sendMessage(tabId, {
                type: 'SHOW_TRANSLATION',
                payload: { original: text, translated: cachedResult, mode: mode || 'translate' }
            });
            return;
        }

        let result = "";

        // If using multi-engine fusion
        if (engine === 'multi') {
            result = await fuseMultipleEngines(text, targetLang, profile);
        } else {
            const settings = await chrome.storage.sync.get({
                deepseekKey: '',
                openaiKey: '',
                deeplKey: ''
            });

            if (engine === 'google') {
                result = await translateWithGoogle(text, targetLang);
            } else if (engine === 'deepl') {
                result = await translateWithDeepL(text, settings.deeplKey, targetLang);
            } else if (engine === 'deepseek') {
                // Use domain-specific prompt with context if available
                const domainPrompt = DOMAIN_PROMPTS[profile] || DOMAIN_PROMPTS.default;
                const fullPrompt = context ?
                    `${domainPrompt} Use the following context: "${context}". Translate the following text to ${targetLang}` :
                    `${domainPrompt} Translate the following text to ${targetLang}`;
                result = await translateWithDeepSeek(text, settings.deepseekKey, fullPrompt, "deepseek-chat");
            } else if (engine === 'openai') {
                // Use domain-specific prompt with context if available
                const domainPrompt = DOMAIN_PROMPTS[profile] || DOMAIN_PROMPTS.default;
                const fullPrompt = context ?
                    `${domainPrompt} Use the following context: "${context}". Translate the following text to ${targetLang}` :
                    `${domainPrompt} Translate the following text to ${targetLang}`;
                result = await translateWithOpenAI(text, settings.openaiKey, "gpt-3.5-turbo", fullPrompt);
            }
        }

        // Add to cache
        if (result && result.length > 0) {
            if (TRANSLATION_CACHE.size >= MAX_CACHE_SIZE) {
                // Remove first entry (oldest due to Map iteration order)
                const firstKey = TRANSLATION_CACHE.keys().next().value;
                TRANSLATION_CACHE.delete(firstKey);
            }
            TRANSLATION_CACHE.set(cacheKey, result);
        }

        chrome.tabs.sendMessage(tabId, {
            type: 'SHOW_TRANSLATION',
            payload: { original: text, translated: result, mode: mode || 'translate' }
        });

    } catch (e) {
        errorCount++; // Increment error counter
        console.error('Translation error:', e);
        chrome.tabs.sendMessage(tabId, { type: 'SHOW_ERROR', payload: e.message });
    }
}

// Multi-engine fusion function
async function fuseMultipleEngines(text, targetLang, profile = 'default') {
    const settings = await chrome.storage.sync.get({
        deepseekKey: '',
        openaiKey: '',
        deeplKey: ''
    });

    // Collect results from all available engines
    const results = {};
    
    // Google translation (fast baseline)
    try {
        results.google = await translateWithGoogle(text, targetLang);
    } catch (e) {
        console.warn('Google translation failed:', e);
    }
    
    // DeepL translation (high quality)
    if (settings.deeplKey) {
        try {
            results.deepl = await translateWithDeepL(text, settings.deeplKey, targetLang);
        } catch (e) {
            console.warn('DeepL translation failed:', e);
        }
    }
    
    // DeepSeek translation (academic focus)
    if (settings.deepseekKey) {
        try {
            const domainPrompt = DOMAIN_PROMPTS[profile] || DOMAIN_PROMPTS.default;
            results.deepseek = await translateWithDeepSeek(text, settings.deepseekKey, 
                `${domainPrompt} Translate the following text to ${targetLang}`, "deepseek-chat");
        } catch (e) {
            console.warn('DeepSeek translation failed:', e);
        }
    }
    
    // OpenAI translation (context-aware)
    if (settings.openaiKey) {
        try {
            const domainPrompt = DOMAIN_PROMPTS[profile] || DOMAIN_PROMPTS.default;
            results.openai = await translateWithOpenAI(text, settings.openaiKey, "gpt-3.5-turbo", 
                `${domainPrompt} Translate the following text to ${targetLang}`);
        } catch (e) {
            console.warn('OpenAI translation failed:', e);
        }
    }

    // Fuse results based on weights and availability
    return fuseResults(results, text, targetLang);
}

// Fuse translation results using weighted voting
function fuseResults(results, originalText, targetLang) {
    const availableResults = Object.keys(results).filter(engine => results[engine]);
    
    if (availableResults.length === 0) {
        return "No translation engines available. Please check your API keys.";
    }
    
    if (availableResults.length === 1) {
        return results[availableResults[0]];
    }
    
    // For multiple results, we can implement a simple consensus algorithm
    // or return the highest-weighted available result
    let bestResult = "";
    let bestWeight = 0;
    
    for (const engine of availableResults) {
        const weight = ENGINE_WEIGHTS[engine] || 0;
        if (weight > bestWeight) {
            bestWeight = weight;
            bestResult = results[engine];
        }
    }
    
    // If DeepL is available, it often provides the highest quality
    if (results.deepl) {
        return results.deepl;
    }
    
    return bestResult || "Translation failed";
}

async function handleStreamTranslation(text, tabId, engine, targetLang, profile = 'default', context = '') {
    // Generate unique stream ID
    const streamId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    ACTIVE_STREAMS.add(streamId);
    
    try {
        const settings = await chrome.storage.sync.get({
            deepseekKey: '',
            openaiKey: ''
        });

        let apiKey = '';
        let model = '';

        // Determine Config
        if (engine === 'deepseek') {
            apiKey = settings.deepseekKey;
            model = 'deepseek-chat';
        } else if (engine === 'openai') {
            apiKey = settings.openaiKey;
            model = 'gpt-3.5-turbo';
        } else if (engine === 'multi') {
            // For multi-engine, we'll use the primary available engine
            if (settings.openaiKey) {
                apiKey = settings.openaiKey;
                engine = 'openai';
                model = 'gpt-3.5-turbo';
            } else if (settings.deepseekKey) {
                apiKey = settings.deepseekKey;
                engine = 'deepseek';
                model = 'deepseek-chat';
            } else if (settings.deeplKey) {
                // For multi-engine, we could implement a more complex fallback, but for now use one engine
                chrome.tabs.sendMessage(tabId, { type: 'TRANSLATION_START', original: text });
                chrome.tabs.sendMessage(tabId, { type: 'TRANSLATION_CHUNK', chunk: `Multi-engine streaming not supported. Using single engine fallback.` });
                // Fallback to using the best available single engine for streaming
                if (settings.openaiKey) {
                    apiKey = settings.openaiKey;
                    engine = 'openai';
                    model = 'gpt-3.5-turbo';
                } else if (settings.deepseekKey) {
                    apiKey = settings.deepseekKey;
                    engine = 'deepseek';
                    model = 'deepseek-chat';
                } else {
                    chrome.tabs.sendMessage(tabId, { type: 'TRANSLATION_START', original: text });
                    chrome.tabs.sendMessage(tabId, { type: 'TRANSLATION_CHUNK', chunk: `Error: No streaming engines configured. Please set up OpenAI or DeepSeek API key.` });
                    chrome.tabs.sendMessage(tabId, { type: 'TRANSLATION_END' });
                    return;
                }
            } else {
                chrome.tabs.sendMessage(tabId, { type: 'TRANSLATION_START', original: text });
                chrome.tabs.sendMessage(tabId, { type: 'TRANSLATION_CHUNK', chunk: `Error: No API keys configured for streaming engines.` });
                chrome.tabs.sendMessage(tabId, { type: 'TRANSLATION_END' });
                return;
            }
        }

        if (!apiKey) {
            chrome.tabs.sendMessage(tabId, { type: 'TRANSLATION_START', original: text });
            chrome.tabs.sendMessage(tabId, { type: 'TRANSLATION_CHUNK', chunk: `Error: Please configure ${engine} API Key in options.` });
            chrome.tabs.sendMessage(tabId, { type: 'TRANSLATION_END' });
            return;
        }

        // Create domain-specific prompt with context
        const domainPrompt = DOMAIN_PROMPTS[profile] || DOMAIN_PROMPTS.default;
        let systemPrompt = `${domainPrompt} Translate the following text to ${targetLang === 'en' ? 'English' : 'Simplified Chinese'}.`;
        
        if (context && context.length > 0) {
            systemPrompt += ` Context: "${context}". Use the context to inform your translation but only translate the requested text.`;
        }
        systemPrompt += ' Output ONLY the translated text.';

        // Signal Start
        chrome.tabs.sendMessage(tabId, { type: 'TRANSLATION_START', original: text });

        // Check if this stream is still active before proceeding
        if (!ACTIVE_STREAMS.has(streamId)) {
            return;
        }

        // Call Stream Helper
        if (engine === 'deepseek') {
            await streamDeepSeek(text, apiKey, systemPrompt, model, (chunk) => {
                // Check if stream is still active before sending chunk
                if (ACTIVE_STREAMS.has(streamId)) {
                    chrome.tabs.sendMessage(tabId, { type: 'TRANSLATION_CHUNK', chunk });
                }
            });
        } else if (engine === 'openai') {
            await streamOpenAI(text, apiKey, model, systemPrompt, (chunk) => {
                // Check if stream is still active before sending chunk
                if (ACTIVE_STREAMS.has(streamId)) {
                    chrome.tabs.sendMessage(tabId, { type: 'TRANSLATION_CHUNK', chunk });
                }
            });
        }

    } catch (e) {
        console.error('Stream translation error:', e);
        chrome.tabs.sendMessage(tabId, { type: 'TRANSLATION_CHUNK', chunk: `\n[Error: ${e.message}]` });
    } finally {
        // Remove stream ID from active streams
        ACTIVE_STREAMS.delete(streamId);
        chrome.tabs.sendMessage(tabId, { type: 'TRANSLATION_END' });
    }
}


// 7. API HELPERS
async function translateWithGoogle(text, targetLang) {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
    const response = await fetch(url);
    const data = await response.json();
    return data[0].map(item => item[0]).join('');
}

async function translateWithDeepL(text, apiKey, targetLang) {
    const host = apiKey.endsWith(':fx') ? 'api-free.deepl.com' : 'api.deepl.com';
    const lang = targetLang === 'zh-CN' ? 'ZH' : targetLang.toUpperCase();
    const response = await fetch(`https://${host}/v2/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `DeepL-Auth-Key ${apiKey}` },
        body: JSON.stringify({ text: [text], target_lang: lang })
    });
    const data = await response.json();
    return data.translations[0].text;
}

async function translateWithDeepSeek(text, apiKey, systemPrompt, model) {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
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
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
            model: model || "gpt-3.5-turbo",
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
            temperature: 1.3
        })
    });
    await processStream(response, onChunk);
}

async function streamOpenAI(text, apiKey, model, systemPrompt, onChunk) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
            model: model || "gpt-3.5-turbo",
            messages: [{ role: "system", content: systemPrompt }, { role: "user", content: text }],
            stream: true,
            max_tokens: 4096,
            temperature: 1.3
        })
    });
    await processStream(response, onChunk);
}

async function processStream(response, onChunk) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let totalReceived = 0;
    const MAX_RESPONSE_SIZE = 10 * 1024 * 1024; // 10MB limit

    try {
        while (true) {
            const { done, value } = await reader.read();

            if (value) {
                buffer += decoder.decode(value, { stream: !done });
                totalReceived += value.length;

                // Check for response size limit
                if (totalReceived > MAX_RESPONSE_SIZE) {
                    console.warn('Response exceeded size limit, stopping stream');
                    break;
                }
            }

            const lines = buffer.split('\n');

            // If not done, keep the last potentially incomplete line in buffer
            // If done, process all lines including the last one
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
                        // Silent fail on partial JSON, wait for more data
                        console.debug('Failed to parse JSON chunk:', e);
                    }
                }
            }

            if (done) break;
        }
    } finally {
        // Ensure reader is released
        reader.releaseLock();
    }
}

async function translateBatch(texts, context, engine, targetLang) {
    // Simplified batch: serial for now to ensure stability
    const results = [];
    for (const t of texts) {
        results.push(await translateWithGoogle(t, targetLang));
    }
    return results;
}
