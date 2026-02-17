/**
 * ocr-translator.js
 * OCR and image-to-text translation functionality
 */

console.log('Loading ocr-translator.js...');

class OCRTranslator {
    constructor() {
        this.ocrWorker = null;
        this.isInitialized = false;
        this.tesseractWorkerPromise = null;
    }

    /**
     * Initialize OCR worker
     */
    async initialize() {
        if (this.isInitialized) return;

        // Dynamically load Tesseract.js if not already loaded
        if (typeof Tesseract === 'undefined') {
            await this.loadTesseractLibrary();
        }

        this.ocrWorker = Tesseract.createWorker({
            logger: (progress) => {
                console.log(`OCR Progress: ${Math.round(progress.progress * 100)}%`);
            }
        });

        await this.ocrWorker.load();
        await this.ocrWorker.loadLanguage('eng');
        await this.ocrWorker.initialize('eng');

        this.isInitialized = true;
        console.log('OCR Translator initialized successfully');
    }

    /**
     * Load Tesseract.js library dynamically
     */
    async loadTesseractLibrary() {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@4/dist/tesseract.min.js';
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('Failed to load Tesseract.js'));
            document.head.appendChild(script);
        });
    }

    /**
     * Perform OCR on an image and translate the text
     */
    async ocrAndTranslate(imageSrc, targetLang = 'zh-CN', engine = 'google') {
        if (!this.isInitialized) {
            await this.initialize();
        }

        try {
            // Perform OCR
            const result = await this.performOCR(imageSrc);

            if (!result || !result.data || !result.data.text) {
                throw new Error('OCR failed to extract text from image');
            }

            const extractedText = result.data.text.trim();

            // Translate the extracted text
            const translatedText = await this.translateText(extractedText, targetLang, engine);

            return {
                original: extractedText,
                translated: translatedText,
                confidence: result.data.confidence
            };
        } catch (error) {
            console.error('OCR and translation failed:', error);
            throw error;
        }
    }

    /**
     * Perform OCR on an image
     */
    async performOCR(imageSrc) {
        if (!this.ocrWorker) {
            throw new Error('OCR worker not initialized');
        }

        return await this.ocrWorker.recognize(imageSrc);
    }

    /**
     * Translate text using background service
     */
    async translateText(text, targetLang, engine) {
        return new Promise((resolve, reject) => {
            const messageId = `ocr_translate_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            // Listen for response
            const responseListener = (request, sender, sendResponse) => {
                if (request.type === 'OCR_TRANSLATION_RESULT' && request.id === messageId) {
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
                type: 'REQUEST_OCR_TRANSLATE',
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
     * Process image from file input
     */
    async processImageFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            
            reader.onload = async (e) => {
                try {
                    const imageData = e.target.result;
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    const img = new Image();

                    img.onload = async () => {
                        // Resize image for better OCR results
                        const maxWidth = 1200;
                        const maxHeight = 1600;
                        
                        let { width, height } = img;
                        if (width > maxWidth || height > maxHeight) {
                            const ratio = Math.min(maxWidth / width, maxHeight / height);
                            width *= ratio;
                            height *= ratio;
                        }

                        canvas.width = width;
                        canvas.height = height;
                        ctx.drawImage(img, 0, 0, width, height);

                        // Convert to data URL
                        const resizedImageData = canvas.toDataURL('image/jpeg', 0.8);
                        resolve(resizedImageData);
                    };

                    img.onerror = () => reject(new Error('Failed to load image'));
                    img.src = imageData;
                } catch (error) {
                    reject(error);
                }
            };

            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsDataURL(file);
        });
    }

    /**
     * Extract text from screenshot of selected area
     */
    async extractFromScreenshot(area) {
        // This would capture a screenshot of the specified area
        // and perform OCR on it. For now, returning a promise
        // that indicates this functionality is not yet implemented
        return new Promise((resolve) => {
            // TODO: Implement actual screenshot capture
            console.warn('Screenshot OCR functionality not yet implemented');
            resolve(null);
        });
    }

    /**
     * Cleanup resources
     */
    async destroy() {
        if (this.ocrWorker) {
            await this.ocrWorker.terminate();
            this.ocrWorker = null;
        }
        this.isInitialized = false;
    }
}

// Export to window for browser extension
window.OCRTranslator = OCRTranslator;
console.log('OCRTranslator class defined and exported to window');