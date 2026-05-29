#!/usr/bin/env bash
# Package only the shippable extension files into a distributable .zip.
# Usage: npm run package   (or: bash scripts/package.sh)
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node --input-type=commonjs -e "process.stdout.write(JSON.parse(require('fs').readFileSync('manifest.json','utf8')).version)")
OUT="dist/tabkan-${VERSION}.zip"

mkdir -p dist
rm -f "$OUT"

# Allowlist: exactly what the extension needs at runtime. Dev-only dirs
# (scripts/, docs/, node_modules/, .github/) and project meta are excluded.
zip -r -q "$OUT" \
  manifest.json \
  background.js \
  popup.html popup.js \
  fullpage.html \
  sidepanel.html sidepanel.js \
  styles.css sidebar-styles.css \
  src \
  icons \
  -x '*/.DS_Store' '*.DS_Store'

echo "Created $OUT"
echo "Contents:"
unzip -l "$OUT"
