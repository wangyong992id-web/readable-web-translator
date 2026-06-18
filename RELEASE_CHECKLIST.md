# Release Checklist

## Code checks

- Run `node --check src/background.js`.
- Run `node --check src/content.js`.
- Run `node --check src/popup.js`.
- Run `node --check src/options.js`.
- Run `python3 -m json.tool manifest.json`.
- Load the unpacked extension in a clean Chrome profile.

## Manual test matrix

- First install shows popup without errors.
- Text API key can be saved.
- Image API key can be saved independently.
- Current site can be disabled and enabled again.
- Bilingual translation works.
- Full-page translation works.
- Restore removes inserted translations and restores replaced text.
- Infinite-scroll content is translated after the first translation action.
- Selection translation only triggers when the toggle is enabled.
- Image translation buttons only appear when the image toggle is enabled.
- Japanese and Korean text can trigger translation.

## Chrome Web Store assets

- Extension icons: 16, 32, 48, and 128 px.
- At least one screenshot; recommended five screenshots.
- Short description.
- Detailed description.
- Privacy policy URL.
- Support contact.
- Permission justifications.
- Privacy practices form completed accurately.

## Package

- Run `sh scripts/package-extension.sh`.
- Upload the generated ZIP from `dist/`.
- Do not include `.git`, local temp files, screenshots drafts, or API keys.
