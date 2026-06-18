# Chrome Web Store Submission Notes

## Single purpose

Readable Web Translator helps users translate webpages with their own model API keys. It provides bilingual translation, full-page translation, automatic selection translation, and optional image text translation.

## Permission justification

### `storage`

Used to save extension settings locally, including provider selection, model names, API keys, protected terms, feature toggles, and disabled site preferences.

### `activeTab`

Used by the popup to identify the current active webpage origin when the user opens the extension popup, so the user can enable or disable translation for the current site.

### `content_scripts.matches: <all_urls>`

Needed because webpage translation must read visible text from arbitrary pages and insert translations back into those pages. The extension provides a current-site enable switch so users can turn the feature off per site.

### `host_permissions`

The extension declares API provider hosts:

- `https://api.deepseek.com/*`
- `https://api.moonshot.ai/*`
- `https://api.moonshot.cn/*`
- `https://api.openai.com/*`

These are required for the extension background script to send translation requests to the user-selected provider.

The extension also declares `<all_urls>` in `host_permissions`. This is required only for the optional image translation feature: when a user clicks a "Translate image" button, the background script fetches that specific image, converts it to a data image, and sends it to the user-selected image model provider. This avoids exposing API keys to webpage scripts and avoids provider failures with unsupported third-party image URLs. The extension does not automatically upload all page images.

## Data practices summary

- API keys are stored locally in `chrome.storage.local`.
- API keys are not sent to webpage content scripts.
- Webpage text is sent only to the model provider selected by the user.
- Image translation reads the clicked image and sends a data image only when the user clicks the image translation button.
- The extension does not run a separate backend server.
- The extension does not sell data, use data for ads, or collect analytics.

## Store listing draft

Short description:

> Translate webpages with your own AI API key. Bilingual, full-page, selection, and optional image translation.

Detailed description:

> Readable Web Translator is a BYOK webpage translation extension. Configure your own DeepSeek, Kimi / Moonshot, or OpenAI API key, then translate webpages in bilingual or full-page mode.
>
> Features:
> - Bilingual translation that keeps the original page layout readable.
> - Full-page replacement translation for immersive reading.
> - Automatic selection translation when enabled.
> - Optional image text translation for screenshots, news images, tables, and charts.
> - Separate text and image model channels to balance cost and quality.
> - Protected terms for tickers, company names, URLs, code, usernames, and custom vocabulary.
> - Per-site enable switch.
>
> Your API keys are stored locally. Translation content is sent directly to the provider you configure.

## Screenshots to prepare

1. Popup showing text model, image model, current-site switch, and feature toggles.
2. Bilingual translation on a social/media page.
3. Full-page translation mode.
4. Selection translation popover.
5. Image translation button and result popover.

## Official references

- Publish flow: https://developer.chrome.com/docs/webstore/publish
- Privacy fields: https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- Privacy policy requirements: https://developer.chrome.com/docs/webstore/program-policies/privacy
- Permissions: https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions
- Store images: https://developer.chrome.com/docs/webstore/images
