const MODELS = {
    'deepseek': [
        { value: 'deepseek-chat', label: 'DeepSeek Chat (V3)' }
    ],
    'openai': [
        { value: 'gpt-4o', label: 'GPT-4o (Latest)' },
        { value: 'gpt-4o-mini', label: 'GPT-4o Mini (Fast)' },
        { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' }
    ],
    'google': [{ value: 'default', label: 'Default (NMT)' }],
    'deepl': [{ value: 'default', label: 'Default (Neural)' }],
    'multi': [{ value: 'fusion', label: 'Multi-Engine Fusion' }]  // Add multi-engine option
};

// The medical profile exists in the HTML select element, not in MODELS
// This is correct since promptProfile is handled separately from translation engines

document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    restoreOptions();

    document.getElementById('saveBtn').addEventListener('click', saveOptions);

    // Auto-update model list on engine change
    document.getElementById('engineSelect').addEventListener('change', updateModelList);


    // Auto-save on some changes if desired
    document.getElementById('darkModeToggle').addEventListener('change', (e) => {
        document.documentElement.setAttribute('data-theme', e.target.checked ? 'dark' : 'light');
    });
});

/**
 * Handle Sidebar Navigation
 */
function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    const sections = document.querySelectorAll('.content-section');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const targetAction = item.getAttribute('data-section');

            // Update Sidebar UI
            navItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');

            // Switch Sections with Animation
            sections.forEach(sec => {
                sec.classList.remove('active');
                if (sec.id === `section-${targetAction}`) {
                    sec.classList.add('active');
                }
            });

            // Scroll to top
            const main = document.querySelector('.main-content');
            if (main) main.scrollTop = 0;
        });
    });
}

function updateModelList() {
    const engine = document.getElementById('engineSelect').value;
    const modelSelect = document.getElementById('translationModel');
    modelSelect.innerHTML = '';

    const list = MODELS[engine] || MODELS['google']; // Fallback to google if undefined
    if (list) {
        list.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.value;
            opt.textContent = m.label;
            modelSelect.appendChild(opt);
        });
    }
}

/**
 * Save all options to chrome.storage
 */
function saveOptions() {
    const settings = {
        deepseekKey: document.getElementById('deepseekKey').value,
        openaiKey: document.getElementById('openaiKey').value,
        deeplKey: document.getElementById('deeplKey').value,
        translationEngine: document.getElementById('engineSelect').value,
        translationModel: document.getElementById('translationModel').value, // Use specific key
        promptProfile: document.getElementById('promptProfile').value,
        isDarkMode: document.getElementById('darkModeToggle').checked,
        pdfNewlines: document.getElementById('pdfNewlines').checked,
        targetLang: document.getElementById('targetLang').value
    };

    chrome.storage.sync.set(settings, () => {
        // Apply immediate theme change
        document.documentElement.setAttribute('data-theme', settings.isDarkMode ? 'dark' : 'light');

        // Notify background
        chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED' });

        showToast();
    });
}

/**
 * Load options from chrome.storage
 */
function restoreOptions() {
    chrome.storage.sync.get({
        deepseekKey: '',
        openaiKey: '',
        translationModel: 'deepseek-chat', // Default translation model
        deeplKey: '',
        translationEngine: 'deepseek', // Recommend deepseek
        promptProfile: 'default',
        isDarkMode: false,
        pdfNewlines: true,
        targetLang: 'zh-CN'
    }, (items) => {
        document.getElementById('deepseekKey').value = items.deepseekKey;
        document.getElementById('openaiKey').value = items.openaiKey;
        document.getElementById('deeplKey').value = items.deeplKey;

        const engineSelect = document.getElementById('engineSelect');
        engineSelect.value = items.translationEngine;

        document.getElementById('promptProfile').value = items.promptProfile || 'default';

        document.getElementById('darkModeToggle').checked = items.isDarkMode;
        document.getElementById('pdfNewlines').checked = items.pdfNewlines;
        document.getElementById('targetLang').value = items.targetLang;

        // Populate models and set value
        updateModelList();
        const modelSelect = document.getElementById('translationModel');
        // Wait for updateModelList to finish (sync dom op)
        if ([...modelSelect.options].some(o => o.value === items.translationModel)) {
            modelSelect.value = items.translationModel;
        }

        // Initial Theme
        document.documentElement.setAttribute('data-theme', items.isDarkMode ? 'dark' : 'light');
    });
}

/**
 * Show a success toast
 */
function showToast() {
    const toast = document.getElementById('toast');
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}
