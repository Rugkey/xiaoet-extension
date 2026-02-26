<div align="center">

# 🎓 AcadMaster（学术大拿）

**你的科研翻译助手 — 一键翻译论文、网页与图片**

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-2.2.0-orange.svg)](manifest.json)

Chrome / Edge 浏览器扩展 · 纯前端 · 零构建 · 开箱即用

</div>

---

## ✨ 核心特性

## 📣 最新更新（v2.2.0）

- 新增在线 PDF 接管开关（可在设置中关闭，保留本地 PDF 接管）
- 新增术语库领域增强（自动/学术/技术/医学/法律/商务）
- 新增引文友好翻译（保护 DOI、引用编号、图表编号、URL）
- 优化 PDF 选区与缩放稳定性（减少跳跃与误高亮）
- 新增运行诊断面板（查看最近错误、支持一键清空）
- 优化大文档翻译性能（自适应批次 + 并发控制）
- 新增新手引导提示与设置同步（非敏感配置）

| 功能 | 说明 |
|------|------|
| **选中翻译** | 选中文本后一键翻译，结果以卡片形式展示 |
| **整页 / 文档翻译** | 将网页或文档原文替换为译文，支持双语对照模式 |
| **图片 OCR 翻译** | 内置 Tesseract.js，右键图片即可识别并翻译 |
| **PDF 学术查看器** | 基于 PDF.js 的阅读器，支持批注、搜索、缩略图与翻译 |
| **多引擎自动回退** | DeepL / OpenAI / DeepSeek / Google Translate，主引擎失败自动切换 |
| **Translation Memory** | 翻译记忆库 + LRU 缓存，避免重复请求 |

## 🚀 快速上手

```
1. 打开 Chrome → chrome://extensions/（或 Edge → edge://extensions/）
2. 启用「开发者模式」
3. 点击「加载已解压的扩展程序」，选择本仓库根目录
4. 完成！在任意页面选中文本、右键图片或使用快捷键即可翻译
```

## ⌨️ 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Alt + Shift + X` / `Ctrl + Shift + X` | 翻译选中文本 |
| `Alt + Shift + D` / `Ctrl + Shift + D` | 翻译整页 / 整文档 |

> 💡 Edge 用户建议使用 `Ctrl + Shift` 组合，避免与系统快捷键冲突。

## ⚙️ 设置

点击扩展图标打开主面板，或前往扩展选项页进行配置：

- **翻译引擎**：选择 DeepL / OpenAI / DeepSeek / Google Translate
- **API Key**：填入对应引擎密钥，支持一键测试连通性
- **目标语言**：默认中文（zh-CN），可切换
- **提示词配置**：自定义 AI 翻译的 prompt 风格
- **双语模式**：开启后翻译结果与原文并排展示

## 📂 项目结构

```
acadmaster/
├── manifest.json                  # 扩展清单（Manifest V3）
├── options.html / options.js      # 设置页面
├── src/
│   ├── background/
│   │   └── service-worker.js      # 翻译引擎调度、缓存、消息路由
│   ├── content/
│   │   ├── main.js                # Content Script 入口
│   │   ├── ui.js                  # ShadowDOM 翻译卡片 UI
│   │   ├── document-translator.js # 整页翻译与双语逻辑
│   │   ├── context-processor.js   # 上下文提取
│   │   ├── ocr-translator.js      # OCR 翻译流程
│   │   └── ...
│   ├── pdf/
│   │   ├── build/                 # PDF.js 预构建文件
│   │   └── web/                   # 学术查看器（独立页面）
│   ├── popup/                     # 扩展弹出面板
│   └── shared/                    # UMD 共享模块
├── tests/                         # Node.js 内建测试
└── icons/                         # 扩展图标
```

## 🛠️ 开发

本项目为**纯 JavaScript（ES2020+）**，无 TypeScript、无打包工具、无包管理器。修改源码后在扩展管理页点击刷新即可生效。

```bash
# 运行测试（Node.js 内建测试运行器）
node --test tests/text-index-core.test.js
node --test tests/translation-memory-core.test.js
```

### 代码风格

- 4 空格缩进，单引号，始终使用分号
- 常量 `UPPER_SNAKE_CASE`，类 `PascalCase`，私有方法 `_camelCase`
- 用户可见字符串一律中文（`zh-CN`）
- 每个文件顶部 `/** */` JSDoc 注释

## ❓ 常见问题

<details>
<summary><b>翻译失败怎么办？</b></summary>

前往设置页确认所选引擎的 API Key 是否正确，点击「测试」按钮验证连通性。若主引擎不可用，扩展会自动回退至 Google Translate。
</details>

<details>
<summary><b>OCR 识别不准？</b></summary>

请提供清晰、高分辨率的图片。对于截图或照片，裁切后确保文字水平排列可显著提升效果。
</details>

<details>
<summary><b>PDF 阅读器没有自动打开？</b></summary>

仅 `file://` 协议的本地 PDF 会被自动重定向到学术查看器。如需此功能，请在扩展管理页勾选「允许访问文件网址」。
</details>

## 🤝 贡献

欢迎以 Issue 或 Pull Request 形式提交改进：

1. Fork 本仓库并在新分支上开发
2. 保持中文界面字符串一致（`zh-CN`）
3. 在 PR 描述中写明改动目的与复现步骤

## 📄 许可证

本项目采用 [MIT 许可证](LICENSE) 开源。

## 🙏 致谢

- [PDF.js](https://mozilla.github.io/pdf.js/) — PDF 渲染引擎
- [Tesseract.js](https://github.com/naptha/tesseract.js) — 浏览器端 OCR
- 所有提交反馈与贡献的用户

---

<div align="center">

### ☕ 赞助与支持

如果 AcadMaster 对你的学习或研究有帮助，欢迎扫码支持：

<img src="assets/sponsor/alipay.jpg" alt="支付宝" width="160" />&nbsp;&nbsp;&nbsp;&nbsp;<img src="assets/sponsor/wechat.jpg" alt="微信" width="160" />

**仓库地址**：[github.com/Rugkey/acadmaster](https://github.com/Rugkey/acadmaster)

</div>
