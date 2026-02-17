/**
 * ui.js
 * Manages the ShadowDOM interactions and UI State
 */
class TranslatorUI {
    constructor() {
        this.host = null;
        this.shadow = null;
        this.card = null;
        this.icon = null;
        this.streamActive = false;

        // State
        this.engine = 'google';
        this.targetLang = 'zh-CN';
        this.pendingRect = null; // Store rect for async/stream positioning

        // Security and performance enhancements
        this.translationHistory = []; // Keep limited history for performance
        this.maxHistorySize = 10;
        this.lastUpdateTime = 0; // Throttle updates
        this.updateThrottleMs = 100; // Throttle UI updates
        
        // Lock state to prevent accidental closing
        this.isLocked = false;

        this._initHost();
        this.setupClickOutsideHandler();
    }

    _initHost() {
        if (document.getElementById('xiaoet-overlay-host')) return;

        this.host = document.createElement('div');
        this.host.id = 'xiaoet-overlay-host';
        Object.assign(this.host.style, {
            position: 'fixed', zIndex: '2147483647', left: '0', top: '0', width: '100%', height: '100%', pointerEvents: 'none'
        });
        document.body.appendChild(this.host);
        this.shadow = this.host.attachShadow({ mode: 'open' });

        // Inject Styles
        const styleEl = document.createElement('style');
        styleEl.textContent = STYLES;
        this.shadow.appendChild(styleEl);
    }

    setPendingRect(rect) {
        this.pendingRect = rect;
    }

    showLoading(autoPosition = true, rect = null) {
        this.createCard();
        this._renderLoading();
        this.card.classList.add('visible');
        if (autoPosition) this.positionCard(rect);
    }


    showResult(original, translated, mode) {
        this.createCard();
        this._renderTranslation(original, translated, mode);
        this.card.classList.add('visible');
        if (!this.card.hasAttribute('data-msg-positioned')) {
            this.positionCard(this.pendingRect);
            this.pendingRect = null; // Clear after use
        }
        
        // Add to translation history
        this._addToHistory(original, translated, mode);
    }

    startStream(original) {
        this.createCard();
        this.streamActive = true;
        this._renderTranslation(original, "", "translate", true);
        this.card.classList.add('visible');
        if (!this.card.hasAttribute('data-msg-positioned')) {
            this.positionCard(this.pendingRect);
            this.pendingRect = null; // Clear after use
        }
        
        // Add to translation history
        this._addToHistory(original, "", "translate");
    }
    
    // Add to translation history with size limiting
    _addToHistory(original, translated, mode) {
        // Sanitize inputs before storing
        const sanitizedOriginal = this._sanitizeText(original);
        const sanitizedTranslated = this._sanitizeText(translated);
        
        this.translationHistory.push({
            original: sanitizedOriginal,
            translated: sanitizedTranslated,
            mode: mode,
            timestamp: Date.now()
        });
        
        // Limit history size
        if (this.translationHistory.length > this.maxHistorySize) {
            this.translationHistory.shift(); // Remove oldest entry
        }
    }

    appendStreamChunk(chunk) {
        if (!this.card) return;
        
        // Throttle UI updates to improve performance
        const now = Date.now();
        if (now - this.lastUpdateTime < this.updateThrottleMs) {
            // Schedule update for later if we're updating too frequently
            if (!this.pendingUpdate) {
                this.pendingUpdate = chunk;
                setTimeout(() => {
                    if (this.pendingUpdate) {
                        this._applyChunkUpdate(this.pendingUpdate);
                        this.pendingUpdate = null;
                    }
                }, this.updateThrottleMs);
            } else {
                // Accumulate pending updates
                this.pendingUpdate += chunk;
            }
            return;
        }
        
        this._applyChunkUpdate(chunk);
        this.lastUpdateTime = now;
    }
    
    _applyChunkUpdate(chunk) {
        const targetEl = this.shadow.querySelector('textarea.target');
        const cursor = this.shadow.querySelector('.cursor');

        if (targetEl) {
            // Sanitize chunk before appending to prevent XSS
            const sanitizedChunk = this._sanitizeText(chunk);
            targetEl.value += sanitizedChunk;
            this._autoResize(targetEl);
            // Scroll to bottom if needed
            targetEl.scrollTop = targetEl.scrollHeight;
        }
    }

    endStream() {
        this.streamActive = false;
        const cursor = this.shadow.querySelector('.cursor');
        if (cursor) cursor.classList.add('hidden');
    }

    createCard() {
        if (this.card) return this.card;

        const el = document.createElement('div');
        el.className = 'card';
        el.innerHTML = `
            <div class="header">
                <div class="brand">
                    <svg viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zm0 9l2.5-1.25L12 8.5l-2.5 1.25L12 11zm0 2.5l-5-2.5-5 2.5L12 22l10-8.5-5-2.5-5 2.5z"/></svg>
                    <span>学术大拿</span>
                </div>
                <div class="controls">
                    <div class="select-group">
                        <select id="engineSelect">
                            <option value="google">Google</option>
                            <option value="deepseek">DeepSeek</option>
                            <option value="deepl">DeepL</option>
                            <option value="openai">OpenAI</option>
                            <option value="multi">Multi-Fusion</option>
                        </select>
                        <svg class="select-icon" viewBox="0 0 24 24"><path d="M7 10l5 5 5-5z"/></svg>
                    </div>
                    <div class="select-group">
                        <select id="domainSelect">
                            <option value="default">通用</option>
                            <option value="academic">学术</option>
                            <option value="medical">医学</option>
                            <option value="legal">法律</option>
                            <option value="technical">技术</option>
                        </select>
                        <svg class="select-icon" viewBox="0 0 24 24"><path d="M7 10l5 5 5-5z"/></svg>
                    </div>
                    <div class="select-group">
                        <select id="langSelect">
                            <option value="zh-CN">Chinese</option>
                            <option value="en">English</option>
                        </select>
                        <svg class="select-icon" viewBox="0 0 24 24"><path d="M7 10l5 5 5-5z"/></svg>
                    </div>
                    <div class="lock-btn" title="锁定悬浮窗">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 15v2m-3 0h6m-6-3v-3a3 3 0 013-3h3a3 3 0 013 3v3m-6 0h6m-6 3v3a3 3 0 003 3h3a3 3 0 003-3v-3m-6 0h6"/>
                        </svg>
                    </div>
                    <div class="close-btn" title="Close"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg></div>
                </div>
            </div>
            <div class="body-container"></div>
            <div class="action-bar">
                <button class="icon-btn" id="btnCopy" title="Copy">
                     <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
                </button>
            </div>
        `;

        this.shadow.appendChild(el);
        this.card = el;

        // Bind Events
        const header = el.querySelector('.header');
        DragHandler.makeDraggable(el, header);

        el.querySelector('.close-btn').onclick = () => this.hideCard();

        // Lock button functionality
        const lockBtn = el.querySelector('.lock-btn');
        if (lockBtn) {
            lockBtn.onclick = (e) => {
                e.stopPropagation(); // Prevent the click from bubbling up
                this.isLocked = !this.isLocked;
                this.updateLockButton();
            };
        }

        const engSel = el.querySelector('#engineSelect');
        const domainSel = el.querySelector('#domainSelect');
        const langSel = el.querySelector('#langSelect');

        // Load Props
        engSel.value = this.engine;
        domainSel.value = this.domain || 'default';  // Default to 'default' domain
        langSel.value = this.targetLang;

        engSel.onchange = (e) => {
            this.engine = e.target.value;
            Utils.setSettings({ translationEngine: this.engine });
            this._triggerReTranslate();
            this.updateEngineDisplay();
        };

        domainSel.onchange = (e) => {
            this.domain = e.target.value;
            // No need to trigger re-translation for domain change alone
        };

        langSel.onchange = (e) => {
            this.targetLang = e.target.value;
            Utils.setSettings({ targetLang: this.targetLang });
            this._triggerReTranslate();
        };

        el.querySelector('#btnCopy').onclick = () => {
            const t = this.shadow.querySelector('textarea.target');
            if (t) {
                navigator.clipboard.writeText(t.value);
                // Toast or feedback
            }
        };

        // Update lock button initially (the lockBtn was already selected and assigned earlier)
        // Use setTimeout to ensure DOM is fully rendered before updating the button
        setTimeout(() => {
            this.updateLockButton();
        }, 0);

        // Also make sure the lock button has the correct initial state immediately
        this.updateLockButton();

        // Prevent click events inside the card from bubbling up and triggering the outside click handler
        this.card.addEventListener('click', (event) => {
            event.stopPropagation();
        });

        return this.card;
    }

    hideCard() {
        if (this.card) {
            this.card.classList.remove('visible');
            setTimeout(() => {
                if (this.card) this.card.remove();
                this.card = null;
            }, 300);
        }
    }
    
    // Method to toggle lock state
    toggleLock() {
        this.isLocked = !this.isLocked;
        if (this.card) {
            this.updateLockButton();
        }
    }
    
    // Method to handle clicks outside the card
    setupClickOutsideHandler() {
        // Add document-level click handler to close when clicking outside
        document.addEventListener('click', (event) => {
            if (this.card && this.card.classList.contains('visible')) {
                // Check if the click is outside the card
                const isClickInsideCard = this.card.contains(event.target);
                const isClickOnTriggerIcon = event.target.closest('.trigger-icon') || event.target.classList.contains('trigger-icon');
                
                // Only close if not locked and clicked outside the card
                if (!this.isLocked && !isClickInsideCard && !isClickOnTriggerIcon) {
                    this.hideCard();
                }
            }
        });
        
        // Add escape key to close card
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && this.card && this.card.classList.contains('visible')) {
                this.hideCard();
            }
        });
    }

    _renderLoading() {
        const body = this.card.querySelector('.body-container');
        body.innerHTML = `
            <div class="loading-state">
                <div class="spinner"></div>
                <span class="pulse-text">Thinking...</span>
            </div>
        `;
    }

    _renderTranslation(original, translated, mode, isStreaming = false) {
        const body = this.card.querySelector('.body-container');
        
        // Different UI for different modes
        if (mode === 'ocr') {
            // OCR-specific UI
            body.innerHTML = `
                <div class="io-container">
                    <div class="io-label">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
                        </svg>
                        <span>OCR识别</span>
                        <div class="ocr-indicator">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                            </svg>
                            <span>图像翻译</span>
                        </div>
                    </div>
                    <textarea class="source" rows="1">${Utils.escapeHtml(original)}</textarea>
                </div>
                <div class="io-container target-box">
                    <div class="io-label">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 2L2 22h20L12 2zm0 3.5L19.5 20H4.5L12 5.5z"/>
                        </svg>
                        <span>AI翻译</span>
                        <div class="engine-indicator" title="当前翻译引擎">
                            <span class="engine-badge">${this.engine.toUpperCase()}</span>
                        </div>
                    </div>
                    <div style="position:relative">
                        <textarea class="target" rows="1" readonly>${Utils.escapeHtml(translated)}</textarea>
                        ${isStreaming ? '<span class="cursor"></span>' : ''}
                    </div>
                </div>
            `;
        } else if (mode === 'document') {
            // Document translation UI
            body.innerHTML = `
                <div class="io-container">
                    <div class="io-label">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
                        </svg>
                        <span>文档翻译</span>
                    </div>
                    <div class="document-translation-controls">
                        <button class="document-translation-btn" id="btnRestoreOriginal">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                                <path d="M3 3v5h5"/>
                            </svg>
                            恢复原文
                        </button>
                        <button class="document-translation-btn" id="btnExport">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                <polyline points="7,10 12,15 17,10"/>
                                <line x1="12" y1="15" x2="12" y2="3"/>
                            </svg>
                            导出翻译
                        </button>
                    </div>
                    <div class="progress-bar">
                        <div class="progress" id="document-progress"></div>
                    </div>
                </div>
            `;
            
            // Add event listeners for document translation controls
            const restoreBtn = body.querySelector('#btnRestoreOriginal');
            const exportBtn = body.querySelector('#btnExport');
            
            if (restoreBtn) {
                restoreBtn.onclick = () => {
                    document.dispatchEvent(new CustomEvent('xiaoet:restore-document'));
                };
            }
            
            if (exportBtn) {
                exportBtn.onclick = () => {
                    document.dispatchEvent(new CustomEvent('xiaoet:export-document'));
                };
            }
        } else {
            // Default translation UI
            body.innerHTML = `
                <div class="io-container">
                    <div class="io-label">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M3 3h18v18H3z"/>
                        </svg>
                        <span>原文</span>
                        <button id="btnSwap" class="swap-btn" title="交换原文和译文">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M8 7l4-4 4 4"/>
                                <path d="M12 21V3"/>
                                <path d="M16 17l-4 4-4-4"/>
                            </svg>
                        </button>
                    </div>
                    <textarea class="source" rows="1">${Utils.escapeHtml(original)}</textarea>
                </div>
                <div class="io-container target-box">
                    <div class="io-label">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 2L2 22h20L12 2zm0 3.5L19.5 20H4.5L12 5.5z"/>
                        </svg>
                        <span>AI翻译</span>
                        <div class="engine-indicator" title="当前翻译引擎">
                            <span class="engine-badge">${this.engine.toUpperCase()}</span>
                        </div>
                    </div>
                    <div style="position:relative">
                        <textarea class="target" rows="1" readonly>${Utils.escapeHtml(translated)}</textarea>
                        ${isStreaming ? '<span class="cursor"></span>' : ''}
                    </div>
                </div>
            `;
        }

        // Common functionality for default mode
        if (mode !== 'document') {
            const src = body.querySelector('.source');
            const tgt = body.querySelector('.target');

            if (src && tgt) {
                this._autoResize(src);
                this._autoResize(tgt);

                // Add swap functionality
                const swapBtn = body.querySelector('#btnSwap');
                if (swapBtn) {
                    swapBtn.onclick = () => {
                        const originalValue = src.value;
                        const translatedValue = tgt.value;

                        src.value = translatedValue;
                        tgt.value = originalValue;

                        this._autoResize(src);
                        this._autoResize(tgt);

                        // Trigger re-translation with swapped content
                        this.engine = this.engine; // Keep current engine
                        document.dispatchEvent(new CustomEvent('xiaoet:retranslate', {
                            detail: { text: src.value.trim(), engine: this.engine, targetLang: this.targetLang }
                        }));
                    };
                }

                src.oninput = () => {
                    this._autoResize(src);
                    // Enable real-time translation with debounce
                    if (this._debouncedTranslate) {
                        clearTimeout(this._debouncedTranslate);
                    }
                    this._debouncedTranslate = setTimeout(() => {
                        if (src.value.trim() !== '') {
                            document.dispatchEvent(new CustomEvent('xiaoet:retranslate', {
                                detail: { text: src.value.trim(), engine: this.engine, targetLang: this.targetLang }
                            }));
                        }
                    }, 500); // 500ms delay for real-time translation
                };

                src.onkeydown = (e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        this._triggerReTranslate();
                    }
                };
            }
        }
    }

    _autoResize(el) {
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 300) + 'px';
    }

    _triggerReTranslate() {
        const src = this.shadow.querySelector('textarea.source');
        if (src && src.value.trim()) {
            // Sanitize input before dispatching event
            const sanitizedText = this._sanitizeText(src.value.trim());
            
            // Dispatch event to Main
            document.dispatchEvent(new CustomEvent('xiaoet:retranslate', {
                detail: { text: sanitizedText, engine: this.engine, targetLang: this.targetLang }
            }));
        }
    }
    
    // Sanitize text to prevent XSS
    _sanitizeText(text) {
        if (!text || typeof text !== 'string') return '';
        
        // Basic HTML entity encoding to prevent XSS
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#x27;');
    }
    
    // Update the engine badge display
    updateEngineDisplay() {
        const engineBadge = this.shadow.querySelector('.engine-badge');
        if (engineBadge) {
            engineBadge.textContent = this.engine.toUpperCase();
        }
    }
    
    // Update the lock button display
    updateLockButton() {
        if (!this.card) return; // Ensure card exists
        
        const lockBtn = this.card.querySelector('.lock-btn');
        if (lockBtn) {
            const svg = lockBtn.querySelector('svg');
            if (svg) {
                // Clear existing paths
                while (svg.firstChild) {
                    svg.removeChild(svg.firstChild);
                }

                if (this.isLocked) {
                    // Locked icon - a closed padlock
                    svg.innerHTML = `
                        <path d="M16 10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2h8Z"/>
                        <path d="M12 15v-3m-2 3h4M8 10V7a4 4 0 1 1 8 0v3"/>
                    `;
                    lockBtn.title = '解锁悬浮窗';
                    // Add visual feedback for locked state
                    lockBtn.style.backgroundColor = 'var(--primary)';
                    lockBtn.style.color = 'white';
                } else {
                    // Unlocked icon - an open padlock
                    svg.innerHTML = `
                        <path d="M16 10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2h8Z"/>
                        <path d="M10 10V7a4 4 0 1 1 4 0v3"/>
                    `;
                    lockBtn.title = '锁定悬浮窗';
                    // Reset to default style when unlocked
                    lockBtn.style.backgroundColor = '';
                    lockBtn.style.color = '';
                }
            }
        }
    }

    positionCard(rectInfo = null) {
        if (!this.card) return;

        let rect = rectInfo;
        const sel = window.getSelection();

        if (!rect) {
            if (sel.rangeCount > 0) {
                const range = sel.getRangeAt(0);
                rect = range.getBoundingClientRect();
            }
        }

        let top = 100, left = 100;

        if (rect && (rect.width > 0 || rect.height > 0)) {
            left = rect.left + (rect.width / 2) - 240; // Center (480/2)
            top = rect.bottom + 12;

            // Boundaries
            if (left < 10) left = 10;
            if (left + 480 > window.innerWidth) left = window.innerWidth - 490;

            if (top + 300 > window.innerHeight) {
                top = rect.top - 320; // Flip up
                if (top < 10) top = 10; // Safety for flip up
            }
        }

        this.card.style.left = `${left}px`;
        this.card.style.top = `${top}px`;
        this.card.setAttribute('data-msg-positioned', 'true');
    }

    // Icon logic
    showIcon(x, y, onClick) {
        if (x <= 5 && y <= 5) return; // Fix: Prevent stuck in top-left corner
        if (this.icon) this.icon.remove();

        this.icon = document.createElement('div');
        this.icon.className = 'trigger-icon';
        this.icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8l6 6"/><path d="M4 14l6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="M22 22l-5-10-5 10"/><path d="M14 18h6"/></svg>`;

        Object.assign(this.icon.style, {
            left: `${x + 12}px`, top: `${y + 12}px`
        });

        this.icon.onmousedown = (e) => e.stopPropagation(); // prevent closing immediately
        this.icon.onclick = (e) => {
            e.stopPropagation();
            this.hideIcon();
            onClick();
        };

        this.shadow.appendChild(this.icon);

        // Animate in
        requestAnimationFrame(() => this.icon.classList.add('visible'));
    }

    hideIcon() {
        if (this.icon) {
            this.icon.classList.remove('visible');
            setTimeout(() => { if (this.icon) this.icon.remove(); this.icon = null; }, 300);
        }
    }
}

// Add event listeners for document translation
document.addEventListener('xiaoet:restore-document', () => {
    chrome.runtime.sendMessage({ type: 'TRIGGER_RESTORE_DOCUMENT' });
});

document.addEventListener('xiaoet:export-document', () => {
    chrome.runtime.sendMessage({ type: 'TRIGGER_EXPORT_DOCUMENT' });
});

// Export to window for browser extension
window.TranslatorUI = TranslatorUI;
console.log('TranslatorUI class defined and exported to window');
