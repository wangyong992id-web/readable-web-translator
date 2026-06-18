# Chrome 商店上架填写稿

## 上传文件

扩展 ZIP：

`/Users/wangyong/Documents/翻译插件/dist/readable-web-translator-0.1.0.zip`

## 截图

上传以下 5 张，均为 1280x800：

- `/Users/wangyong/Documents/翻译插件/store-assets/submission-screenshots/popup-preview.png`
- `/Users/wangyong/Documents/翻译插件/store-assets/submission-screenshots/real-bilingual.png`
- `/Users/wangyong/Documents/翻译插件/store-assets/submission-screenshots/real-fullpage.png`
- `/Users/wangyong/Documents/翻译插件/store-assets/submission-screenshots/real-selection.png`
- `/Users/wangyong/Documents/翻译插件/store-assets/submission-screenshots/demo-toolbar-expanded.png`

商店图标：

`/Users/wangyong/Documents/翻译插件/icons/icon128.png`

## 基本信息

名称：

Readable Web Translator

简短描述：

Translate webpages with your own AI API key. Bilingual, full-page, selection, and optional image translation.

类别：

Productivity

语言：

English

## 详细描述

Readable Web Translator is a bring-your-own-key webpage translation extension for people who read social posts, news, technical writing, and market commentary across languages.

Configure your own DeepSeek, Kimi / Moonshot, or OpenAI API key, then translate webpages directly in Chrome.

Features:

- Bilingual translation for readable side-by-side learning.
- Full-page translation for immersive reading.
- Automatic selection translation when enabled.
- Optional image text translation for screenshots, news images, tables, and charts.
- Separate text and image model channels to balance cost and quality.
- Protected terms for tickers, company names, URLs, code, usernames, and custom vocabulary.
- Per-site enable switch.
- Local API key storage.

Your API keys are stored locally in Chrome extension storage. Translation content is sent directly to the model provider you configure. The extension does not operate its own backend server, does not sell user data, does not use translated content for ads, and does not collect analytics.

## 权限说明

`storage`

Used to save extension settings locally, including provider selection, model names, API keys, protected terms, feature toggles, toolbar position, and disabled site preferences.

`activeTab`

Used by the popup to identify the current active webpage origin when the user opens the extension popup, so the user can enable or disable translation for the current site.

`content_scripts.matches: <all_urls>`

Needed because webpage translation must read visible text from arbitrary webpages and insert translations back into those pages. Users can disable the extension per site from the popup.

`host_permissions: <all_urls>`

Required for the optional image translation feature. When a user clicks a Translate image button, the background script fetches that specific clicked image, converts it to a data image, and sends it to the user-selected image model provider. This keeps API keys out of webpage content scripts and avoids provider failures with unsupported third-party image URLs. The extension does not automatically upload all images on a page.

Provider host permissions:

- `https://api.deepseek.com/*`
- `https://api.moonshot.ai/*`
- `https://api.moonshot.cn/*`
- `https://api.openai.com/*`

These are required for the background script to send translation requests to the user-selected provider.

## 隐私实践表单建议

数据用途：

- Single purpose: webpage translation using the user's own API keys.
- No ads.
- No analytics.
- No sale or transfer of user data.
- No separate extension backend.

会处理的数据：

- Webpage content: only text selected by the user or visible page text translated by the user.
- User activity / website content: only as needed to provide translation on the current webpage.
- Authentication information: API keys stored locally and used only to call the selected provider.

数据传输：

- Text and clicked image data may be sent directly to the model provider configured by the user.
- API keys are sent only to the matching provider API endpoint as authorization headers.

隐私政策 URL：

需要把 `/Users/wangyong/Documents/翻译插件/PRIVACY.md` 发布到一个公网 URL 后填写。

## 审核风险提醒

最大审核风险是 `<all_urls>` 权限。提交时必须清楚说明它用于：

1. 网页文本翻译。
2. 用户点击“译图”后读取那一张图片。
3. 不自动上传所有图片。
4. API key 不暴露给网页脚本。
