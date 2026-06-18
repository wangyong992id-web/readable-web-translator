# Readable Web Translator

一个可自带大模型 API token 的网页翻译浏览器扩展。当前版本支持：

- 双语对照：尽量在原段落后追加译文，保留原网页结构。
- 全文翻译：直接替换文本节点，适合沉浸阅读。
- 划词翻译：开启后选中文字自动翻译。
- 图片翻译：内容图片悬停时显示 `译图`，适合新闻截图、表格截图和长图。建议使用 Kimi 或 OpenAI 视觉模型。
- OpenAI 兼容接口：文本翻译和图片翻译可分别选择 DeepSeek、Kimi/Moonshot 或 OpenAI，并分别填写 API token。
- 批量翻译、并发限流、内存缓存，减少慢和重复请求。
- 自动保护 URL、用户名、股票代码、金额、代码片段和自定义保护词，减少误翻公司简称或 ticker。
- 支持英语、简体中文、繁体中文、日语、韩语和自动识别，并提供自然准确、金融科技、忠实自然三种翻译风格。
- 当前站点启用开关、划词自动翻译开关、图片翻译按钮开关，减少对不需要翻译的网站打扰。

## 安装

1. 打开 Chrome/Edge 的扩展管理页。
2. 启用开发者模式。
3. 选择“加载已解压的扩展程序”。
4. 选择本项目目录：`/Users/wangyong/Documents/翻译插件`。
5. 打开扩展设置页，填写 API token 和模型。

推荐配置：文本翻译使用 DeepSeek 控成本；图片翻译单独使用 Kimi 或 OpenAI 视觉模型。

## 常用配置

DeepSeek:

- API Base URL: `https://api.deepseek.com`
- Model: `deepseek-chat` 或 `deepseek-reasoner`

Kimi / Moonshot 国内站:

- API Base URL: `https://api.moonshot.cn/v1`
- Model: 以 Kimi 控制台当前可用模型名为准，例如 `kimi-k2.6`

Kimi / Moonshot 国际站:

- API Base URL: `https://api.moonshot.ai/v1`
- Model: 以 Kimi 控制台当前可用模型名为准，例如 `kimi-k2.6`

OpenAI:

- API Base URL: `https://api.openai.com/v1`
- Model: `gpt-4.1-mini` 或 `gpt-4o-mini`

## API key 安全

- API key 保存在 `chrome.storage.local`，不会同步到 Chrome 账号云端。
- 网页内容脚本不会读取 API key；只有扩展后台脚本在请求翻译接口时使用。
- API key 只会通过 HTTPS 发送给预设的 DeepSeek、Kimi/Moonshot 国内站、Kimi/Moonshot 国际站或 OpenAI 官方接口地址。
- 扩展权限已限制为这些官方 API 域名，不再申请访问所有网站接口的跨域请求权限。
- 不建议把这个扩展安装包发给别人时预填自己的 key。

## 使用

刷新目标网页后，右下角会出现工具条：

- `双语`：显示英文原文和中文译文。
- `全文`：用中文替换网页文本。
- `还原`：恢复网页原始文本。

打开扩展 popup 可以控制：

- 当前站点启用：关闭后会隐藏悬浮工具、停止自动同步，并移除图片翻译按钮。
- 划词自动翻译：开启后选中文字即翻译；关闭后不会触发。
- 图片翻译按钮：开启后内容图片上显示 `译图` 按钮；关闭后不增强图片。

## 发布准备

- 隐私政策草稿：`PRIVACY.md`
- Chrome 商店提交说明：`STORE_SUBMISSION.md`
- 发布检查清单：`RELEASE_CHECKLIST.md`
- 打包命令：`sh scripts/package-extension.sh`

## 建议

如果觉得慢，可以调高“并发数”和“每批段落数”，但过高可能触发接口限流。网页排版很复杂时，优先使用“双语”模式，它比全文替换更少影响原始结构。
