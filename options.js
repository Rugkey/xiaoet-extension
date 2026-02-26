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
    'multi': [{ value: 'fusion', label: 'Multi-Engine Fusion' }]
};

let tmEntriesCache = [];
let tmEditingKey = '';
let tmConflictKey = '';
let tmConflictItem = null;
let tmLastFocusedElement = null;

const QUICK_PRESETS = {
    fast: {
        engine: 'google',
        model: 'default',
        promptProfile: 'default',
        tmFuzzyEnabled: true,
        tmFuzzyThreshold: 0.78,
        glossaryEnabled: false,
        label: '极速'
    },
    balanced: {
        engine: 'deepseek',
        model: 'deepseek-chat',
        promptProfile: 'academic',
        tmFuzzyEnabled: true,
        tmFuzzyThreshold: 0.82,
        glossaryEnabled: true,
        label: '平衡'
    },
    quality: {
        engine: 'openai',
        model: 'gpt-4o',
        promptProfile: 'academic',
        tmFuzzyEnabled: true,
        tmFuzzyThreshold: 0.86,
        glossaryEnabled: true,
        label: '高质量'
    }
};

const SYNC_SETTINGS_KEYS = [
    'translationEngine',
    'translationModel',
    'promptProfile',
    'isDarkMode',
    'pdfNewlines',
    'bilingualMode',
    'targetLang',
    'glossaryEnabled',
    'termGlossary',
    'tmFuzzyEnabled',
    'tmFuzzyThreshold',
    'tmConflictPolicy',
    'showAdvancedSettings',
    'quickScenario',
    'quickPriority',
    'quickMemory',
    'autoCaptureOnlinePdf',
    'citationFriendlyMode',
    'bigDocPerformanceMode',
    'documentBatchSize',
    'documentParallelRequests',
    'glossaryDomain',
    'onboardingCompleted',
    'enableSettingsSync'
];

function buildSyncPayload(settings) {
    const payload = {};
    SYNC_SETTINGS_KEYS.forEach((key) => {
        payload[key] = settings[key];
    });
    return payload;
}

function syncSettingsIfEnabled(settings) {
    if (!chrome?.storage?.sync) return;
    if (!settings.enableSettingsSync) {
        chrome.storage.sync.remove(SYNC_SETTINGS_KEYS, () => {
            if (chrome.runtime.lastError) {
                console.debug('Failed to clear sync settings:', chrome.runtime.lastError.message);
            }
        });
        return;
    }
    chrome.storage.sync.set(buildSyncPayload(settings), () => {
        if (chrome.runtime.lastError) {
            console.debug('Failed to sync settings:', chrome.runtime.lastError.message);
        }
    });
}

function mergeWithSyncIfNeeded(localItems, callback) {
    if (!chrome?.storage?.sync) {
        callback(localItems);
        return;
    }

    chrome.storage.sync.get(buildSyncPayload(localItems), (syncItems) => {
        if (chrome.runtime.lastError) {
            console.debug('Failed to read sync settings:', chrome.runtime.lastError.message);
            callback(localItems);
            return;
        }
        if (syncItems && syncItems.enableSettingsSync) {
            callback({ ...localItems, ...syncItems });
            return;
        }
        callback(localItems);
    });
}

function setTMEditStatus(message, level = '') {
    const box = document.getElementById('tmEditStatus');
    if (!box) return;
    box.textContent = message || '';
    box.classList.remove('error', 'success', 'warning');
    if (level) box.classList.add(level);
}

function setTMConflictAction(conflictKey = '', conflictItem = null) {
    tmConflictKey = conflictKey || '';
    tmConflictItem = conflictItem || null;
    const btn = document.getElementById('tmEditLocateConflictBtn');
    const keepBtn = document.getElementById('tmEditKeepCurrentBtn');
    const useConflictBtn = document.getElementById('tmEditUseConflictBtn');
    if (btn) btn.style.display = tmConflictKey ? 'inline-flex' : 'none';
    if (keepBtn) keepBtn.style.display = tmConflictKey ? 'inline-flex' : 'none';
    if (useConflictBtn) useConflictBtn.style.display = tmConflictKey ? 'inline-flex' : 'none';
}

function getTMConflictPolicy() {
    const el = document.getElementById('tmConflictPolicy');
    return el?.value || 'alwaysAsk';
}

function getTMHitCountByKey(key) {
    const item = tmEntriesCache.find(it => it.key === key);
    return Number(item?.hitCount || 0);
}

function validateTMEditModalFields() {
    const sourceEl = document.getElementById('tmEditSource');
    const langEl = document.getElementById('tmEditLang');
    const translatedEl = document.getElementById('tmEditTranslated');
    const saveBtn = document.getElementById('tmEditSaveBtn');

    const sourceText = (sourceEl?.value || '').trim();
    const targetLang = (langEl?.value || '').trim();
    const translated = (translatedEl?.value || '').trim();
    const langValid = /^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(targetLang);

    let err = '';
    if (!targetLang) {
        err = '目标语言不能为空。';
    } else if (!langValid) {
        err = '目标语言格式不正确，例如：zh-CN / en / ja。';
    } else if (!translated) {
        err = '译文不能为空。';
    } else if (translated.length > 12000) {
        err = '译文过长（最多 12000 字符）。';
    }

    const ok = !err;
    const conflictItem = (!err && sourceText)
        ? tmEntriesCache.find(item =>
            item && item.key !== tmEditingKey
            && String(item.sourceText || '').trim().toLowerCase() === sourceText.toLowerCase()
            && String(item.targetLang || '').trim().toLowerCase() === targetLang.toLowerCase()
        )
        : null;
    const sameTranslatedAsConflict = conflictItem
        ? String(conflictItem.translated || '').trim().toLowerCase() === translated.toLowerCase()
        : false;
    const conflictPolicy = getTMConflictPolicy();
    const currentHit = getTMHitCountByKey(tmEditingKey);
    const conflictHit = Number(conflictItem?.hitCount || 0);

    langEl?.classList.toggle('tm-field-error', !targetLang || !langValid);
    translatedEl?.classList.toggle('tm-field-error', !!targetLang && langValid && (!translated || translated.length > 12000));
    sourceEl?.classList.toggle('tm-field-warning', !!conflictItem);
    sourceEl?.classList.toggle('tm-field-error', false);
    if (saveBtn) saveBtn.disabled = !ok;

    if (!ok) {
        setTMConflictAction('');
        setTMEditStatus(err, 'error');
    } else if (conflictItem && !sameTranslatedAsConflict && conflictPolicy === 'preferLatest') {
        setTMConflictAction('');
        setTMEditStatus('检测到冲突：已按策略“优先最新编辑”处理，可直接保存。', 'success');
    } else if (conflictItem && !sameTranslatedAsConflict && conflictPolicy === 'preferHigherHit') {
        if (conflictHit > currentHit) {
            setTMConflictAction(conflictItem.key || '', conflictItem);
            setTMEditStatus(`检测到冲突：命中更高条目（${conflictHit} > ${currentHit}），建议采用冲突译文。`, 'warning');
        } else {
            setTMConflictAction('');
            setTMEditStatus(`检测到冲突：当前条目命中不低于冲突条目（${currentHit} ≥ ${conflictHit}），按策略保留当前译文。`, 'success');
        }
    } else if (conflictItem && !sameTranslatedAsConflict) {
        setTMConflictAction(conflictItem.key || '', conflictItem);
        const tipSource = String(conflictItem.sourceText || '').trim();
        const sourcePreview = tipSource.length > 30 ? `${tipSource.slice(0, 30)}…` : tipSource;
        setTMEditStatus(`冲突预警：与条目「${sourcePreview || '（无原文）'}」冲突，可定位后检查。`, 'warning');
    } else if (conflictItem && sameTranslatedAsConflict) {
        setTMConflictAction('');
        setTMEditStatus('与冲突条目译文一致，可保存（建议后续清理重复条目）。', 'success');
    } else {
        setTMConflictAction('');
        setTMEditStatus('字段校验通过，可保存。', 'success');
    }
    return ok;
}

document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    restoreOptions();
    bindQuickSetupActions();
    bindGlossaryActions();
    bindTMActions();
    bindDiagnosticActions();
    bindTMEditModalActions();

    document.getElementById('saveBtn').addEventListener('click', saveOptions);
    document.getElementById('engineSelect').addEventListener('change', updateModelList);
    document.getElementById('showAdvancedSettings')?.addEventListener('change', (e) => {
        applyAdvancedVisibility(!!e.target.checked);
    });

    document.getElementById('darkModeToggle').addEventListener('change', (e) => {
        document.documentElement.setAttribute('data-theme', e.target.checked ? 'dark' : 'light');
    });

    // API Key test buttons
    document.querySelectorAll('.btn-test').forEach(btn => {
        btn.addEventListener('click', () => testApiKey(btn));
    });

    // History section
    document.getElementById('clearHistoryBtn').addEventListener('click', clearHistory);
    document.getElementById('historySearch').addEventListener('input', (e) => {
        filterHistory(e.target.value);
    });

    document.getElementById('resetOnboardingBtn')?.addEventListener('click', () => {
        chrome.storage.local.set({ onboardingCompleted: false }, () => {
            if (chrome.runtime.lastError) {
                console.error('重置引导状态失败:', chrome.runtime.lastError);
                return;
            }
            setQuickSetupStatus('已重置新手引导，刷新任意页面后会再次出现提示。');
        });
    });
});

function setQuickSetupStatus(message) {
    const box = document.getElementById('quickSetupStatus');
    if (box) box.textContent = message || '';
}

function setEngineAndModel(engine, model) {
    const engineSelect = document.getElementById('engineSelect');
    const modelSelect = document.getElementById('translationModel');
    if (!engineSelect || !modelSelect) return;
    engineSelect.value = engine;
    updateModelList();
    if ([...modelSelect.options].some(o => o.value === model)) {
        modelSelect.value = model;
    }
}

function inferPresetFromQuickSetup() {
    const scenario = document.getElementById('quickScenario')?.value || 'general';
    const priority = document.getElementById('quickPriority')?.value || 'balanced';

    if (priority === 'speed') return 'fast';
    if (priority === 'quality') return 'quality';
    if (scenario === 'academic' || scenario === 'technical' || scenario === 'medical' || scenario === 'legal') return 'balanced';
    return 'balanced';
}

function markActivePreset(presetKey) {
    document.querySelectorAll('#quickPresetList .btn-preset').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.preset === presetKey);
    });
}

function applyQuickPreset(presetKey, source = 'manual') {
    const preset = QUICK_PRESETS[presetKey];
    if (!preset) return;

    setEngineAndModel(preset.engine, preset.model);
    document.getElementById('promptProfile').value = preset.promptProfile;
    document.getElementById('tmFuzzyEnabled').checked = !!preset.tmFuzzyEnabled;
    document.getElementById('tmFuzzyThreshold').value = Number(preset.tmFuzzyThreshold).toFixed(2);
    updateTMThresholdLabel();

    const quickMemory = document.getElementById('quickMemory')?.value || 'on';
    if (quickMemory === 'off') {
        document.getElementById('glossaryEnabled').checked = false;
        document.getElementById('tmFuzzyEnabled').checked = false;
    } else if (quickMemory === 'tm-only') {
        document.getElementById('glossaryEnabled').checked = false;
        document.getElementById('tmFuzzyEnabled').checked = true;
    } else {
        document.getElementById('glossaryEnabled').checked = !!preset.glossaryEnabled;
        document.getElementById('tmFuzzyEnabled').checked = !!preset.tmFuzzyEnabled;
    }

    markActivePreset(presetKey);
    const scenarioLabel = document.querySelector(`#quickScenario option[value="${document.getElementById('quickScenario')?.value || 'general'}"]`)?.textContent || '通用阅读';
    const priorityLabel = document.querySelector(`#quickPriority option[value="${document.getElementById('quickPriority')?.value || 'balanced'}"]`)?.textContent || '平衡';
    setQuickSetupStatus(`已应用「${preset.label}」预设（来源：${source === 'wizard' ? '向导' : '快捷按钮'}）。\n场景：${scenarioLabel} ｜ 优先级：${priorityLabel}`);
}

function bindQuickSetupActions() {
    document.querySelectorAll('#quickPresetList .btn-preset').forEach(btn => {
        btn.addEventListener('click', () => {
            applyQuickPreset(btn.dataset.preset || 'balanced', 'manual');
        });
    });

    document.getElementById('quickApplyBtn')?.addEventListener('click', () => {
        const preset = inferPresetFromQuickSetup();
        applyQuickPreset(preset, 'wizard');
    });
}

/**
 * Handle Sidebar Navigation
 */
function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    const sections = document.querySelectorAll('.content-section');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const targetAction = item.getAttribute('data-section');

            navItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');

            sections.forEach(sec => {
                sec.classList.remove('active');
                if (sec.id === `section-${targetAction}`) {
                    sec.classList.add('active');
                }
            });

            // Load history when tab is activated
            if (targetAction === 'history') {
                loadHistory();
            }

            const main = document.querySelector('.main-content');
            if (main) main.scrollTop = 0;
        });
    });
}

function applyAdvancedVisibility(showAdvanced) {
    document.querySelectorAll('.advanced-settings-card').forEach(card => {
        card.classList.toggle('collapsed', !showAdvanced);
    });
}

function updateModelList() {
    const engine = document.getElementById('engineSelect').value;
    const modelSelect = document.getElementById('translationModel');
    modelSelect.innerHTML = '';

    const list = MODELS[engine] || MODELS['google'];
    if (list) {
        list.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.value;
            opt.textContent = m.label;
            modelSelect.appendChild(opt);
        });
    }
}

function parseGlossaryTextDetailed(rawText) {
    const entries = [];
    const invalidLines = [];
    const duplicateConflicts = [];
    const duplicateSame = [];
    const seen = new Map();

    const lines = (rawText || '').split('\n');
    lines.forEach((rawLine, idx) => {
        const lineNumber = idx + 1;
        const line = (rawLine || '').trim();
        if (!line || line.startsWith('#')) return;

        const parts = line.split('=>');
        if (parts.length < 2) {
            invalidLines.push(`第 ${lineNumber} 行：缺少 => 分隔符`);
            return;
        }

        const source = (parts[0] || '').trim();
        const target = parts.slice(1).join('=>').trim();
        if (!source || !target) {
            invalidLines.push(`第 ${lineNumber} 行：源词或目标词为空`);
            return;
        }

        const key = source.toLowerCase();
        if (seen.has(key)) {
            const prev = seen.get(key);
            if (prev.target.toLowerCase() !== target.toLowerCase()) {
                duplicateConflicts.push(`第 ${lineNumber} 行：${source} 同时映射到 “${prev.target}” 与 “${target}”`);
            } else {
                duplicateSame.push(`第 ${lineNumber} 行：${source} 重复（相同映射）`);
            }
            return;
        }

        seen.set(key, { target, lineNumber, source });
        entries.push({ source, target });
    });

    return { entries, invalidLines, duplicateConflicts, duplicateSame };
}

function parseGlossaryText(rawText) {
    return parseGlossaryTextDetailed(rawText).entries;
}

function stringifyGlossary(glossary) {
    if (!Array.isArray(glossary) || !glossary.length) return '';
    return glossary
        .map(item => {
            const source = (item?.source || '').trim();
            const target = (item?.target || '').trim();
            if (!source || !target) return null;
            return `${source} => ${target}`;
        })
        .filter(Boolean)
        .join('\n');
}

/**
 * Save all options to chrome.storage.local.
 */
function saveOptions() {
    const glossaryInput = document.getElementById('glossaryInput').value;
    const parsedGlossary = parseGlossaryTextDetailed(glossaryInput);
    renderGlossaryStatus(parsedGlossary);

    const settings = {
        deepseekKey: document.getElementById('deepseekKey').value.trim(),
        openaiKey: document.getElementById('openaiKey').value.trim(),
        deeplKey: document.getElementById('deeplKey').value.trim(),
        translationEngine: document.getElementById('engineSelect').value,
        translationModel: document.getElementById('translationModel').value,
        promptProfile: document.getElementById('promptProfile').value,
        isDarkMode: document.getElementById('darkModeToggle').checked,
        pdfNewlines: document.getElementById('pdfNewlines').checked,
        bilingualMode: document.getElementById('bilingualMode').checked,
        targetLang: document.getElementById('targetLang').value,
        glossaryEnabled: document.getElementById('glossaryEnabled').checked,
        termGlossary: parsedGlossary.entries,
        tmFuzzyEnabled: document.getElementById('tmFuzzyEnabled').checked,
        tmFuzzyThreshold: Number(document.getElementById('tmFuzzyThreshold').value || 0.82),
        tmConflictPolicy: getTMConflictPolicy(),
        showAdvancedSettings: document.getElementById('showAdvancedSettings')?.checked !== false,
        quickScenario: document.getElementById('quickScenario')?.value || 'general',
        quickPriority: document.getElementById('quickPriority')?.value || 'balanced',
        quickMemory: document.getElementById('quickMemory')?.value || 'on',
        autoCaptureOnlinePdf: document.getElementById('autoCaptureOnlinePdf')?.checked !== false,
        citationFriendlyMode: document.getElementById('citationFriendlyMode')?.checked !== false,
        bigDocPerformanceMode: document.getElementById('bigDocPerformanceMode')?.checked !== false,
        documentBatchSize: document.getElementById('bigDocPerformanceMode')?.checked !== false ? 6 : 10,
        documentParallelRequests: document.getElementById('bigDocPerformanceMode')?.checked !== false ? 3 : 5,
        glossaryDomain: document.getElementById('glossaryDomain')?.value || 'auto',
        onboardingCompleted: true,
        enableSettingsSync: document.getElementById('enableSettingsSync')?.checked !== false
    };

    chrome.storage.local.set(settings, () => {
        if (chrome.runtime.lastError) {
            console.error('Failed to save settings:', chrome.runtime.lastError);
            return;
        }

        document.documentElement.setAttribute('data-theme', settings.isDarkMode ? 'dark' : 'light');
        syncSettingsIfEnabled(settings);

        // Notify service worker so it clears cached translations
        chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED' });

        showToast();
    });
}

/**
 * Load options from chrome.storage.local
 */
function restoreOptions() {
    chrome.storage.local.get({
        deepseekKey: '',
        openaiKey: '',
        translationModel: 'deepseek-chat',
        deeplKey: '',
        translationEngine: 'deepseek',
        promptProfile: 'default',
        isDarkMode: false,
        pdfNewlines: true,
        bilingualMode: false,
        targetLang: 'zh-CN',
        glossaryEnabled: true,
        termGlossary: [],
        tmFuzzyEnabled: true,
        tmFuzzyThreshold: 0.82,
        tmConflictPolicy: 'alwaysAsk',
        showAdvancedSettings: true,
        quickScenario: 'general',
        quickPriority: 'balanced',
        quickMemory: 'on',
        autoCaptureOnlinePdf: true,
        citationFriendlyMode: true,
        bigDocPerformanceMode: true,
        documentBatchSize: 6,
        documentParallelRequests: 3,
        glossaryDomain: 'auto',
        onboardingCompleted: false,
        enableSettingsSync: true
    }, (items) => {
        if (chrome.runtime.lastError) {
            console.error('Failed to load settings:', chrome.runtime.lastError);
            return;
        }

        const hydrate = (effectiveItems) => {
            document.getElementById('deepseekKey').value = effectiveItems.deepseekKey;
            document.getElementById('openaiKey').value = effectiveItems.openaiKey;
            document.getElementById('deeplKey').value = effectiveItems.deeplKey;

            const engineSelect = document.getElementById('engineSelect');
            engineSelect.value = effectiveItems.translationEngine;

            document.getElementById('promptProfile').value = effectiveItems.promptProfile || 'default';

            document.getElementById('darkModeToggle').checked = !!effectiveItems.isDarkMode;
            document.getElementById('pdfNewlines').checked = effectiveItems.pdfNewlines !== false;
            document.getElementById('bilingualMode').checked = !!effectiveItems.bilingualMode;
            document.getElementById('targetLang').value = effectiveItems.targetLang;
            document.getElementById('glossaryEnabled').checked = effectiveItems.glossaryEnabled !== false;
            document.getElementById('glossaryInput').value = stringifyGlossary(effectiveItems.termGlossary);
            document.getElementById('tmFuzzyEnabled').checked = effectiveItems.tmFuzzyEnabled !== false;
            document.getElementById('tmFuzzyThreshold').value = Number(effectiveItems.tmFuzzyThreshold || 0.82).toFixed(2);
            if (document.getElementById('showAdvancedSettings')) {
                document.getElementById('showAdvancedSettings').checked = effectiveItems.showAdvancedSettings !== false;
                applyAdvancedVisibility(effectiveItems.showAdvancedSettings !== false);
            }
            if (document.getElementById('tmConflictPolicy')) {
                document.getElementById('tmConflictPolicy').value = effectiveItems.tmConflictPolicy || 'alwaysAsk';
            }
            if (document.getElementById('quickScenario')) document.getElementById('quickScenario').value = effectiveItems.quickScenario || 'general';
            if (document.getElementById('quickPriority')) document.getElementById('quickPriority').value = effectiveItems.quickPriority || 'balanced';
            if (document.getElementById('quickMemory')) document.getElementById('quickMemory').value = effectiveItems.quickMemory || 'on';
            if (document.getElementById('autoCaptureOnlinePdf')) document.getElementById('autoCaptureOnlinePdf').checked = effectiveItems.autoCaptureOnlinePdf !== false;
            if (document.getElementById('citationFriendlyMode')) document.getElementById('citationFriendlyMode').checked = effectiveItems.citationFriendlyMode !== false;
            if (document.getElementById('bigDocPerformanceMode')) document.getElementById('bigDocPerformanceMode').checked = effectiveItems.bigDocPerformanceMode !== false;
            if (document.getElementById('glossaryDomain')) document.getElementById('glossaryDomain').value = effectiveItems.glossaryDomain || 'auto';
            if (document.getElementById('enableSettingsSync')) document.getElementById('enableSettingsSync').checked = effectiveItems.enableSettingsSync !== false;

            updateTMThresholdLabel();
            renderGlossaryStatus(parseGlossaryTextDetailed(document.getElementById('glossaryInput').value));

            updateModelList();
            const modelSelect = document.getElementById('translationModel');
            if ([...modelSelect.options].some(o => o.value === effectiveItems.translationModel)) {
                modelSelect.value = effectiveItems.translationModel;
            }

            const inferred = inferPresetFromQuickSetup();
            markActivePreset(inferred);
            setQuickSetupStatus(`当前推荐：${QUICK_PRESETS[inferred].label}。点击“按向导应用”可一键同步到下方参数。`);

            document.documentElement.setAttribute('data-theme', effectiveItems.isDarkMode ? 'dark' : 'light');

            loadTMStats();
            loadTMList();
        };

        mergeWithSyncIfNeeded(items, hydrate);
    });
}

function bindGlossaryActions() {
    const validateBtn = document.getElementById('glossaryValidateBtn');
    const importBtn = document.getElementById('glossaryImportBtn');
    const exportJsonBtn = document.getElementById('glossaryExportJsonBtn');
    const exportTxtBtn = document.getElementById('glossaryExportTxtBtn');
    const previewBtn = document.getElementById('glossaryPreviewBtn');
    const fileInput = document.getElementById('glossaryFileInput');
    const glossaryInput = document.getElementById('glossaryInput');

    validateBtn?.addEventListener('click', () => {
        const parsed = parseGlossaryTextDetailed(glossaryInput.value);
        renderGlossaryStatus(parsed);
    });

    importBtn?.addEventListener('click', () => fileInput?.click());

    fileInput?.addEventListener('change', () => importGlossaryFromFile(fileInput));

    exportJsonBtn?.addEventListener('click', () => {
        const parsed = parseGlossaryTextDetailed(glossaryInput.value);
        renderGlossaryStatus(parsed);
        downloadFile('xiaoet-glossary.json', JSON.stringify(parsed.entries, null, 2), 'application/json');
    });

    exportTxtBtn?.addEventListener('click', () => {
        const parsed = parseGlossaryTextDetailed(glossaryInput.value);
        renderGlossaryStatus(parsed);
        downloadFile('xiaoet-glossary.txt', stringifyGlossary(parsed.entries), 'text/plain;charset=utf-8');
    });

    previewBtn?.addEventListener('click', runGlossaryPreview);
    glossaryInput?.addEventListener('blur', () => {
        renderGlossaryStatus(parseGlossaryTextDetailed(glossaryInput.value));
    });
}

function bindDiagnosticActions() {
    document.getElementById('diagnosticsRefreshBtn')?.addEventListener('click', loadDiagnostics);
    document.getElementById('diagnosticsClearBtn')?.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'CLEAR_RUNTIME_DIAGNOSTICS' }, (res) => {
            if (!res?.success) {
                console.error('清空诊断失败:', res?.error || chrome.runtime.lastError?.message || 'unknown');
                return;
            }
            loadDiagnostics();
        });
    });
    loadDiagnostics();
}

function loadDiagnostics() {
    const summary = document.getElementById('diagnosticsSummary');
    const list = document.getElementById('diagnosticsList');
    if (summary) summary.textContent = '正在加载诊断信息...';
    if (list) list.value = '';

    chrome.runtime.sendMessage({ type: 'GET_RUNTIME_DIAGNOSTICS' }, (res) => {
        if (!res?.success) {
            const msg = res?.error || chrome.runtime.lastError?.message || '未知错误';
            if (summary) {
                summary.classList.remove('success');
                summary.classList.add('error');
                summary.textContent = `加载失败：${msg}`;
            }
            return;
        }

        const items = Array.isArray(res.entries) ? res.entries : [];
        const stats = res.stats || {};
        if (summary) {
            summary.classList.remove('error');
            summary.classList.add('success');
            summary.textContent = `最近错误 ${items.length} 条 ｜ 近 1 小时失败 ${stats.failedInHour || 0} 次 ｜ 最后错误：${stats.lastErrorAt ? new Date(stats.lastErrorAt).toLocaleString() : '无'}`;
        }

        if (list) {
            list.value = items.map((item) => {
                const time = item.ts ? new Date(item.ts).toLocaleString() : '未知时间';
                const source = item.source || 'unknown';
                const code = item.code || 'unknown';
                const message = item.message || '';
                return `[${time}] [${source}] [${code}] ${message}`;
            }).join('\n');
        }
    });
}

function renderGlossaryStatus(parsed) {
    const box = document.getElementById('glossaryStatus');
    if (!box) return;

    const lines = [];
    lines.push(`有效映射：${parsed.entries.length} 条`);

    if (parsed.duplicateConflicts.length) {
        lines.push(`冲突：${parsed.duplicateConflicts.length} 条`);
        lines.push(...parsed.duplicateConflicts.slice(0, 5));
    }
    if (parsed.invalidLines.length) {
        lines.push(`格式错误：${parsed.invalidLines.length} 条`);
        lines.push(...parsed.invalidLines.slice(0, 5));
    }
    if (parsed.duplicateSame.length) {
        lines.push(`重复（已自动忽略）：${parsed.duplicateSame.length} 条`);
    }

    const hasError = parsed.duplicateConflicts.length > 0 || parsed.invalidLines.length > 0;
    if (!hasError && parsed.entries.length > 0) {
        lines.push('校验通过，可安全保存。');
    } else if (!hasError && parsed.entries.length === 0) {
        lines.push('当前术语库为空。');
    }

    box.classList.remove('error', 'success');
    box.classList.add(hasError ? 'error' : 'success');
    box.textContent = lines.join('\n');
}

function importGlossaryFromFile(fileInput) {
    const file = fileInput?.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
        try {
            const content = String(reader.result || '');
            const isJson = /\.json$/i.test(file.name.trim());
            let parsedEntries = [];

            if (isJson) {
                const data = JSON.parse(content);
                const glossaryArr = Array.isArray(data) ? data : (Array.isArray(data?.glossary) ? data.glossary : []);
                parsedEntries = glossaryArr
                    .map(item => ({ source: String(item?.source || '').trim(), target: String(item?.target || '').trim() }))
                    .filter(item => item.source && item.target);
            } else {
                parsedEntries = parseGlossaryText(content);
            }

            document.getElementById('glossaryInput').value = stringifyGlossary(parsedEntries);
            renderGlossaryStatus(parseGlossaryTextDetailed(document.getElementById('glossaryInput').value));
            showToast();
        } catch (e) {
            const box = document.getElementById('glossaryStatus');
            if (box) {
                box.classList.remove('success');
                box.classList.add('error');
                box.textContent = `导入失败：${e.message}`;
            }
        } finally {
            fileInput.value = '';
        }
    };
    reader.readAsText(file, 'utf-8');
}

function runGlossaryPreview() {
    const previewInput = document.getElementById('glossaryPreviewText').value;
    const parsed = parseGlossaryTextDetailed(document.getElementById('glossaryInput').value);
    renderGlossaryStatus(parsed);

    const glossary = parsed.entries
        .slice()
        .sort((a, b) => b.source.length - a.source.length);
    const enabled = document.getElementById('glossaryEnabled').checked;

    const output = applyGlossaryPreview(previewInput, glossary, enabled);
    document.getElementById('glossaryPreviewResult').value = output;
}

function applyGlossaryPreview(text, glossary, enabled) {
    if (!enabled) return text;
    if (!text || !Array.isArray(glossary) || glossary.length === 0) return text;

    let output = text;
    glossary.forEach(item => {
        const source = item.source;
        const target = item.target;
        const hasAsciiWord = /^[\w\- ]+$/.test(source);
        if (hasAsciiWord) {
            const pattern = new RegExp(`\\b${escapeRegExp(source)}\\b`, 'gi');
            output = output.replace(pattern, target);
        } else {
            output = output.split(source).join(target);
        }
    });

    return output;
}

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function downloadFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function bindTMActions() {
    const threshold = document.getElementById('tmFuzzyThreshold');
    const refreshBtn = document.getElementById('tmRefreshBtn');
    const clearBtn = document.getElementById('tmClearBtn');
    const exportBtn = document.getElementById('tmExportBtn');
    const importBtn = document.getElementById('tmImportBtn');
    const fileInput = document.getElementById('tmFileInput');
    const searchInput = document.getElementById('tmSearchInput');
    const langFilter = document.getElementById('tmLangFilter');
    const conflictPolicy = document.getElementById('tmConflictPolicy');

    threshold?.addEventListener('input', updateTMThresholdLabel);
    refreshBtn?.addEventListener('click', () => {
        loadTMStats();
        loadTMList();
    });
    clearBtn?.addEventListener('click', clearTM);
    exportBtn?.addEventListener('click', exportTM);
    importBtn?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', () => importTM(fileInput));
    searchInput?.addEventListener('input', renderTMListFromCache);
    langFilter?.addEventListener('change', renderTMListFromCache);
    conflictPolicy?.addEventListener('change', () => {
        setTMEditStatus('');
    });
}

function bindTMEditModalActions() {
    const close = () => closeTMEditModal();
    document.getElementById('tmEditCloseBtn')?.addEventListener('click', close);
    document.getElementById('tmEditCancelBtn')?.addEventListener('click', close);
    document.getElementById('tmEditSaveBtn')?.addEventListener('click', saveTMEditModal);
    document.getElementById('tmEditLocateConflictBtn')?.addEventListener('click', () => {
        if (!tmConflictKey) return;
        const item = tmEntriesCache.find(it => it.key === tmConflictKey);
        if (!item) return;
        openTMEditModal(item);
    });
    document.getElementById('tmEditKeepCurrentBtn')?.addEventListener('click', () => {
        if (!tmConflictKey) return;
        setTMEditStatus('已选择保留当前译文，可继续保存。', 'success');
    });
    document.getElementById('tmEditUseConflictBtn')?.addEventListener('click', () => {
        if (!tmConflictItem) return;
        const translatedEl = document.getElementById('tmEditTranslated');
        if (!translatedEl) return;
        translatedEl.value = String(tmConflictItem.translated || '').trim();
        validateTMEditModalFields();
    });
    document.getElementById('tmEditSource')?.addEventListener('input', validateTMEditModalFields);
    document.getElementById('tmEditLang')?.addEventListener('input', validateTMEditModalFields);
    document.getElementById('tmEditTranslated')?.addEventListener('input', validateTMEditModalFields);
    document.getElementById('tmEditModal')?.addEventListener('click', (e) => {
        if (e.target && e.target.id === 'tmEditModal') close();
    });
    document.addEventListener('keydown', (e) => {
        const modal = document.getElementById('tmEditModal');
        if (!modal || modal.classList.contains('hidden')) return;

        if (e.key === 'Tab') {
            const focusables = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
            const list = Array.from(focusables).filter(el => !el.disabled && el.offsetParent !== null);
            if (list.length > 0) {
                const first = list[0];
                const last = list[list.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        }

        if (e.key === 'Escape') {
            e.preventDefault();
            close();
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            saveTMEditModal();
        }
    });
}

function openTMEditModal(item) {
    tmLastFocusedElement = document.activeElement;
    tmEditingKey = item?.key || '';
    document.getElementById('tmEditSource').value = item?.sourceText || '';
    document.getElementById('tmEditLang').value = item?.targetLang || '';
    document.getElementById('tmEditTranslated').value = item?.translated || '';
    const modal = document.getElementById('tmEditModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    validateTMEditModalFields();
    modal.querySelector('.tm-modal-card')?.focus();
    document.getElementById('tmEditSource')?.focus();
}

function closeTMEditModal() {
    tmEditingKey = '';
    const modal = document.getElementById('tmEditModal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    document.getElementById('tmEditSource')?.classList.remove('tm-field-warning', 'tm-field-error');
    document.getElementById('tmEditLang')?.classList.remove('tm-field-warning', 'tm-field-error');
    document.getElementById('tmEditTranslated')?.classList.remove('tm-field-warning', 'tm-field-error');
    setTMConflictAction('');
    setTMEditStatus('');
    if (tmLastFocusedElement && typeof tmLastFocusedElement.focus === 'function') {
        tmLastFocusedElement.focus();
    }
    tmLastFocusedElement = null;
}

function saveTMEditModal() {
    if (!tmEditingKey) return;
    if (!validateTMEditModalFields()) return;
    const sourceText = (document.getElementById('tmEditSource').value || '').trim();
    const targetLang = (document.getElementById('tmEditLang').value || '').trim();
    const translated = (document.getElementById('tmEditTranslated').value || '').trim();
    const saveBtn = document.getElementById('tmEditSaveBtn');
    if (saveBtn) saveBtn.disabled = true;
    setTMEditStatus('保存中...', '');

    chrome.runtime.sendMessage({
        type: 'UPDATE_TM_ENTRY',
        key: tmEditingKey,
        patch: { sourceText, targetLang, translated }
    }, (response) => {
        if (response && response.success) {
            closeTMEditModal();
            loadTMStats();
            loadTMList();
            showToast();
            return;
        }
        if (saveBtn) saveBtn.disabled = false;
        setTMEditStatus('保存失败，请稍后重试。', 'error');
    });
}

function updateTMThresholdLabel() {
    const slider = document.getElementById('tmFuzzyThreshold');
    const label = document.getElementById('tmFuzzyThresholdValue');
    if (!slider || !label) return;
    label.textContent = Number(slider.value || 0.82).toFixed(2);
}

function loadTMStats() {
    const box = document.getElementById('tmStats');
    if (box) box.textContent = '正在加载翻译记忆统计...';

    chrome.runtime.sendMessage({ type: 'GET_TM_STATS' }, (response) => {
        if (!box) return;
        if (!response || !response.success) {
            box.textContent = '统计加载失败';
            return;
        }

        const s = response.stats || {};
        const lines = [
            `总条目：${s.total || 0}`,
            `目标语言数：${s.languages || 0}`,
            `近7天活跃条目：${s.recent7d || 0}`,
            `命中次数总计：${s.totalHits || 0}`,
            `精确命中：${s.exactHits || 0}`,
            `模糊命中：${s.fuzzyHits || 0}`
        ];
        box.textContent = lines.join('\n');
        loadTaskStats(box);
    });
}

function loadTaskStats(targetBox) {
    const box = targetBox || document.getElementById('tmStats');
    if (!box) return;

    chrome.runtime.sendMessage({ type: 'GET_TASK_STATS' }, (response) => {
        if (!response || !response.success) return;
        const s = response.stats || {};
        const modeEntries = Object.entries(s.byMode || {});
        const modeSummary = modeEntries.length
            ? modeEntries.map(([mode, item]) => `${mode}:${Number(item.success || 0)}/${Number(item.total || 0)}`).join(' | ')
            : '暂无';
        const reasonEntries = Object.entries(s.failedByReason || {});
        const reasonSummary = reasonEntries.length
            ? reasonEntries.map(([reason, count]) => `${reason}:${Number(count || 0)}`).join(' | ')
            : '暂无';
        const recent1h = s.recent1h || {};
        const recent50 = s.recent50 || {};

        const lines = [
            '',
            '--- 任务统计 ---',
            `任务总数：${Number(s.total || 0)}`,
            `成功/失败：${Number(s.success || 0)}/${Number(s.failed || 0)}`,
            `成功率：${Number(s.successRate || 0)}%`,
            `平均耗时：${Number(s.avgDurationMs || 0)} ms`,
            `按模式：${modeSummary}`,
            `失败原因：${reasonSummary}`,
            `最近1小时：${Number(recent1h.success || 0)}/${Number(recent1h.total || 0)}（${Number(recent1h.successRate || 0)}%）` ,
            `最近50次：${Number(recent50.success || 0)}/${Number(recent50.total || 0)}（${Number(recent50.successRate || 0)}%）`
        ];

        box.textContent = `${box.textContent || ''}${lines.join('\n')}`;
    });
}

function clearTM() {
    if (!confirm('确定清空翻译记忆（TM）吗？该操作不可恢复。')) return;

    chrome.runtime.sendMessage({ type: 'CLEAR_TRANSLATION_MEMORY' }, (response) => {
        if (response && response.success) {
            loadTMStats();
            loadTMList();
            showToast();
        }
    });
}

function exportTM() {
    chrome.runtime.sendMessage({ type: 'EXPORT_TRANSLATION_MEMORY' }, (response) => {
        if (!response || !response.success) return;
        downloadFile(
            'xiaoet-translation-memory.json',
            JSON.stringify(response.data || {}, null, 2),
            'application/json'
        );
    });
}

function importTM(fileInput) {
    const file = fileInput?.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
        try {
            const content = String(reader.result || '');
            const data = JSON.parse(content);
            chrome.runtime.sendMessage({ type: 'IMPORT_TRANSLATION_MEMORY', data }, (response) => {
                if (response && response.success) {
                    loadTMStats();
                    loadTMList();
                    showToast();
                }
            });
        } catch (e) {
            console.error('TM 导入失败:', e);
        } finally {
            fileInput.value = '';
        }
    };
    reader.readAsText(file, 'utf-8');
}

function loadTMList() {
    const list = document.getElementById('tmList');
    if (list) list.innerHTML = '<div class="tm-empty">正在加载记忆条目...</div>';

    chrome.runtime.sendMessage({ type: 'GET_TM_ENTRIES' }, (response) => {
        if (!response || !response.success) {
            if (list) list.innerHTML = '<div class="tm-empty">加载失败</div>';
            return;
        }

        tmEntriesCache = Array.isArray(response.entries) ? response.entries : [];
        hydrateTMLangFilter(tmEntriesCache);
        renderTMListFromCache();
    });
}

function hydrateTMLangFilter(entries) {
    const select = document.getElementById('tmLangFilter');
    if (!select) return;

    const prev = select.value;
    const langs = [...new Set((entries || []).map(e => e.targetLang).filter(Boolean))].sort();
    select.innerHTML = '<option value="">全部语言</option>';
    langs.forEach(lang => {
        const opt = document.createElement('option');
        opt.value = lang;
        opt.textContent = lang;
        select.appendChild(opt);
    });

    if ([...select.options].some(o => o.value === prev)) {
        select.value = prev;
    }
}

function renderTMListFromCache() {
    const list = document.getElementById('tmList');
    if (!list) return;

    const query = (document.getElementById('tmSearchInput')?.value || '').trim().toLowerCase();
    const lang = document.getElementById('tmLangFilter')?.value || '';

    const filtered = tmEntriesCache.filter(item => {
        if (lang && item.targetLang !== lang) return false;
        if (!query) return true;
        return (item.sourceText || '').toLowerCase().includes(query)
            || (item.translated || '').toLowerCase().includes(query);
    });

    if (!filtered.length) {
        list.innerHTML = '<div class="tm-empty">无匹配条目</div>';
        return;
    }

    list.innerHTML = filtered.slice(0, 120).map(item => {
        const updated = item.updatedAt ? new Date(item.updatedAt) : null;
        const timeStr = updated
            ? `${updated.getFullYear()}-${String(updated.getMonth() + 1).padStart(2, '0')}-${String(updated.getDate()).padStart(2, '0')} ${String(updated.getHours()).padStart(2, '0')}:${String(updated.getMinutes()).padStart(2, '0')}`
            : '未知';
        return `<div class="tm-item">
            <div class="tm-item-source">${escapeHtml(item.sourceText || '(旧版条目无原文)')}</div>
            <div class="tm-item-target">${escapeHtml(item.translated || '')}</div>
            <div class="tm-item-meta">
                <span>语言: ${escapeHtml(item.targetLang || '-')}</span>
                <span>命中: ${Number(item.hitCount || 0)}</span>
                <span>更新时间: ${timeStr}</span>
                <button class="btn-secondary tm-edit-btn" data-tm-key="${escapeHtml(item.key || '')}" type="button">编辑</button>
                <button class="btn-secondary tm-delete-btn" data-tm-key="${escapeHtml(item.key || '')}" type="button">删除</button>
            </div>
        </div>`;
    }).join('');

    list.querySelectorAll('.tm-edit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const key = btn.getAttribute('data-tm-key') || '';
            if (!key) return;
            const item = tmEntriesCache.find(it => it.key === key);
            if (!item) return;
            openTMEditModal(item);
        });
    });

    list.querySelectorAll('.tm-delete-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const key = btn.getAttribute('data-tm-key') || '';
            if (!key) return;
            chrome.runtime.sendMessage({ type: 'DELETE_TM_ENTRY', key }, (response) => {
                if (response && response.success && response.deleted) {
                    loadTMStats();
                    loadTMList();
                }
            });
        });
    });
}

/**
 * Test an API key by sending a minimal translation request.
 */
function testApiKey(btn) {
    const engine = btn.getAttribute('data-engine');
    const originalText = btn.textContent;

    // Save keys first so the service worker has them
    const keyMap = {
        deepseek: document.getElementById('deepseekKey').value.trim(),
        openai: document.getElementById('openaiKey').value.trim(),
        deepl: document.getElementById('deeplKey').value.trim()
    };
    const key = keyMap[engine];

    if (!key) {
        btn.textContent = '未填写';
        btn.className = 'btn-test fail';
        setTimeout(() => { btn.textContent = originalText; btn.className = 'btn-test'; }, 2000);
        return;
    }

    // Temporarily save the key so service worker can use it
    const saveObj = {};
    saveObj[engine + 'Key'] = key;
    chrome.storage.local.set(saveObj, () => {
        btn.textContent = '测试中...';
        btn.disabled = true;

        chrome.runtime.sendMessage({
            type: 'TEST_API_KEY',
            engine: engine
        }, (response) => {
            btn.disabled = false;
            if (response && response.success) {
                btn.textContent = '✓ 可用';
                btn.className = 'btn-test success';
            } else {
                btn.textContent = '✗ 失败';
                btn.className = 'btn-test fail';
            }
            setTimeout(() => {
                btn.textContent = originalText;
                btn.className = 'btn-test';
            }, 3000);
        });
    });
}

/**
 * Load and display translation history.
 */
function loadHistory() {
    chrome.runtime.sendMessage({ type: 'GET_TRANSLATION_HISTORY' }, (response) => {
        if (response && response.success && response.history) {
            renderHistory(response.history);
        }
    });
}

let allHistoryItems = [];

function renderHistory(history) {
    allHistoryItems = history;
    const list = document.getElementById('historyList');

    if (!history || history.length === 0) {
        list.innerHTML = '<div class="history-empty">暂无翻译历史</div>';
        return;
    }

    list.innerHTML = history.map((item, i) => {
        const date = new Date(item.timestamp);
        const timeStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
        const engineLabel = (item.engine || 'google').toUpperCase();
        const langLabel = item.detectedLang ? `${item.detectedLang} → ${item.targetLang}` : (item.targetLang || '');

        return `<div class="history-item" data-index="${i}">
            <div class="original">${escapeHtml(item.original || '')}</div>
            <div class="translated">${escapeHtml(item.translated || '')}</div>
            <div class="meta">
                <span>${timeStr}</span>
                <span>${engineLabel}</span>
                <span>${langLabel}</span>
            </div>
        </div>`;
    }).join('');
}

function filterHistory(query) {
    if (!query) {
        renderHistory(allHistoryItems);
        return;
    }
    const lower = query.toLowerCase();
    const filtered = allHistoryItems.filter(item =>
        (item.original && item.original.toLowerCase().includes(lower)) ||
        (item.translated && item.translated.toLowerCase().includes(lower))
    );
    renderHistory(filtered);
}

function clearHistory() {
    if (!confirm('确定要清空所有翻译历史吗？该操作不会清空翻译记忆（TM）。')) return;

    chrome.runtime.sendMessage({ type: 'CLEAR_TRANSLATION_HISTORY' }, (response) => {
        if (response && response.success) {
            allHistoryItems = [];
            const list = document.getElementById('historyList');
            list.innerHTML = '<div class="history-empty">暂无翻译历史</div>';
        }
    });
}

function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Show a success toast (with debounce to prevent stacking).
 */
let toastTimer = null;
function showToast() {
    const toast = document.getElementById('toast');
    if (toastTimer) clearTimeout(toastTimer);
    toast.classList.add('show');
    toastTimer = setTimeout(() => {
        toast.classList.remove('show');
        toastTimer = null;
    }, 3000);
}
