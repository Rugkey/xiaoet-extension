/**
 * styles.js
 * Contains the CSS for the ShadowDOM UI
 */
const STYLES = `
:host {
    --primary: #4136f1;       /* Bright Blue */
    --primary-dark: #3027c9;  /* Darker Blue */
    --primary-light: #5a4dff;  /* Light Blue */
    --primary-gradient: linear-gradient(135deg, #4136f1 0%, #8b5cf6 100%);
    --secondary: #8b5cf6;     /* Purple */
    --success: #10b981;       /* Green */
    --warning: #f59e0b;       /* Amber */
    --danger: #ef4444;        /* Red */
    --bg-glass: rgba(255, 255, 255, 0.90);
    --bg-glass-dark: rgba(15, 23, 42, 0.90);
    --bg-card: rgba(255, 255, 255, 0.7);
    --bg-card-dark: rgba(30, 41, 59, 0.8);
    --text-main: #0f172a;     /* Slate 900 */
    --text-sub: #64748b;      /* Slate 500 */
    --text-light: #94a3b8;    /* Slate 400 */
    --border-light: rgba(255, 255, 255, 0.2);
    --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
    --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
    --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
    --shadow-xl: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
    --shadow-2xl: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
    --backdrop-blur: blur(24px);
    --glass-bg: rgba(255, 255, 255, 0.7);
    --glass-border: rgba(255, 255, 255, 0.18);

    font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    color: var(--text-main);
    pointer-events: auto;
}

@media (prefers-color-scheme: dark) {
    :host {
        --bg-glass: var(--bg-glass-dark);
        --bg-card: var(--bg-card-dark);
        --text-main: #f1f5f9;
        --text-sub: #cbd5e1;
        --text-light: #94a3b8;
        --shadow-xl: 0 20px 25px -5px rgba(0, 0, 0, 0.3), 0 10px 10px -5px rgba(0, 0, 0, 0.2);
        --glass-bg: rgba(30, 30, 36, 0.7);
        --glass-border: rgba(30, 30, 36, 0.18);
    }
}

* { box-sizing: border-box; }

/* Scrollbar */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }
::-webkit-scrollbar-track { background: transparent; }
@media (prefers-color-scheme: dark) {
    ::-webkit-scrollbar-thumb { background: #475569; }
}

/* Main Card */
.card {
    position: fixed;
    pointer-events: auto;
    background: var(--glass-bg);
    backdrop-filter: var(--backdrop-blur);
    -webkit-backdrop-filter: var(--backdrop-blur);
    border-radius: 20px;
    box-shadow: var(--shadow-2xl);
    width: 600px;
    max-width: 90vw;
    min-height: 200px;
    display: flex;
    flex-direction: column;
    opacity: 0;
    transform: translateY(10px) scale(0.96);
    transition: opacity 0.3s ease, transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    border: 1px solid var(--glass-border);
    overflow: hidden;
    z-index: 999999;
    position: relative; /* For absolute close btn */
    animation: slideIn 0.4s ease-out forwards;
}

@keyframes slideIn {
  0% {
    opacity: 0;
    transform: scale(0.95) translateY(20px);
  }
  100% {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

.card.visible {
    opacity: 1;
    transform: translateY(0) scale(1);
}

/* Header */
.header {
    padding: 18px 20px 16px 20px; /* More balanced padding */
    border-bottom: 1px solid var(--glass-border);
    display: flex;
    justify-content: space-between;
    align-items: center;
    cursor: grab;
    user-select: none;
    background: transparent;
    position: relative;
    z-index: 2;
}
.header:active { cursor: grabbing; }

.brand {
    font-weight: 700;
    color: var(--text-main);
    display: flex;
    align-items: center;
    gap: 6px; /* Reduced gap */
    font-size: 14px; /* Smaller font */
    letter-spacing: -0.02em;
    flex-direction: row; /* Ensure horizontal layout */
    white-space: nowrap; /* Prevent text wrapping */
    flex-shrink: 0; /* Don't allow shrinking */
}
.brand span {
    display: inline-block; /* Ensure text renders horizontally */
    writing-mode: horizontal-tb; /* Ensure horizontal text flow */
    max-width: 60px; /* Limit width of brand text */
    overflow: hidden;
    text-overflow: ellipsis; /* Truncate if needed */
}
.brand svg {
    width: 20px; /* Smaller icon */
    height: 20px;
    fill: var(--primary);
}

.controls {
    display: flex;
    gap: 8px; /* Reduced gap to save space */
    align-items: center;
    flex-wrap: wrap; /* Allow wrapping if needed */
    max-width: calc(100% - 80px); /* Leave space for lock/close buttons */
}

/* Selectors */
.select-group {
    position: relative;
    display: flex;
    align-items: center;
    background: var(--bg-card);
    border-radius: 12px;
    padding: 6px 24px 6px 10px; /* Reduced padding */
    transition: all 0.2s ease;
    box-shadow: var(--shadow-sm);
    border: 1px solid var(--glass-border);
    min-width: 100px; /* Reduced min-width */
    max-width: 120px; /* Limit width to prevent overflow */
    backdrop-filter: var(--backdrop-blur);
    flex-shrink: 1; /* Allow shrinking */
}
.select-group:hover {
    background: rgba(65, 54, 241, 0.1);
    box-shadow: var(--shadow-md);
    border-color: var(--primary);
}

select {
    appearance: none;
    background: transparent;
    border: none;
    font-size: 12px; /* Slightly smaller font */
    font-weight: 500;
    color: var(--text-main);
    cursor: pointer;
    outline: none;
    width: 100%;
    padding-right: 16px; /* Reduced padding */
    text-overflow: ellipsis; /* Truncate long text */
    overflow: hidden; /* Hide overflow */
}
.select-icon {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    width: 12px;
    height: 12px;
    pointer-events: none;
    fill: var(--text-sub);
}

/* Close Button */
.lock-btn, .close-btn {
    width: 32px; /* Smaller buttons */
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    cursor: pointer;
    color: var(--text-sub);
    transition: all 0.2s ease;
    background: rgba(0,0,0,0.05);
    border: 1px solid var(--glass-border);
    margin-left: 6px; /* Reduced spacing */
    flex-shrink: 0; /* Prevent button from shrinking */
}
.lock-btn:hover, .close-btn:hover {
    background: var(--primary);
    color: white;
    transform: scale(1.1);
    border-color: var(--primary);
}
.close-btn:hover {
    background: var(--danger);
    border-color: var(--danger);
}

/* Swap Button */
.swap-btn {
    background: transparent;
    border: 1px solid var(--glass-border);
    border-radius: 8px;
    padding: 6px;
    cursor: pointer;
    color: var(--text-sub);
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    backdrop-filter: var(--backdrop-blur);
}
.swap-btn:hover {
    background: rgba(59, 130, 246, 0.1);
    color: var(--primary);
    border-color: var(--primary);
}

/* Engine Badge */
.engine-badge {
    background: var(--primary-gradient);
    color: white;
    padding: 3px 10px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    box-shadow: 0 2px 6px rgba(65, 54, 241, 0.3);
}

/* Content Area */
.body-container {
    padding: 0;
    display: flex;
    flex-direction: column;
    position: relative;
}

.io-container {
    padding: 20px;
    border-bottom: 1px solid var(--glass-border);
    position: relative;
    transition: all 0.3s ease;
    background: transparent;
}
.io-container:last-child {
    border-bottom: none;
}

.io-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-sub);
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
}
.io-label span {
    flex: 1;
}
.io-label svg {
    flex-shrink: 0;
}

textarea {
    width: 100%;
    border: 1px solid var(--glass-border);
    border-radius: 12px;
    resize: none;
    background: var(--glass-bg);
    font-family: inherit;
    font-size: 14px;
    line-height: 1.6;
    outline: none;
    padding: 14px;
    color: var(--text-main);
    display: block;
    min-height: 80px;
    max-height: 200px;
    transition: all 0.2s ease;
    backdrop-filter: var(--backdrop-blur);
}
textarea:focus {
    border-color: var(--primary);
    box-shadow: 0 0 0 3px rgba(65, 54, 241, 0.2);
}
textarea:read-only {
    background: rgba(0,0,0,0.02);
}

/* Target Specifics */
.target-box {
    background: rgba(139, 92, 246, 0.05); /* Secondary purple tint */
}
@media (prefers-color-scheme: dark) {
    .target-box { background: rgba(139, 92, 246, 0.1); }
}

textarea.target {
    font-weight: 500;
    color: #4f46e5; /* Indigo color for translated text */
}
@media (prefers-color-scheme: dark) {
    textarea.target {
        color: #a5b4fc; /* Lighter indigo for dark mode */
    }
}

/* Streaming Cursor */
.cursor {
    display: inline-block;
    width: 6px;
    height: 1.2em;
    background: var(--primary);
    vertical-align: text-bottom;
    margin-left: 2px;
    animation: blink 1s step-end infinite;
}
.cursor.hidden { display: none; }
@keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }


/* Loading */
.loading-state {
    padding: 60px 20px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 20px;
    color: var(--text-sub);
    text-align: center;
}
.spinner {
    width: 44px;
    height: 44px;
    border: 3px solid rgba(65, 54, 241, 0.2);
    border-top: 3px solid var(--primary);
    border-radius: 50%;
    animation: spin 1s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* Footer Actions */
.action-bar {
    padding: 16px 20px;
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    border-top: 1px solid var(--glass-border);
    background: transparent;
}

.icon-btn {
    background: var(--primary-gradient);
    color: white;
    border: none;
    border-radius: 12px;
    padding: 10px 18px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 500;
    transition: all 0.2s ease;
    box-shadow: 0 4px 12px rgba(65, 54, 241, 0.25);
}
.icon-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 16px rgba(65, 54, 241, 0.35);
}
.icon-btn:active {
    transform: translateY(0);
}

/* Icon (Trigger) */
.trigger-icon {
    position: fixed;
    pointer-events: auto;
    z-index: 2147483646;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: var(--primary-gradient);
    box-shadow: 0 4px 20px rgba(65, 54, 241, 0.4);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    transform: scale(0) rotate(-15deg);
    opacity: 0;
    animation: pulse 2s infinite;
}
@keyframes pulse {
  0% { box-shadow: 0 0 0 0 rgba(65, 54, 241, 0.4); }
  70% { box-shadow: 0 0 0 12px rgba(65, 54, 241, 0); }
  100% { box-shadow: 0 0 0 0 rgba(65, 54, 241, 0); }
}
.trigger-icon.visible {
    transform: scale(1) rotate(0deg);
    opacity: 1;
}
.trigger-icon:hover {
    transform: scale(1.15) translateY(-3px);
    box-shadow: 0 6px 24px rgba(65, 54, 241, 0.5);
}

/* Document Translation Controls */
.document-translation-controls {
    display: flex;
    gap: 10px;
    margin-top: 10px;
}

.document-translation-btn {
    flex: 1;
    background: var(--primary-gradient);
    color: white;
    border: none;
    border-radius: 12px;
    padding: 10px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    transition: all 0.2s ease;
    box-shadow: 0 2px 8px rgba(65, 54, 241, 0.2);
}

.document-translation-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(65, 54, 241, 0.3);
}

.document-translation-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none;
    box-shadow: none;
}

.progress-bar {
    width: 100%;
    height: 6px;
    background: var(--glass-border);
    border-radius: 3px;
    overflow: hidden;
    margin-top: 10px;
}

.progress {
    height: 100%;
    background: var(--primary-gradient);
    width: 0%;
    transition: width 0.3s ease;
}

/* OCR Container */
.ocr-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 400px;
}

.ocr-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 20px;
    border-bottom: 1px solid var(--glass-border);
    background: rgba(255, 255, 255, 0.1);
}

.ocr-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    color: var(--text-main);
}

.ocr-actions {
    display: flex;
    gap: 8px;
}

.btn-secondary {
    background: rgba(0, 0, 0, 0.05);
    color: var(--text-main);
    border: 1px solid var(--glass-border);
    border-radius: 8px;
    padding: 8px 12px;
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    font-size: 13px;
    transition: all 0.2s ease;
}

.btn-secondary:hover {
    background: rgba(65, 54, 241, 0.1);
    border-color: var(--primary);
    color: var(--primary);
}

.btn-primary {
    background: var(--primary-gradient);
    color: white;
    border: none;
    border-radius: 8px;
    padding: 10px 16px;
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    transition: all 0.2s ease;
}

.btn-primary:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(65, 54, 241, 0.3);
}

.btn-accent {
    background: var(--secondary);
    color: white;
    border: none;
    border-radius: 8px;
    padding: 10px 16px;
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    transition: all 0.2s ease;
}

.btn-accent:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(139, 92, 246, 0.3);
}

.ocr-image-preview {
    padding: 20px;
    text-align: center;
    border-bottom: 1px solid var(--glass-border);
    background: rgba(0, 0, 0, 0.02);
}

.image-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 30px;
    color: var(--text-sub);
    min-height: 150px;
}

.image-placeholder svg {
    margin-bottom: 15px;
    opacity: 0.6;
}

.ocr-process-area {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 0 20px;
    flex: 1;
    overflow: auto;
}

.ocr-input-section, .ocr-translate-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.ocr-footer {
    padding: 20px;
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    border-top: 1px solid var(--glass-border);
    background: rgba(255, 255, 255, 0.1);
}

.ocr-indicator {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: rgba(255, 165, 0, 0.1);
    color: #FFA500;
    padding: 4px 10px;
    border-radius: 12px;
    font-size: 12px;
    margin-top: 8px;
}

.ocr-indicator svg {
    width: 12px;
    height: 12px;
}

`;

// Export to window for browser extension
window.STYLES = STYLES;
console.log('STYLES constant defined and exported to window');
