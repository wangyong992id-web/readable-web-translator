# Screenshot Plan

Recommended Chrome Web Store screenshots:

## 1. Popup configuration

Open the extension popup on `store-assets/demo-page.html`.

Show:

- Current site switch.
- Text model channel.
- Image model channel.
- Selection translation toggle.
- Image translation button toggle.

Suggested caption:

> Configure text and image translation separately, and control each site from the popup.

Current prepared file:

- `store-assets/screenshots/popup-preview.png`

## 2. Bilingual translation

On the demo page, click the floating translation button, then choose bilingual mode.

Show:

- Original English tweet/article text.
- Translated text inserted near the original content.
- Floating dock on the page edge.

Suggested caption:

> Bilingual mode keeps the original page readable while adding translations nearby.

Current prepared files:

- `store-assets/screenshots/demo-toolbar-collapsed.png`
- `store-assets/screenshots/demo-toolbar-expanded.png`
- `store-assets/screenshots/real-bilingual.png`

## 3. Full-page translation

Restore the page, then run full-page mode.

Show:

- English article converted to the target language.
- Page layout still intact.

Suggested caption:

> Full-page mode replaces visible text for immersive reading.

Current prepared file:

- `store-assets/screenshots/real-fullpage.png`

## 4. Selection translation

Enable selection translation in the popup. Select one sentence on the demo page.

Show:

- Selection popover near the selected text.

Suggested caption:

> Enable once, then select text to translate automatically.

Status:

Current prepared file:

- `store-assets/screenshots/real-selection.png`

## 5. Image translation

Enable image translation buttons in the popup. Hover over the demo image area or a real webpage image and click `译图`.

Show:

- Image translation button.
- Result popover with translated image text.

Suggested caption:

> Optional image text translation for screenshots, tables, news images, and social posts.

Status:

- Pending for manual capture. The automation environment can verify that the image button is inserted, but it does not reliably trigger the hover-only image button interaction. Capture this one manually by hovering the image and clicking `译图`.

## Capture notes

- Use a clean browser profile if possible.
- Do not show real API keys in screenshots.
- Keep the popup focused on feature controls, not secret tokens.
- Prefer 1280x800 or 1366x768 screenshots.
- Use the same target language across all screenshots.
