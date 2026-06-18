#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
VERSION=$(node -e "console.log(require('$ROOT_DIR/manifest.json').version)")
DIST_DIR="$ROOT_DIR/dist"
PACKAGE_NAME="readable-web-translator-$VERSION.zip"

mkdir -p "$DIST_DIR"
rm -f "$DIST_DIR/$PACKAGE_NAME"

cd "$ROOT_DIR"
zip -r "$DIST_DIR/$PACKAGE_NAME" \
  manifest.json \
  README.md \
  PRIVACY.md \
  STORE_SUBMISSION.md \
  RELEASE_CHECKLIST.md \
  icons \
  src \
  -x "*.DS_Store" \
  -x "*/__MACOSX/*"

echo "$DIST_DIR/$PACKAGE_NAME"
