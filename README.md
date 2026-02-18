# 学术大拿 (XiaoEt) - 浏览器扩展

[![License](https://img.shields.io/github/license/Rugkey/xiaoet-extension)](LICENSE)
[![Version](https://img.shields.io/chrome-web-store/v/dcahjpdjmaehmjgcnpchakhncndceall)](https://chrome.google.com/webstore/detail/学术大拿/dcahjpdjmaehmjgcnpchakhncndceall)
[![Downloads](https://img.shields.io/chrome-web-store/users/dcahjpdjmaehmjgcnpchakhncndceall)](https://chrome.google.com/webstore/detail/学术大拿/dcahjpdjmaehmjgcnpchakhncndceall)

学术大拿是一个功能丰富的浏览器扩展，专门针对学术研究和论文阅读场景设计。该扩展提供智能翻译、PDF阅读器、AI对话等功能，帮助用户克服语言障碍，提高学术工作效率。

## 🌟 主要特性

- **智能划词翻译** - 支持多种AI引擎（DeepSeek、OpenAI、DeepL等）
- **专业PDF查看器** - 集成PDF.js，支持批注、高亮等工具
- **AI深度对话功能** - 基于当前阅读内容进行AI问答
- **多引擎翻译融合** - 结合不同引擎优势，提供更准确翻译
- **域特定翻译** - 学术、医学、法律、技术等专业领域优化
- **OCR功能** - 支持图片文字识别和翻译

## 🛠️ 技术架构

### 核心组件
- **Manifest V3**: 使用最新的Chrome扩展API标准
- **Service Worker**: 后台服务处理翻译请求和消息传递
- **Content Scripts**: 与网页交互，处理划词选择
- **Popup UI**: 扩展图标弹出界面
- **Options Page**: 用户设置和配置界面

### 文件结构
```
src/
├── background/           # Service worker
├── content/              # 内容脚本
│   ├── utils.js          # 工具函数
│   ├── styles.js         # UI样式
│   ├── drag.js           # 拖拽功能
│   ├── ui.js             # UI组件
│   ├── adapter.js        # 内容适配器
│   └── main.js           # 主入口
├── pdf/                  # PDF查看器
│   ├── web/              # Web界面
│   └── build/            # PDF.js构建文件
└── popup/                # 扩展弹出界面
```

## 🚀 快速开始

### 安装
1. 克隆或下载项目文件
2. 打开Chrome浏览器，访问 `chrome://extensions/`
3. 启用"开发者模式"
4. 点击"加载已解压的扩展程序"
5. 选择项目根目录

### 配置
1. 点击扩展图标，选择"进入控制中心"
2. 配置所需的API密钥（DeepSeek、OpenAI、DeepL）
3. 选择偏好的翻译引擎和设置

## 📋 功能详解

### 1. 划词翻译
- 在任意网页上选中文本，点击"大拿"图标或使用快捷键 `Alt + Shift + X`
- 支持多种翻译引擎：Google、DeepSeek、DeepL、OpenAI
- 多引擎融合翻译，结合不同引擎的优势

### 2. PDF阅读器
- 集成PDF.js，支持本地PDF文件拖放打开
- 自动重定向本地PDF到学术专用查看器
- 支持批注、高亮等工具

### 3. AI对话功能
- 基于当前阅读内容进行AI问答
- 支持上下文感知翻译

### 4. 设置面板
- API密钥配置（DeepSeek、OpenAI、DeepL）
- 翻译引擎选择
- 域特定翻译配置（学术、文学、商业、医学、法律、技术）
- 目标语言设置

## 🔧 翻译引擎配置

### 支持的引擎
- **Google Translate**: 免费，基础翻译
- **DeepSeek AI**: 推荐，学术内容优化
- **DeepL Pro**: 高质量翻译
- **OpenAI GPT-4o**: 上下文感知翻译
- **Multi-Engine Fusion**: 智能融合多个引擎结果

### 域特定翻译
- 通用（默认）
- 学术（严谨）
- 文学（优美）
- 商务（正式）
- 医学（专业）
- 法律（精确）
- 技术（准确）

## 🧪 开发与测试

### 运行测试
```bash
# 运行项目测试
npm test
```

### 构建项目
```bash
# 构建生产版本
npm run build
```

## 🤝 贡献

我们欢迎任何形式的贡献！请参阅我们的贡献指南来了解如何开始。

1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 📄 许可证

本项目采用 MIT 许可证 - 详情请参见 [LICENSE](LICENSE) 文件。

## 📞 支持

如果您遇到问题或有建议，请通过以下方式联系我们：

- 提交 [GitHub Issues](https://github.com/Rugkey/xiaoet-extension/issues)
- 发送邮件至 [1336915779@qq.com](mailto:1336915779@qq.com)

## 💬 社区

加入我们的社区讨论：

- [GitHub Discussions](https://github.com/Rugkey/xiaoet-extension/discussions)
- [Discord](https://discord.gg/example)

---

<div align="center">
  <sub>由 XiaoEt 社区驱动，旨在支持您的学术探索之路</sub>
</div>