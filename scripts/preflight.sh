#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

cd "$ROOT_DIR"

node --check src/background.js
node --check src/content.js
node --check src/popup.js
node --check src/options.js
python3 -m json.tool manifest.json >/dev/null

for file in \
  manifest.json \
  README.md \
  PRIVACY.md \
  STORE_SUBMISSION.md \
  RELEASE_CHECKLIST.md \
  icons/icon16.png \
  icons/icon32.png \
  icons/icon48.png \
  icons/icon128.png \
  store-assets/listing-zh.md \
  store-assets/listing-en.md \
  store-assets/privacy-form-draft.md \
  store-assets/screenshot-plan.md \
  store-assets/popup-preview.html \
  store-assets/demo-page.html
do
  if [ ! -f "$file" ]; then
    echo "Missing required file: $file" >&2
    exit 1
  fi
done

sh scripts/package-extension.sh >/dev/null

echo "preflight-ok"
