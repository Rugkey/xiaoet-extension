<div align="center">

# 🎓 AcadMaster

🌐 [中文](README.md) | English

**Your research translation assistant — translate papers, webpages, and images in one click**

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-2.2.0-orange.svg)](manifest.json)

Chrome / Edge extension · Frontend-only · Zero build setup

</div>

---

## ✨ Core Features

## 📣 What's New (v2.2.0)

- Added online PDF takeover toggle (can be disabled in settings; local PDF takeover remains available)
- Added domain-enhanced glossary packs (auto/academic/technical/medical/legal/business)
- Added citation-friendly translation (protects DOI, citation markers, figure/table refs, URLs)
- Improved PDF selection and zoom stability (reduced jumping and false highlights)
- Added runtime diagnostics panel (view recent errors and clear quickly)
- Improved large-document performance (adaptive batching + concurrency control)
- Added first-run onboarding tip and non-sensitive settings sync

| Feature | Description |
|------|------|
| **Selection Translation** | Select text on a page and get instant card-style translation |
| **Page / Document Translation** | Translate full pages or documents with optional bilingual mode |
| **Image OCR Translation** | Built-in Tesseract.js OCR for image text recognition and translation |
| **Academic PDF Viewer** | PDF.js-based viewer with annotations, search, thumbnails, and translation |
| **Multi-engine Fallback** | DeepL / OpenAI / DeepSeek / Google Translate with automatic fallback |
| **Translation Memory** | TM + LRU cache to avoid repeated translation requests |

## 🚀 Quick Start

```
1. Open Chrome → chrome://extensions/ (or Edge → edge://extensions/)
2. Enable "Developer mode"
3. Click "Load unpacked" and choose this repository root folder
4. Done! Select text, right-click images, or use shortcuts to translate
```

## ⌨️ Shortcuts

| Shortcut | Action |
|--------|------|
| `Alt + Shift + X` / `Ctrl + Shift + X` | Translate selected text |
| `Alt + Shift + D` / `Ctrl + Shift + D` | Translate full page / document |

> 💡 On Edge, `Ctrl + Shift` combos are usually more reliable than system-conflicting shortcuts.

## ⚙️ Settings

Open the extension panel, or go to the options page to configure:

- **Translation Engine**: DeepL / OpenAI / DeepSeek / Google Translate
- **API Keys**: per-engine keys with built-in connectivity test
- **Target Language**: defaults to zh-CN and can be switched
- **Prompt Profile**: style-specific prompt presets
- **Bilingual Mode**: show original + translated content together

## 📂 Project Structure

```
acadmaster/
├── manifest.json                  # Extension manifest (MV3)
├── options.html / options.js      # Settings page
├── src/
│   ├── background/
│   │   └── service-worker.js      # Engine routing, cache, message hub
│   ├── content/
│   │   ├── main.js                # Content script entry
│   │   ├── ui.js                  # ShadowDOM translation UI
│   │   ├── document-translator.js # Document translation logic
│   │   ├── context-processor.js   # Context extraction
│   │   ├── ocr-translator.js      # OCR translation flow
│   │   └── ...
│   ├── pdf/
│   │   ├── build/                 # Prebuilt PDF.js files
│   │   └── web/                   # Academic viewer page
│   ├── popup/                     # Extension popup UI
│   └── shared/                    # UMD shared modules
├── tests/                         # Node built-in tests
└── icons/                         # Extension icons
```

## 🛠️ Development

This project is **pure JavaScript (ES2020+)** with no TypeScript, no bundler, and no package manager requirement. Edit source files and reload the extension to test.

```bash
# Run tests (Node.js built-in test runner)
node --test tests/text-index-core.test.js
node --test tests/translation-memory-core.test.js
```

### Code Style

- 4-space indentation, single quotes, semicolons required
- Constants: `UPPER_SNAKE_CASE`, classes: `PascalCase`, private methods: `_camelCase`
- User-facing strings should be Chinese (`zh-CN`) in product UI
- Add top-level `/** */` JSDoc comments for files

## ❓ FAQ

<details>
<summary><b>Translation fails sometimes. What should I check?</b></summary>

Verify API keys on the options page and run the built-in key test. If the primary engine fails, the extension can fallback to Google Translate.
</details>

<details>
<summary><b>OCR accuracy is low. Any tips?</b></summary>

Use clearer, higher-resolution images. Cropping and keeping text horizontal significantly improves OCR quality.
</details>

<details>
<summary><b>PDF viewer doesn't open automatically.</b></summary>

Local `file://` PDFs are redirected by default. Online PDF takeover depends on your "auto-capture online PDF" setting.
</details>

## 🤝 Contributing

Contributions via Issues and Pull Requests are welcome:

1. Fork the repository and create a feature branch
2. Keep UI wording consistent with `zh-CN` conventions
3. Describe purpose and reproduction steps clearly in PRs

## 📄 License

Released under the [MIT License](LICENSE).

## 🙏 Credits

- [PDF.js](https://mozilla.github.io/pdf.js/) — PDF rendering engine
- [Tesseract.js](https://github.com/naptha/tesseract.js) — OCR in the browser
- Everyone who contributed feedback and improvements

---

<div align="center">

### ☕ Support

If AcadMaster helps your study or research, you can support the project:

<img src="assets/sponsor/alipay.jpg" alt="Alipay" width="160" />&nbsp;&nbsp;&nbsp;&nbsp;<img src="assets/sponsor/wechat.jpg" alt="WeChat" width="160" />

**Repository**: [github.com/Rugkey/acadmaster](https://github.com/Rugkey/acadmaster)

</div>
