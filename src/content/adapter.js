/**
 * adapter.js
 * Content adaptation module for various website types
 */

class ContentAdapter {
    constructor() {
        this.siteConfigs = {
            // Academic paper sites
            'arxiv.org': {
                selectors: ['.abstract', '.dateline', '.authors'],
                preprocess: this.preprocessArxiv,
                postprocess: this.postprocessAcademic
            },
            'sciencedirect.com': {
                selectors: ['.abstract', '.keywords', 'article'],
                preprocess: this.preprocessScienceDirect,
                postprocess: this.postprocessAcademic
            },
            'springer.com': {
                selectors: ['.Abstract', '.Keyword', 'article'],
                preprocess: this.preprocessSpringer,
                postprocess: this.postprocessAcademic
            },
            'nature.com': {
                selectors: ['.c-article-section__content', '.Abs', '.Article'],
                preprocess: this.preprocessNature,
                postprocess: this.postprocessAcademic
            },
            'ieee.org': {
                selectors: ['.abstract-text', '.abstract-plus', '.document-content'],
                preprocess: this.preprocessIEEE,
                postprocess: this.postprocessAcademic
            },
            // Social media
            'twitter.com': {
                selectors: ['[data-testid="tweetText"]', '.tweet-text'],
                preprocess: this.preprocessSocial,
                postprocess: this.postprocessSocial
            },
            'facebook.com': {
                selectors: ['[data-ad-comet-preview="message"]', '[role="feed"]'],
                preprocess: this.preprocessSocial,
                postprocess: this.postprocessSocial
            },
            // News sites
            'nytimes.com': {
                selectors: ['.story-body-text', '.css-exrw3u', '.css-158dogj'],
                preprocess: this.preprocessNews,
                postprocess: this.postprocessNews
            },
            'bbc.com': {
                selectors: ['.ssrcss-10nwcm7-MainBodyContainer', '.gs-c-promo-heading'],
                preprocess: this.preprocessNews,
                postprocess: this.postprocessNews
            },
            // Generic sites
            'default': {
                selectors: ['p', 'div', 'span', 'article', '.content', '#content'],
                preprocess: this.preprocessGeneric,
                postprocess: this.postprocessGeneric
            }
        };
    }

    /**
     * Detect the current website and return appropriate config
     */
    detectSite() {
        const hostname = window.location.hostname;
        
        for (const [site, config] of Object.entries(this.siteConfigs)) {
            if (site !== 'default' && hostname.includes(site)) {
                return config;
            }
        }
        
        return this.siteConfigs.default;
    }

    /**
     * Preprocess content for specific sites
     */
    preprocessArxiv(text) {
        // Remove arXiv-specific metadata
        text = text.replace(/Abstract:\s*/, '');
        text = text.replace(/\[Submitted on.*?\]/g, '');
        return text.trim();
    }

    preprocessScienceDirect(text) {
        // Remove ScienceDirect-specific elements
        text = text.replace(/Abstract(.*)Keywords:/is, '$1');
        return text.trim();
    }

    preprocessSpringer(text) {
        // Remove Springer-specific elements
        text = text.replace(/Abstract(.*)Keywords/is, '$1');
        return text.trim();
    }

    preprocessNature(text) {
        // Remove Nature-specific elements
        text = text.replace(/Abstract(.*)Introduction/is, '$1');
        return text.trim();
    }

    preprocessIEEE(text) {
        // Remove IEEE-specific elements
        text = text.replace(/Abstract\.\s*/, '');
        return text.trim();
    }

    preprocessSocial(text) {
        // Clean social media content
        text = text.replace(/@\w+/g, ''); // Remove @mentions
        text = text.replace(/#\w+/g, ''); // Remove hashtags
        text = text.replace(/https?:\/\/\S+/g, ''); // Remove URLs
        return text.trim();
    }

    preprocessNews(text) {
        // Clean news content
        text = text.replace(/\(CNN\)|\(AP\)|\(Reuters\)/g, '');
        return text.trim();
    }

    preprocessGeneric(text) {
        // Generic preprocessing
        text = text.replace(/\s+/g, ' '); // Normalize whitespace
        return text.trim();
    }

    /**
     * Postprocess content for specific domains
     */
    postprocessAcademic(text) {
        // Academic-specific postprocessing
        // Ensure proper citation formatting
        text = text.replace(/\[(\d+)\]/g, '[$1]'); // Ensure citation brackets
        return text;
    }

    postprocessSocial(text) {
        // Social media-specific postprocessing
        return text;
    }

    postprocessNews(text) {
        // News-specific postprocessing
        return text;
    }

    postprocessGeneric(text) {
        // Generic postprocessing
        return text;
    }

    postprocessSocial(text) {
        // Social media-specific postprocessing
        return text;
    }

    postprocessNews(text) {
        // News-specific postprocessing
        return text;
    }

    postprocessGeneric(text) {
        // Generic postprocessing
        return text;
    }

    /**
     * Extract content from the page using appropriate selectors
     */
    extractContent() {
        const config = this.detectSite();
        let content = '';

        for (const selector of config.selectors) {
            const elements = document.querySelectorAll(selector);
            for (const element of elements) {
                // Skip elements that are likely UI controls or navigation
                if (this.isLikelyUIElement(element)) continue;
                
                const text = element.textContent || element.innerText || '';
                if (text && text.length > 20) { // Only extract substantial content
                    content += text + '\n\n';
                }
            }
            
            // If we found content with this selector, break
            if (content) break;
        }

        // Apply preprocessing
        return config.preprocess ? config.preprocess(content) : content;
    }

    /**
     * Check if an element is likely a UI control
     */
    isLikelyUIElement(element) {
        const uiClassNames = [
            'button', 'btn', 'nav', 'navigation', 'menu', 'footer', 
            'header', 'sidebar', 'advertisement', 'ad', 'cookie',
            'modal', 'popup', 'overlay', 'tooltip', 'dropdown'
        ];
        
        const className = (element.className || '').toLowerCase();
        const tagName = element.tagName.toLowerCase();
        
        // Check class names
        for (const name of uiClassNames) {
            if (className.includes(name)) return true;
        }
        
        // Check tag names
        return ['nav', 'footer', 'header', 'aside'].includes(tagName);
    }

    /**
     * Adapt content extraction based on page type
     */
    adaptContentForPageType() {
        const config = this.detectSite();
        const url = window.location.href;
        
        // Special handling for PDF viewers embedded in web pages
        if (url.includes('pdf') || document.querySelector('embed[type="application/pdf"]') || 
            document.querySelector('object[type="application/pdf"]')) {
            return this.handlePdfContent();
        }
        
        // Special handling for academic papers
        if (this.isAcademicPaperPage()) {
            return this.extractAcademicContent();
        }
        
        // Standard content extraction
        return this.extractContent();
    }

    /**
     * Check if the current page is an academic paper
     */
    isAcademicPaperPage() {
        const title = document.title.toLowerCase();
        const metaKeywords = document.querySelector('meta[name="keywords"]');
        const metaDescription = document.querySelector('meta[name="description"]');
        
        const academicIndicators = [
            'paper', 'research', 'journal', 'conference', 'proceedings',
            'academic', 'scholarly', 'thesis', 'dissertation'
        ];
        
        for (const indicator of academicIndicators) {
            if (title.includes(indicator)) return true;
        }
        
        if (metaKeywords && metaKeywords.content.toLowerCase().includes('paper')) {
            return true;
        }
        
        return false;
    }

    /**
     * Extract academic paper content specifically
     */
    extractAcademicContent() {
        let content = '';
        
        // Look for academic-specific sections
        const academicSelectors = [
            '.abstract', '.Abstract', '[class*="abstract"]',
            '.introduction', '[class*="introduction"]',
            '.methodology', '[class*="method"]',
            '.conclusion', '[class*="conclusion"]',
            '.results', '[class*="result"]',
            '.discussion', '[class*="discuss"]',
            'article', '.article-body', '.content'
        ];
        
        for (const selector of academicSelectors) {
            const elements = document.querySelectorAll(selector);
            for (const element of elements) {
                if (this.isLikelyUIElement(element)) continue;
                
                const text = element.textContent || element.innerText || '';
                if (text && text.length > 50) {
                    content += this.cleanAcademicText(text) + '\n\n';
                }
            }
        }
        
        return content.trim();
    }

    /**
     * Clean academic text
     */
    cleanAcademicText(text) {
        // Remove reference numbers in brackets at the beginning of sentences
        text = text.replace(/\s*\[\d+\]\s*/g, ' ');
        
        // Remove excessive whitespace
        text = text.replace(/\s+/g, ' ');
        
        // Remove page numbers and headers
        text = text.replace(/^\s*\d+\s*$/, ''); // Single digit lines (likely page numbers)
        
        return text.trim();
    }

    /**
     * Handle content from PDF viewers
     */
    handlePdfContent() {
        // This would typically handle embedded PDF content
        // For now, return a message indicating PDF handling
        return "PDF content detected. Academic viewer will handle this content appropriately.";
    }

    /**
     * Get context around selected text
     */
    getContextAroundSelection(selection) {
        if (!selection || selection.rangeCount === 0) return '';

        const range = selection.getRangeAt(0);
        if (!range) return '';

        try {
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
                    const contextStart = Math.max(0, textBefore.length - 300);
                    contextRange.setStart(startContainer, contextStart);
                } else {
                    // If not a text node, try to find text nodes in siblings
                    let prevSibling = startContainer.previousSibling;
                    let charsCollected = 0;
                    
                    while (prevSibling && charsCollected < 300) {
                        if (prevSibling.nodeType === Node.TEXT_NODE) {
                            const text = prevSibling.textContent;
                            const needed = 300 - charsCollected;
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
                    const contextEnd = Math.min(endOffset + 300, endContainer.textContent.length);
                    contextRange.setEnd(endContainer, contextEnd);
                } else {
                    // If not a text node, try to find text nodes in siblings
                    let nextSibling = endContainer.nextSibling;
                    let charsCollected = 0;
                    
                    while (nextSibling && charsCollected < 300) {
                        if (nextSibling.nodeType === Node.TEXT_NODE) {
                            const text = nextSibling.textContent;
                            const needed = 300 - charsCollected;
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
            const contextText = contextRange.toString().substring(0, 600); // Limit context to 600 chars
            return contextText;
        } catch (e) {
            console.debug('Could not extract context:', e);
            return '';
        }
    }
}

// Export to window for browser extension
window.ContentAdapter = ContentAdapter;
console.log('ContentAdapter class defined and exported to window');