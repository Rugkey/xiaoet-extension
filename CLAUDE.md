# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

XiaoEt (学术大拿) is a Chrome Extension (Manifest V3) that provides intelligent translation services for academic research and paper reading. The extension integrates multiple AI translation engines, a custom PDF viewer, and context-aware translation features.

## Development Commands

### Loading the Extension
```bash
# Open Chrome and navigate to chrome://extensions/
# Enable "Developer mode"
# Click "Load unpacked" and select the project root directory
```

### Testing
```bash
# Run individual test files in browser console or Node.js
node test_improvements.js
node test_adapter_fix.js
node test_pdf_fix.js
node test_ui_optimization.js
node verify_features.js
```

### Debugging
- Service Worker: chrome://extensions/ → "Inspect views: service worker"
- Content Scripts: Right-click page → Inspect → Console tab
- Popup: Right-click extension icon → Inspect popup

## Architecture

### Core Components

**Service Worker** (`src/background/service-worker.js`)
- Handles all translation API calls to external services (Google, DeepSeek, DeepL, OpenAI)
- Manages translation cache (Map-based, max 200 entries)
- Redirects local PDF files to custom viewer
- Handles context menu and keyboard shortcuts
- Implements multi-engine fusion with weighted results
- Domain-specific translation prompts (academic, medical, legal, technical)

**Content Scripts** (loaded in strict order)
1. `utils.js` - Utility functions and helpers
2. `styles.js` - CSS-in-JS styling definitions
3. `drag.js` - Drag-and-drop functionality
4. `ui.js` - TranslatorUI class for floating panel
5. `adapter.js` - ContentAdapter for page-specific adaptations
6. `context-processor.js` - ContextProcessor for context-aware translation
7. `ocr-translator.js` - OCRTranslator for image text extraction
8. `document-translator.js` - DocumentTranslator for full-page translation
9. `main.js` - Entry point, initializes all modules

**PDF Viewer** (`src/pdf/web/`)
- Custom academic PDF viewer built on PDF.js
- `academic-viewer.html` - Main viewer interface
- `academic-viewer.js` - Viewer logic and controls
- `academic-viewer.css` - Viewer styling
- Supports metadata extraction, annotations, and integrated translation

**Popup UI** (`src/popup/`)
- Extension icon popup interface
- Quick access to settings and features

**Options Page** (`options.html`, `options.js`)
- API key configuration for translation engines
- Engine selection and preferences
- Domain-specific translation settings
- Target language configuration

### Module Communication

Content scripts expose classes on `window` object:
- `window.TranslatorUI` - UI management
- `window.ContentAdapter` - Page adaptation
- `window.ContextProcessor` - Context handling
- `window.OCRTranslator` - OCR functionality
- `window.DocumentTranslator` - Document translation
- `window.Utils` - Shared utilities

Communication flow:
1. User selects text → Content script detects selection
2. Content script sends message to service worker via `chrome.runtime.sendMessage()`
3. Service worker calls translation API (with caching)
4. Service worker sends response back to content script
5. Content script displays result in TranslatorUI panel

### Translation Engines

Supported engines with configuration:
- **Google Translate**: Free, no API key required
- **DeepSeek AI**: Requires API key, optimized for academic content
- **DeepL Pro**: Requires API key, high-quality translations
- **OpenAI GPT-4o**: Requires API key, context-aware translations
- **Multi-Engine Fusion**: Combines results from multiple engines with weighted scoring

Engine weights (configurable in service-worker.js):
```javascript
{
  'google': 0.2,
  'deepl': 0.4,
  'deepseek': 0.3,
  'openai': 0.1
}
```

### Key Features

**Keyboard Shortcuts**
- `Alt+Shift+X` - Translate selected text
- `Alt+Shift+D` - Translate entire document

**Context Menu**
- Right-click selected text → "Translate Selection"

**PDF Handling**
- Automatic redirection of local PDF files to custom viewer
- File URLs matching `file:///*.pdf` are intercepted and redirected

**Caching Strategy**
- Translation results cached in Map (max 200 entries)
- Cache cleanup every 5 minutes
- Cache key: `${text}_${engine}_${targetLang}_${profile}`

## Code Conventions

### Module Pattern
Each content script follows this pattern:
```javascript
(function() {
    'use strict';

    class ModuleName {
        constructor() {
            // Initialize
        }

        // Methods
    }

    // Expose on window
    window.ModuleName = ModuleName;
})();
```

### Error Handling
- Always check for module availability before instantiation
- Use try-catch blocks for async operations
- Log errors with descriptive messages
- Graceful degradation when optional modules fail

### Security
- Input validation for all user-provided text
- API keys stored in chrome.storage.sync
- Message validation between content scripts and service worker
- XSS prevention through proper text sanitization

### Performance
- Limit translation text to 5000 characters
- Cache translation results to reduce API calls
- Use streaming for long translations when supported
- Clean up event listeners and resources on unload

## Important Notes

- **No Build System**: This is a pure browser extension with no npm/webpack. All JavaScript is vanilla ES6+.
- **Load Order Matters**: Content scripts must load in the exact order specified in manifest.json
- **Manifest V3**: Uses service workers instead of background pages
- **File Protocol**: Extension has `file:///*` permission for local PDF access
- **Chinese UI**: Primary language is Chinese (Simplified), keep UI text in Chinese unless translating content

## Common Tasks

### Adding a New Translation Engine
1. Add API configuration in `options.html` and `options.js`
2. Implement translation function in `service-worker.js`
3. Add engine to ENGINE_WEIGHTS if using fusion
4. Update UI to include new engine option

### Modifying Content Script Behavior
1. Identify the correct module (utils, ui, adapter, etc.)
2. Make changes while preserving the module pattern
3. Ensure the class is still exposed on `window` object
4. Test that dependent modules still work

### Updating PDF Viewer
1. Modify files in `src/pdf/web/`
2. Ensure changes are compatible with PDF.js library
3. Update web_accessible_resources in manifest.json if adding new files
4. Test with both local and remote PDF files

### Debugging Translation Issues
1. Check service worker console for API errors
2. Verify API keys in chrome.storage.sync
3. Check translation cache for stale entries
4. Monitor network requests to translation APIs
5. Verify input text length and character encoding
