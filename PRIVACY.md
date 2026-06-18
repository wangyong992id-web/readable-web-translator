# Privacy Policy

Readable Web Translator is a bring-your-own-key browser extension for webpage translation.

## Data the extension handles

The extension may process the following data only when you use its features:

- Webpage text selected for translation.
- Visible webpage text translated in bilingual or full-page mode.
- Image data when you click the image translation button.
- Extension settings, including model provider, model name, protected terms, feature toggles, and API keys.

## How data is used

Webpage text and selected text are sent directly from the extension background script to the model provider you configure, such as DeepSeek, Kimi / Moonshot, or OpenAI. Image translation reads only the image you click, converts it to a data image when needed, and sends it to the image model provider you configure.

The extension does not operate a separate server, does not collect analytics, does not sell user data, and does not use translated content for advertising.

## API key storage

API keys are stored locally with `chrome.storage.local`. They are not stored in Chrome sync storage by this extension and are not exposed to webpage content scripts. API keys are only used by the extension background script to call the provider you select.

## Third-party providers

When you configure a model provider, translated content is processed according to that provider's own terms and privacy policy. You should only use providers and API keys that you trust.

The current preset providers are:

- DeepSeek: `https://api.deepseek.com`
- Kimi / Moonshot: `https://api.moonshot.ai`
- Kimi / Moonshot domestic: `https://api.moonshot.cn`
- OpenAI: `https://api.openai.com`

## User control

You can disable the extension on the current site from the popup. You can also independently enable or disable selection translation and image translation buttons.

## Contact

For support or privacy questions, use the support contact listed on the Chrome Web Store listing.
