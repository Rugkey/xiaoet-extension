/**
 * context-processor.js - MINIMAL TEST VERSION
 * Advanced context processing for intelligent translation
 */

console.log('TEST: Loading context-processor.js...');

class ContextProcessor {
    constructor() {
        console.log('TEST: ContextProcessor constructor called');
        this.maxContextLength = 2000;
        this.maxParagraphs = 10;
        this.cache = new Map();
        this.cacheMaxSize = 100;
    }

    async extractContext(selection, options = {}) {
        console.log('TEST: extractContext called');
        return 'test context';
    }
}

// Export to window for browser extension
window.ContextProcessor = ContextProcessor;
console.log('TEST: ContextProcessor class defined and exported to window');
