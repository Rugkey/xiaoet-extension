/**
 * context-processor.js
 * Advanced context processing for intelligent translation
 */

(function() {
    'use strict';

    try {
        console.log('Loading context-processor.js...');

        class ContextProcessor {
            constructor() {
                this.maxContextLength = 2000;
                this.maxParagraphs = 10;
                this.cache = new Map();
                this.cacheMaxSize = 100;
            }

            async extractContext(selection, options = {}) {
                const {
                    includeParagraphs = true,
                    includeHeaders = true,
                    includeAdjacentElements = true,
                    maxLength = this.maxContextLength
                } = options;

                const cacheKey = this.generateCacheKey(selection.toString(), options);

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

                    context = context.substring(0, maxLength).trim();
                    this.addToCache(cacheKey, context);

                } catch (error) {
                    console.warn('Error extracting context:', error);
                    context = this.basicContextExtraction(selection);
                }

                return context;
            }

            extractParagraphContext(selection) {
                if (!selection || selection.rangeCount === 0) return '';

                const range = selection.getRangeAt(0);
                if (!range) return '';

                let context = '';
                const selectedElement = this.findContainingBlockElement(range.commonAncestorContainer);

                if (selectedElement) {
                    const siblings = this.getSiblingsWithinLimit(selectedElement, this.maxParagraphs);

                    for (const sibling of siblings) {
                        const text = sibling.textContent || sibling.innerText || '';
                        if (text.trim().length > 10) {
                            context += text.trim() + ' ';
                        }
                    }
                }

                return context.substring(0, this.maxContextLength);
            }

            extractHeaderContext(selection) {
                if (!selection || selection.rangeCount === 0) return '';

                const range = selection.getRangeAt(0);
                if (!range) return '';

                let context = '';
                const selectedElement = this.findContainingBlockElement(range.commonAncestorContainer);

                if (selectedElement) {
                    const headings = this.findNearbyHeadings(selectedElement);
                    for (const heading of headings) {
                        context += heading.textContent.trim() + ' ';
                    }
                }

                return context.substring(0, 500);
            }

            extractAdjacentContext(selection) {
                if (!selection || selection.rangeCount === 0) return '';

                const range = selection.getRangeAt(0);
                if (!range) return '';

                let context = '';
                const selectedElement = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
                    ? range.commonAncestorContainer
                    : range.commonAncestorContainer.parentElement;

                if (selectedElement) {
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

                return context.substring(0, 800);
            }

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

            getSiblingsWithinLimit(element, limit) {
                const siblings = [];
                let current = element.previousElementSibling;
                let count = 0;

                while (current && count < limit / 2) {
                    siblings.unshift(current);
                    current = current.previousElementSibling;
                    count++;
                }

                siblings.push(element);
                count = 0;

                current = element.nextElementSibling;
                while (current && count < limit / 2) {
                    siblings.push(current);
                    current = current.nextElementSibling;
                    count++;
                }

                return siblings;
            }

            findNearbyHeadings(element) {
                const headings = [];
                let current = element;

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

            basicContextExtraction(selection) {
                if (!selection || selection.rangeCount === 0) return '';

                const range = selection.getRangeAt(0);
                if (!range) return '';

                try {
                    const contextRange = range.cloneRange();
                    const startContainer = range.startContainer;
                    const startOffset = range.startOffset;

                    try {
                        if (startContainer.nodeType === Node.TEXT_NODE) {
                            const textBefore = startContainer.textContent.substring(0, startOffset);
                            const contextStart = Math.max(0, textBefore.length - 500);
                            contextRange.setStart(startContainer, contextStart);
                        }
                    } catch (e) {
                        console.debug('Could not expand context range backward:', e);
                    }

                    return contextRange.toString().substring(0, 1000);
                } catch (e) {
                    console.debug('Could not extract context:', e);
                    return '';
                }
            }

            generateCacheKey(text, options) {
                const textHash = this.simpleHash(text.substring(0, 100));
                const optionsHash = this.simpleHash(JSON.stringify(options));
                return `${textHash}_${optionsHash}`;
            }

            simpleHash(str) {
                let hash = 0;
                for (let i = 0; i < str.length; i++) {
                    const char = str.charCodeAt(i);
                    hash = ((hash << 5) - hash) + char;
                    hash |= 0;
                }
                return Math.abs(hash).toString(36);
            }

            addToCache(key, value) {
                if (this.cache.size >= this.cacheMaxSize) {
                    const firstKey = this.cache.keys().next().value;
                    this.cache.delete(firstKey);
                }
                this.cache.set(key, value);
            }

            clearCache() {
                this.cache.clear();
            }
        }

        window.ContextProcessor = ContextProcessor;
        console.log('ContextProcessor class defined and exported to window');

    } catch (error) {
        console.error('FATAL ERROR in context-processor.js:', error);
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
    }
})();
