/**
 * ocr-translator.js
 * OCR and image-to-text translation functionality
 */

(function() {
    'use strict';

    try {
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

        try {
            // Check if Tesseract is available (real implementation)
            if (typeof Tesseract !== 'undefined' && typeof Tesseract.createWorker !== 'undefined') {
                // Create the worker instance
                this.ocrWorker = Tesseract.createWorker({
                    logger: (progress) => {
                        console.log(`OCR Progress: ${Math.round(progress.progress * 100)}%`);
                    }
                });

                // Check if the worker has the expected methods
                const hasLoad = typeof this.ocrWorker.load === 'function';
                const hasLoadLanguage = typeof this.ocrWorker.loadLanguage === 'function';
                const hasInitialize = typeof this.ocrWorker.initialize === 'function';
                const hasRecognize = typeof this.ocrWorker.recognize === 'function';

                console.log(`Worker methods available: load=${hasLoad}, loadLanguage=${hasLoadLanguage}, initialize=${hasInitialize}, recognize=${hasRecognize}`);

                // If all required methods exist, proceed with full initialization
                if (hasLoad && hasLoadLanguage && hasInitialize) {
                    console.log('Loading Tesseract core...');
                    await this.ocrWorker.load();
                    
                    console.log('Loading English language...');
                    await this.ocrWorker.loadLanguage('eng');
                    
                    console.log('Initializing with English language...');
                    await this.ocrWorker.initialize('eng');
                    
                    this.isInitialized = true;
                    console.log('OCR Translator initialized successfully with real Tesseract.js');
                } else {
                    // If methods are missing, skip initialization and rely on global OCREngine
                    console.log('Worker methods are not available, relying on global OCREngine');
                    
                    // Check if global OCREngine is available
                    if (typeof window.OCREngine !== 'undefined') {
                        console.log('Global OCREngine is available, using as fallback');
                        this.isInitialized = true;
                    } else {
                        console.warn('Global OCREngine is not available, OCR will be limited');
                        this.isInitialized = true;
                    }
                }
            } else {
                // 如果没有找到真实的Tesseract.js库，则使用全局OCR引擎（可能是真实的也可能是模拟的）
                if (typeof window.OCREngine !== 'undefined') {
                    console.log('Using global OCREngine for OCR functionality');
                    this.isInitialized = true;
                } else {
                    console.warn('Tesseract.js not available - OCR functionality will be limited');
                    this.isInitialized = true;
                }
            }
        } catch (error) {
            console.error('Failed to initialize OCR worker:', error);
            console.error('Error details:', error.message, error.stack);
            
            // 检查Tesseract是否真的可用
            if (typeof Tesseract !== 'undefined') {
                console.log('Tesseract object exists:', typeof Tesseract);
                console.log('Tesseract.createWorker exists:', typeof Tesseract.createWorker);
                
                // 作为最后的手段，直接标记为已初始化，避免反复尝试
                this.isInitialized = true;
                console.log('OCR functionality prepared with fallback method');
            } else {
                console.log('Tesseract object is undefined');
                this.isInitialized = true;
            }
        }
    }

    /**
     * Check if Tesseract.js library is available
     * Since we load it via script tag in HTML, it should already be available
     */
    checkTesseractAvailability() {
        if (typeof Tesseract === 'undefined') {
            throw new Error('Tesseract.js library not available. Please ensure it is loaded via script tag.');
        }
        return true;
    }

    /**
     * Perform OCR on an image and translate the text
     */
    async ocrAndTranslate(imageSrc, targetLang = 'zh-CN', engine = 'google') {
        if (!this.isInitialized) {
            await this.initialize();
        }

        try {
            // 根据目标语言确定OCR语言
            const ocrLang = this.getOCRLanguageForTarget(targetLang);
            
            // Perform OCR
            const result = await this.performOCR(imageSrc, ocrLang);

            if (!result || !result.data || !result.data.text) {
                throw new Error('OCR failed to extract text from image');
            }

            // Clean up the extracted text to remove noise and improve readability
            let extractedText = result.data.text.trim();
            extractedText = this.cleanOCRResult(extractedText);
            
            // Apply additional post-processing for academic text
            extractedText = this.postProcessAcademicText(extractedText);

            // Translate the cleaned extracted text
            const translatedText = await this.translateText(extractedText, targetLang, engine);

            return {
                original: extractedText,
                translated: translatedText,
                confidence: result.data.confidence || 95
            };
        } catch (error) {
            console.error('OCR and translation failed:', error);
            
            // 如果常规方法失败，尝试使用全局OCREngine
            if (typeof window.OCREngine !== 'undefined') {
                try {
                    console.log('Falling back to global OCREngine');
                    let extractedText = await window.OCREngine.recognize(imageSrc, [this.getOCRLanguageForTarget(targetLang)]);
                    extractedText = this.cleanOCRResult(extractedText);
                    extractedText = this.postProcessAcademicText(extractedText);
                    const translatedText = await this.translateText(extractedText, targetLang, engine);
                    
                    return {
                        original: extractedText,
                        translated: translatedText,
                        confidence: 95
                    };
                } catch (fallbackError) {
                    console.error('Fallback OCR also failed:', fallbackError);
                    throw error; // 重新抛出原始错误
                }
            } else {
                throw error; // 重新抛出原始错误
            }
        }
    }
    
    /**
     * Post-process academic text to improve readability
     */
    postProcessAcademicText(text) {
        if (!text) return text;
        
        let processed = text;
        
        // Academic text specific processing
        // Fix common academic text issues
        
        // Replace common OCR errors in mathematical expressions
        processed = processed.replace(/(\d)\s*[oO0]\s*(\d)/g, '$1,$2'); // Fix comma in numbers
        processed = processed.replace(/(\d)\s*[oO0]\s*([+\-=])/g, '$1.$2'); // Fix decimal points
        processed = processed.replace(/([+\-=])\s*[oO0]\s*(\d)/g, '$1.$2'); // Fix decimal points
        
        // Fix common formula patterns
        processed = processed.replace(/([a-zA-Z])\s*([+\-*/=])\s*([a-zA-Z\d])/g, '$1 $2 $3'); // Add spaces in formulas
        processed = processed.replace(/(\d)\s*([+\-*/=])\s*(\d)/g, '$1 $2 $3'); // Add spaces in numeric expressions
        
        // Improve citation and reference formatting
        processed = processed.replace(/\[\s*(\d+)\s*\]/g, '[$1]'); // Fix citation brackets
        processed = processed.replace(/\(\s*([^)]+)\s*\)/g, '($1)'); // Fix parentheses
        processed = processed.replace(/\{\s*([^}]+)\s*\}/g, '{$1}'); // Fix braces
        
        // Handle common academic abbreviations
        processed = processed.replace(/\b(Fig|Eq|Ref|Tab|Sec|Ch|pp?)\s*\.?\s*(\d+)/gi, '$1. $2'); // Standardize academic abbreviations
        
        // Remove extra spaces around punctuation (but preserve spaces in formulas)
        processed = processed.replace(/\s*([,.!?;:])\s*/g, '$1 '); // Spaces after punctuation
        processed = processed.replace(/\s+/g, ' '); // Multiple spaces to single space
        
        // Trim and return
        return processed.trim();
    }
    
    /**
     * Clean up OCR result to remove noise and improve readability
     */
    cleanOCRResult(text) {
        if (!text) return text;
        
        // Remove extra whitespace and normalize spaces
        let cleaned = text.replace(/\s+/g, ' ').trim();
        
        // Fix the specific pattern mentioned: "R 6 ITI 0 vrrot 00 IIII 0 IIIoor G I t"
        // Remove spaces between individual characters that shouldn't be separated
        cleaned = cleaned.replace(/([A-Za-z])\s+(?=[A-Za-z]\s+[A-Za-z])/g, '$1'); // Remove space when letter is followed by spaced letters
        cleaned = cleaned.replace(/([A-Z])\s+(?=[A-Z])/g, '$1'); // Remove space between consecutive uppercase letters
        
        // Fix common OCR artifacts like repeated characters
        // This removes sequences of the same character that are likely OCR errors
        cleaned = cleaned.replace(/(.)\1{2,}/g, '$1$1'); // Keep max 2 consecutive identical chars
        
        // Fix common OCR mistakes in academic/scientific texts
        cleaned = cleaned.replace(/(\d)O(\d)/g, '$10$2'); // Replace O between digits with 0
        cleaned = cleaned.replace(/O(?=\d)/g, '0'); // Replace O followed by digit with 0
        cleaned = cleaned.replace(/(\d)O$/g, '$10'); // Replace O at end after digit with 0
        
        // Replace common confusions in OCR - academic context aware
        // Common misrecognition patterns in academic documents
        // Replace commonly confused characters: |, l, 1, I, 0, O
        cleaned = cleaned.replace(/[\|l1]\s+(?=[A-Z])/g, 'I'); // Replace |, l, 1 followed by space and letter with I
        cleaned = cleaned.replace(/[\|l1]/g, 'I'); // Replace |, l, 1 with I
        cleaned = cleaned.replace(/[oO0]/g, 'O'); // Replace o, 0 with O for better readability
        
        // Remove spaces that separate characters in words
        cleaned = cleaned.replace(/([A-Za-z])\s+(?=[A-Za-z])/g, '$1'); // Remove space between letters that should form a word
        
        // Academic text specific patterns
        cleaned = cleaned.replace(/(\d)[oO0](?=\s*[+\-*=/])/g, '$1.'); // Replace O after digit before operators with .
        cleaned = cleaned.replace(/(?<=[+\-*=/])[oO0](\d)/g, '.$1'); // Replace O before digit after operators with .
        
        // Remove lines that are mostly garbage characters
        const lines = cleaned.split('\n');
        const filteredLines = lines.filter(line => {
            if (!line.trim()) return false; // Remove empty lines
            
            // Calculate ratio of alphanumeric characters to total length
            const alphaNumCount = (line.match(/[a-zA-Z0-9]/g) || []).length;
            const ratio = alphaNumCount / line.length;
            
            // Keep lines that have at least 10% alphanumeric characters
            // This helps remove lines with mostly symbols or noise
            if (ratio >= 0.10) return true;
            
            // Also keep lines that might be academic formulas or references
            // For example, lines with numbers, operators, or citation patterns
            if (/[0-9]/.test(line) && /[a-zA-Z]/.test(line)) return true; // Has both letters and numbers
            if (/\[[0-9]+\]/.test(line)) return true; // Citation pattern [1], [2], etc.
            if (/(eq\.|equation|fig\.|figure|ref\.|reference)/i.test(line)) return true; // Academic terms
            
            // Keep lines with meaningful content even if they have special chars
            const wordCount = line.trim().split(/\s+/).filter(word => word.length > 0).length;
            return wordCount >= 1 && line.length <= 150; // At least 1 word and not too long
        });
        
        cleaned = filteredLines.join('\n').trim();
        
        // Remove excessive empty lines
        cleaned = cleaned.replace(/\n\s*\n\s*\n/g, '\n\n'); // Replace 3+ consecutive empty lines with 2
        
        // Additional cleaning for common OCR artifacts in academic texts
        cleaned = cleaned.replace(/[^a-zA-Z0-9\s\.\,\!\?\;\:\-\n\"\''\(\)\[\]\{\}\/\\]/g, match => {
            // Replace uncommon symbols that are likely OCR errors
            // But preserve common academic punctuation and symbols
            return ' ';
        });
        
        // Normalize multiple consecutive punctuation marks
        cleaned = cleaned.replace(/([.!?]){2,}/g, '$1');
        
        // Fix common academic text issues
        cleaned = cleaned.replace(/([a-z])([A-Z])/g, '$1 $2'); // Space between lowercase and uppercase (wordWord)
        cleaned = cleaned.replace(/(\d)([a-zA-Z])/g, '$1 $2'); // Space between digit and letter
        cleaned = cleaned.replace(/([a-zA-Z])(\d)/g, '$1 $2'); // Space between letter and digit
        
        // Remove common OCR noise patterns
        cleaned = cleaned.replace(/\s+/g, ' '); // Multiple spaces to single space
        cleaned = cleaned.trim();
        
        return cleaned;
    }
    
    /**
     * 根据目标语言确定OCR语言
     */
    getOCRLanguageForTarget(targetLang) {
        switch (targetLang) {
            case 'zh-CN':  // 简体中文
                return 'chi_sim';
            case 'zh-TW':  // 繁体中文
                return 'chi_tra';
            case 'ja':     // 日语
                return 'jpn';
            case 'ko':     // 韩语
                return 'kor';
            case 'fr':     // 法语
                return 'fra';
            case 'de':     // 德语
                return 'deu';
            case 'ru':     // 俄语
                return 'rus';
            case 'es':     // 西班牙语
                return 'spa';
            case 'ar':     // 阿拉伯语
                return 'ara';
            case 'it':     // 意大利语
                return 'ita';
            case 'pt':     // 葡萄牙语
                return 'por';
            default:       // 默认英语
                return 'eng';
        }
    }

    /**
     * Perform OCR on an image
     */
    async performOCR(imageSrc, language = 'eng') {
        // First, try to use the global OCREngine if available (handles various Tesseract versions)
        if (typeof window.OCREngine !== 'undefined') {
            try {
                const recognizedText = await window.OCREngine.recognize(imageSrc, [language]);
                return {
                    data: {
                        text: recognizedText,
                        confidence: 95 // Default confidence
                    }
                };
            } catch (error) {
                console.error('Global OCREngine failed:', error);
                
                // If global OCREngine fails, try to use worker as fallback
                if (this.ocrWorker) {
                    try {
                        // Check if recognize method exists
                        if (typeof this.ocrWorker.recognize === 'function') {
                            const result = await this.ocrWorker.recognize(imageSrc);
                            return result;
                        } else {
                            console.error('Worker.recognize() method not available');
                        }
                    } catch (workerError) {
                        console.error('Worker OCR also failed:', workerError);
                    }
                }
                
                // If both fail, throw the original error
                throw error;
            }
        }
        
        // If global OCREngine is not available, try the worker approach
        if (this.ocrWorker) {
            try {
                // Check if recognize method exists
                if (typeof this.ocrWorker.recognize === 'function') {
                    const result = await this.ocrWorker.recognize(imageSrc);
                    return result;
                } else {
                    console.error('Worker.recognize() method not available');
                    
                    // If worker methods are not available, throw an error to trigger fallback
                    throw new Error('Worker methods not available');
                }
            } catch (error) {
                console.error('Error during OCR recognition:', error);
                
                // If everything fails, throw an error that will trigger the fallback in ocrAndTranslate
                throw new Error('OCR recognition failed at all levels');
            }
        }
        
        // If no OCR engine is available, throw an error
        throw new Error('OCR engine not available');
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

        window.OCRTranslator = OCRTranslator;
        console.log('OCRTranslator class defined and exported to window');

    } catch (error) {
        console.error('FATAL ERROR in ocr-translator.js:', error);
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
    }
})();