#!/usr/bin/env bash
# Build the Chrome Web Store upload zip for the Xtag extension.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXT_DIR="$ROOT/extension"
DIST_DIR="$ROOT/dist"

VERSION="$(
  python3 - "$EXT_DIR/manifest.json" <<'PY'
import json, sys
with open(sys.argv[1], "r", encoding="utf-8") as f:
    print(json.load(f)["version"])
PY
)"

OUT="$DIST_DIR/xtag-extension-v${VERSION}.zip"
UNPACKED="$DIST_DIR/xtag-extension-unpacked"
mkdir -p "$DIST_DIR"
rm -f "$OUT"
rm -rf "$UNPACKED"
mkdir -p "$UNPACKED"

cp "$EXT_DIR"/manifest.json \
   "$EXT_DIR"/content.js \
   "$EXT_DIR"/content.css \
   "$EXT_DIR"/popup.html \
   "$EXT_DIR"/popup.js \
   "$UNPACKED"/
cp -R "$EXT_DIR"/icons "$UNPACKED"/icons

(
  cd "$EXT_DIR"
  zip -r "$OUT" \
    manifest.json \
    content.js \
    content.css \
    popup.html \
    popup.js \
    icons
)

echo "$OUT"
echo "$UNPACKED"
