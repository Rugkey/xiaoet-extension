/**
 * document-translator.js
 * Document translation functionality
 */

(function() {
    'use strict';

    try {
        console.log('Loading document-translator.js...');

        class DocumentTranslator {
    constructor() {
        this.isTranslating = false;
        this.currentProgress = 0;
        this.totalSegments = 0;
        this.processedSegments = 0;
        this.translationCache = new Map();
        this.maxCacheSize = 500;
    }

    /**
     * Translate entire document (HTML page)
     */
    async translateDocument(targetLang = 'zh-CN', engine = 'google') {
        if (this.isTranslating) {
            throw new Error('Document translation already in progress');
        }

        this.isTranslating = true;
        this.currentProgress = 0;
        this.processedSegments = 0;

        try {
            // Get all translatable text segments
            const segments = this.extractTextSegments();
            this.totalSegments = segments.length;

            if (segments.length === 0) {
                throw new Error('No translatable content found in document');
            }

            // Process segments in batches to avoid overwhelming the API
            const batchSize = 10;
            const results = [];

            for (let i = 0; i < segments.length; i += batchSize) {
                const batch = segments.slice(i, i + batchSize);
                
                // Process batch concurrently
                const batchResults = await Promise.all(
                    batch.map(segment => this.translateSegment(segment, targetLang, engine))
                );

                results.push(...batchResults);

                // Update progress
                this.processedSegments += batch.length;
                this.currentProgress = (this.processedSegments / this.totalSegments) * 100;

                // Small delay to prevent rate limiting
                await this.delay(100);
            }

            // Apply translations to the document
            this.applyTranslations(results);

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
        }
    }

    /**
     * Extract text segments from the document
     */
    extractTextSegments() {
        const segments = [];
        const selectors = [
            'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 
            'span', 'div', 'li', 'td', 'th', 'caption',
            '.content', '#content', '.article', 'article',
            '.post', '.entry', '.text', '.paragraph'
        ];

        for (const selector of selectors) {
            const elements = document.querySelectorAll(selector);
            for (const element of elements) {
                // Skip elements that are likely UI controls
                if (this.isLikelyUIElement(element)) continue;

                const text = element.textContent || element.innerText || '';
                if (text.trim().length > 10 && text.trim().length < 2000) {
                    segments.push({
                        element: element,
                        originalText: text.trim(),
                        selector: this.getElementSelector(element)
                    });
                }
            }
        }

        return segments;
    }

    /**
     * Translate a single text segment
     */
    async translateSegment(segment, targetLang, engine) {
        const { originalText, element, selector } = segment;
        
        // Check cache first
        const cacheKey = this.getCacheKey(originalText, targetLang, engine);
        if (this.translationCache.has(cacheKey)) {
            return {
                ...segment,
                translatedText: this.translationCache.get(cacheKey),
                cached: true
            };
        }

        try {
            // Send translation request to background script
            const translatedText = await this.requestTranslation(originalText, targetLang, engine);
            
            // Add to cache
            this.addToCache(cacheKey, translatedText);

            return {
                ...segment,
                translatedText: translatedText,
                cached: false
            };
        } catch (error) {
            console.error(`Failed to translate segment: ${originalText.substring(0, 50)}...`, error);
            return {
                ...segment,
                translatedText: originalText, // Fallback to original text
                cached: false,
                error: error.message
            };
        }
    }

    /**
     * Request translation from background service
     */
    async requestTranslation(text, targetLang, engine) {
        return new Promise((resolve, reject) => {
            const messageId = `doc_translate_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            // Listen for response
            const responseListener = (request, sender, sendResponse) => {
                if (request.type === 'DOCUMENT_TRANSLATION_RESULT' && request.id === messageId) {
                    chrome.runtime.onMessage.removeListener(responseListener);
                    if (request.success) {
                        resolve(request.result);
                    } else {
                        reject(new Error(request.error || 'Translation failed'));
                    }
                }
            };

            chrome.runtime.onMessage.addListener(responseListener);

            // Send translation request
            chrome.runtime.sendMessage({
                type: 'REQUEST_DOCUMENT_TRANSLATE',
                text: text,
                targetLang: targetLang,
                engine: engine,
                id: messageId
            }).catch(error => {
                chrome.runtime.onMessage.removeListener(responseListener);
                reject(error);
            });
        });
    }

    /**
     * Apply translations to the document
     */
    applyTranslations(results) {
        for (const result of results) {
            if (result.element && result.translatedText && !result.error) {
                // Store original text as data attribute for potential restoration
                result.element.setAttribute('data-original-text', result.originalText);
                result.element.textContent = result.translatedText;
            }
        }
    }

    /**
     * Restore original document text
     */
    restoreOriginalText() {
        const elements = document.querySelectorAll('[data-original-text]');
        for (const element of elements) {
            const originalText = element.getAttribute('data-original-text');
            if (originalText) {
                element.textContent = originalText;
                element.removeAttribute('data-original-text');
            }
        }
    }

    /**
     * Get progress of ongoing translation
     */
    getProgress() {
        return {
            isTranslating: this.isTranslating,
            progress: this.currentProgress,
            processed: this.processedSegments,
            total: this.totalSegments
        };
    }

    /**
     * Check if an element is likely a UI control
     */
    isLikelyUIElement(element) {
        const uiClassNames = [
            'button', 'btn', 'nav', 'navigation', 'menu', 'footer',
            'header', 'sidebar', 'advertisement', 'ad', 'cookie',
            'modal', 'popup', 'overlay', 'tooltip', 'dropdown',
            'search', 'input', 'form', 'label'
        ];

        const className = (element.className || '').toLowerCase();
        const tagName = element.tagName.toLowerCase();

        // Check class names
        for (const name of uiClassNames) {
            if (className.includes(name)) return true;
        }

        // Check tag names
        return ['nav', 'footer', 'header', 'aside', 'script', 'style'].includes(tagName);
    }

    /**
     * Get unique selector for an element
     */
    getElementSelector(element) {
        if (element.id) {
            return `#${element.id}`;
        }
        
        const path = [];
        let current = element;
        
        while (current && current !== document.body) {
            let selector = current.tagName.toLowerCase();
            
            if (current.id) {
                selector = `#${current.id}`;
            } else if (current.className) {
                selector += `.${current.className.replace(/\s+/g, '.')}`;
            }
            
            path.unshift(selector);
            current = current.parentElement;
        }
        
        return path.join(' > ');
    }

    /**
     * Get cache key for translation
     */
    getCacheKey(text, targetLang, engine) {
        const textHash = this.simpleHash(text.substring(0, 100));
        return `${textHash}_${engine}_${targetLang}`;
    }

    /**
     * Simple hash function
     */
    simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0; // Convert to 32bit integer
        }
        return Math.abs(hash).toString(36);
    }

    /**
     * Add to cache with size management
     */
    addToCache(key, value) {
        if (this.translationCache.size >= this.maxCacheSize) {
            // Remove oldest entry (first in Map iteration)
            const firstKey = this.translationCache.keys().next().value;
            this.translationCache.delete(firstKey);
        }
        this.translationCache.set(key, value);
    }

    /**
     * Delay helper function
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

        window.DocumentTranslator = DocumentTranslator;
        console.log('DocumentTranslator class defined and exported to window');

    } catch (error) {
        console.error('FATAL ERROR in document-translator.js:', error);
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
    }
})();