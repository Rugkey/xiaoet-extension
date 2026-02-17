/**
 * context-processor.js
 * Advanced context processing for intelligent translation
 */

console.log('Loading context-processor.js...');

class ContextProcessor {
    constructor() {
        this.maxContextLength = 2000; // Maximum context length in characters
        this.maxParagraphs = 10; // Maximum paragraphs to include
        this.cache = new Map();
        this.cacheMaxSize = 100;
    }

    /**
     * Extract comprehensive context around selected text
     */
    async extractContext(selection, options = {}) {
        const {
            includeParagraphs = true,
            includeHeaders = true,
            includeAdjacentElements = true,
            maxLength = this.maxContextLength
        } = options;

        const cacheKey = this.generateCacheKey(selection.toString(), options);
        
        // Check cache first
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }

        let context = '';

        try {
            if (includeParagraphs) {
                context += this.extractParagraphContext(selection) + '\n\n';
            }

            if (includeHeaders) {
                context += this.extractHeaderContext(selection) + '\n\n';
            }

            if (includeAdjacentElements) {
                context += this.extractAdjacentContext(selection) + '\n\n';
            }

            // Limit context length
            context = context.substring(0, maxLength).trim();

            // Cache the result
            this.addToCache(cacheKey, context);

        } catch (error) {
            console.warn('Error extracting context:', error);
            // Fallback to basic context extraction
            context = this.basicContextExtraction(selection);
        }

        return context;
    }

    /**
     * Extract paragraph-level context
     */
    extractParagraphContext(selection) {
        if (!selection || selection.rangeCount === 0) return '';

        const range = selection.getRangeAt(0);
        if (!range) return '';

        let context = '';
        const selectedElement = this.findContainingBlockElement(range.commonAncestorContainer);

        if (selectedElement) {
            // Get sibling paragraphs
            const siblings = this.getSiblingsWithinLimit(selectedElement, this.maxParagraphs);
            
            for (const sibling of siblings) {
                const text = sibling.textContent || sibling.innerText || '';
                if (text.trim().length > 10) { // Only include substantial content
                    context += text.trim() + ' ';
                }
            }
        }

        return context.substring(0, this.maxContextLength);
    }

    /**
     * Extract heading context
     */
    extractHeaderContext(selection) {
        if (!selection || selection.rangeCount === 0) return '';

        const range = selection.getRangeAt(0);
        if (!range) return '';

        let context = '';
        const selectedElement = this.findContainingBlockElement(range.commonAncestorContainer);

        if (selectedElement) {
            // Find nearest headings
            const headings = this.findNearbyHeadings(selectedElement);
            for (const heading of headings) {
                context += heading.textContent.trim() + ' ';
            }
        }

        return context.substring(0, 500); // Limit heading context
    }

    /**
     * Extract adjacent elements context
     */
    extractAdjacentContext(selection) {
        if (!selection || selection.rangeCount === 0) return '';

        const range = selection.getRangeAt(0);
        if (!range) return '';

        let context = '';
        const selectedElement = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE 
            ? range.commonAncestorContainer 
            : range.commonAncestorContainer.parentElement;

        if (selectedElement) {
            // Get parent and sibling content
            const parentContent = selectedElement.parentElement ? 
                selectedElement.parentElement.textContent : '';
            const prevSibling = selectedElement.previousElementSibling;
            const nextSibling = selectedElement.nextElementSibling;

            if (prevSibling) {
                context += (prevSibling.textContent || '').substring(0, 300) + ' ';
            }
            if (nextSibling) {
                context += (nextSibling.textContent || '').substring(0, 300) + ' ';
            }
            if (parentContent) {
                context += parentContent.substring(0, 400);
            }
        }

        return context.substring(0, 800); // Limit adjacent context
    }

    /**
     * Find containing block-level element
     */
    findContainingBlockElement(node) {
        let current = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
        
        while (current && current !== document.body) {
            const computedStyle = window.getComputedStyle(current);
            const display = computedStyle.display;
            
            if (display === 'block' || 
                display === 'flex' || 
                display === 'grid' || 
                display === 'table' || 
                display === 'list-item' ||
                ['P', 'DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE'].includes(current.tagName)) {
                return current;
            }
            
            current = current.parentElement;
        }
        
        return document.body;
    }

    /**
     * Get siblings within a limit
     */
    getSiblingsWithinLimit(element, limit) {
        const siblings = [];
        let current = element.previousElementSibling;
        let count = 0;

        // Get previous siblings
        while (current && count < limit / 2) {
            siblings.unshift(current);
            current = current.previousElementSibling;
            count++;
        }

        siblings.push(element);
        count = 0;

        // Get next siblings
        current = element.nextElementSibling;
        while (current && count < limit / 2) {
            siblings.push(current);
            current = current.nextElementSibling;
            count++;
        }

        return siblings;
    }

    /**
     * Find nearby headings
     */
    findNearbyHeadings(element) {
        const headings = [];
        let current = element;

        // Look upward for headings
        while (current && current !== document.body && headings.length < 3) {
            const parentHeadings = current.parentElement ? 
                current.parentElement.querySelectorAll('h1, h2, h3, h4, h5, h6') : 
                [];
            
            for (const heading of parentHeadings) {
                if (!headings.includes(heading)) {
                    headings.push(heading);
                }
            }
            
            current = current.parentElement;
        }

        return headings;
    }

    /**
     * Basic context extraction (fallback)
     */
    basicContextExtraction(selection) {
        if (!selection || selection.rangeCount === 0) return '';

        const range = selection.getRangeAt(0);
        if (!range) return '';

        try {
            // Expand range to include more context (500 characters before and after)
            const startContainer = range.startContainer;
            const startOffset = range.startOffset;
            const endContainer = range.endContainer;
            const endOffset = range.endOffset;

            const contextRange = range.cloneRange();

            // Try to expand backward
            try {
                if (startContainer.nodeType === Node.TEXT_NODE) {
                    const textBefore = startContainer.textContent.substring(0, startOffset);
                    const contextStart = Math.max(0, textBefore.length - 500);
                    contextRange.setStart(startContainer, contextStart);
                } else {
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
            return contextRange.toString().substring(0, 1000);
        } catch (e) {
            console.debug('Could not extract context:', e);
            return '';
        }
    }

    /**
     * Generate cache key
     */
    generateCacheKey(text, options) {
        // Create a simple hash of the text and options
        const textHash = this.simpleHash(text.substring(0, 100));
        const optionsHash = this.simpleHash(JSON.stringify(options));
        return `${textHash}_${optionsHash}`;
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
        if (this.cache.size >= this.cacheMaxSize) {
            // Remove oldest entry (first in Map iteration)
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        this.cache.set(key, value);
    }

    /**
     * Clear cache
     */
    clearCache() {
        this.cache.clear();
    }
}

// Export to window for browser extension
window.ContextProcessor = ContextProcessor;
console.log('ContextProcessor class defined and exported to window');