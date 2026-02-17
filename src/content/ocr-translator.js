/**
 * ocr-translator.js - MINIMAL TEST VERSION
 * OCR and image-to-text translation functionality
 */

console.log('TEST: Loading ocr-translator.js...');

class OCRTranslator {
    constructor() {
        console.log('TEST: OCRTranslator constructor called');
        this.ocrWorker = null;
        this.isInitialized = false;
    }

    async initialize() {
        console.log('TEST: OCRTranslator initialize called');
        this.isInitialized = true;
        return Promise.resolve();
    }

    async ocrAndTranslate(imageSrc, targetLang = 'zh-CN', engine = 'google') {
        console.log('TEST: ocrAndTranslate called');
        return { original: 'test', translated: 'test', confidence: 0 };
    }
}

// Export to window for browser extension
window.OCRTranslator = OCRTranslator;
console.log('TEST: OCRTranslator class defined and exported to window');
