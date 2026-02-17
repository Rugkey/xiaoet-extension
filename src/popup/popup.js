/**
 * popup.js
 * Simplified portal to open the main Options/Dashboard page.
 */

document.addEventListener('DOMContentLoaded', () => {
    // Open full settings page
    document.getElementById('openSettings').onclick = () => {
        if (chrome.runtime.openOptionsPage) {
            chrome.runtime.openOptionsPage();
        } else {
            window.open(chrome.runtime.getURL('options.html'));
        }
    };

    // Placeholder for direct PDF opening
    document.getElementById('openPdf').onclick = () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('src/pdf/web/academic-viewer.html') });
    };
});