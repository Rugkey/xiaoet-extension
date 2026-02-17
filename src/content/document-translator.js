/**
 * document-translator.js - MINIMAL TEST VERSION
 * Document translation functionality
 */

console.log('TEST: Loading document-translator.js...');

class DocumentTranslator {
    constructor() {
        console.log('TEST: DocumentTranslator constructor called');
        this.isTranslating = false;
    }

    async translateDocument(targetLang = 'zh-CN', engine = 'google') {
        console.log('TEST: translateDocument called');
        return { success: true, segmentsProcessed: 0 };
    }

    restoreOriginalText() {
        console.log('TEST: restoreOriginalText called');
    }
}

// Export to window for browser extension
window.DocumentTranslator = DocumentTranslator;
console.log('TEST: DocumentTranslator class defined and exported to window');
