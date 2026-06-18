# Chrome Web Store Privacy Form Draft

Use this as a draft when filling the Chrome Web Store privacy practices form.

## Data usage statement

Readable Web Translator processes webpage text and optional image content only to provide translation features requested by the user. The extension does not collect analytics, does not sell user data, does not use data for ads, and does not operate a separate backend server.

## Data categories

### Website content

Yes. The extension reads visible webpage text when the user runs bilingual or full-page translation. It also reads selected text when automatic selection translation is enabled.

Purpose: app functionality.

Handling: sent directly from the extension background script to the model provider selected and configured by the user.

### User activity

No analytics or browsing history is collected. The extension stores only per-site enable/disable preferences locally.

Purpose: app functionality.

Handling: stored locally in `chrome.storage.local`.

### Authentication information

Yes. The user may enter API keys for DeepSeek, Kimi / Moonshot, or OpenAI.

Purpose: app functionality.

Handling: stored locally in `chrome.storage.local`; used only by the extension background script to call the selected model provider.

### Images

Optional. If image translation is enabled and the user clicks the image translation button, the image URL or data image is sent to the configured image model provider.

Purpose: app functionality.

Handling: sent directly to the image model provider selected by the user.

## Data selling or transfer

The extension does not sell user data. Data is sent only to the third-party model provider selected and configured by the user, strictly for translation.

## Privacy policy URL

Publish `PRIVACY.md` as a public webpage and use that URL in the Chrome Web Store listing.
