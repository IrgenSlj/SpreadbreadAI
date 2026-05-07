#!/usr/bin/env bash
set -euo pipefail

# Package the SpreadbreadAI LibreOffice extension as an .oxt bundle.

HERE="$(cd "$(dirname "$0")" && pwd)"
BUILD="$HERE/build"
OUT="$HERE/spreadbreadai.oxt"

rm -rf "$BUILD" "$OUT"
mkdir -p "$BUILD"

# Manifest files are placed at the root of the bundle.
cp -R "$HERE/manifest/META-INF" "$BUILD/"
cp "$HERE/manifest/description.xml"      "$BUILD/"
cp "$HERE/manifest/description-en.txt"   "$BUILD/"
cp "$HERE/manifest/Addons.xcu"           "$BUILD/"
cp "$HERE/manifest/ProtocolHandler.xcu"  "$BUILD/"

# Python component lives under python/.
mkdir -p "$BUILD/python"
cp "$HERE/python/main.py" "$BUILD/python/"
cp -R "$HERE/python/spreadbreadai" "$BUILD/python/"

find "$BUILD" -name __pycache__ -type d -exec rm -rf {} + 2>/dev/null || true

(
  cd "$BUILD"
  zip -qr "$OUT" .
)

echo "Built $OUT"
