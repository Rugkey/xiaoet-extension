/**
 * utils.js
 * Helper functions
 */

const Utils = {
    escapeHtml: (text) => {
        if (!text) return "";
        return text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#x27;");
    },

    // Enhanced debouncing with trailing execution
    debounce: (func, wait, immediate = false) => {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                timeout = null;
                if (!immediate) func.apply(this, args);
            };
            const callNow = immediate && !timeout;
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
            if (callNow) func.apply(this, args);
        };
    },

    // Throttle function to limit execution frequency
    throttle: (func, limit) => {
        let inThrottle;
        return function() {
            const args = arguments;
            const context = this;
            if (!inThrottle) {
                func.apply(context, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    },

    // Enhanced ID generator with crypto API if available
    uid: () => {
        if (window.crypto && window.crypto.getRandomValues) {
            const array = new Uint32Array(1);
            window.crypto.getRandomValues(array);
            return Date.now().toString(36) + array[0].toString(36);
        }
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    },

    // Enhanced storage wrapper with error handling
    getSettings: (keys, callback) => {
        chrome.storage.sync.get(keys, (items) => {
            if (chrome.runtime.lastError) {
                console.error('Storage get error:', chrome.runtime.lastError);
                // Return default values in case of error
                if (typeof callback === 'function') {
                    const defaultItems = {};
                    if (Array.isArray(keys)) {
                        keys.forEach(key => defaultItems[key] = '');
                    } else if (typeof keys === 'object') {
                        Object.assign(defaultItems, keys);
                    }
                    callback(defaultItems);
                }
            } else if (typeof callback === 'function') {
                callback(items);
            }
        });
    },

    setSettings: (items) => {
        chrome.storage.sync.set(items, () => {
            if (chrome.runtime.lastError) {
                console.error('Storage set error:', chrome.runtime.lastError);
            }
        });
    },

    // Safe string truncation to prevent extremely long strings
    truncateString: (str, maxLength = 10000) => {
        if (!str || typeof str !== 'string') return '';
        return str.length > maxLength ? str.substring(0, maxLength) + '...' : str;
    },

    // Validate and sanitize text before processing
    validateAndSanitize: (text, maxLength = 10000) => {
        if (!text || typeof text !== 'string') return '';
        // Remove potential script tags and dangerous characters
        let sanitized = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
        return Utils.truncateString(sanitized, maxLength);
    },

    // Memory management utilities
    gc: () => {
        // Trigger garbage collection hint (works in some browsers)
        if (window.gc) {
            window.gc();
        }
    },

    // Calculate object size in bytes
    getObjectSize: (obj) => {
        const str = JSON.stringify(obj);
        return new Blob([str]).size;
    },

    // Format bytes to human readable form
    formatBytes: (bytes, decimals = 2) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }
};

// Export to window for browser extension
window.Utils = Utils;
console.log('Utils object defined and exported to window');
