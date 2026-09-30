#!/bin/bash
set -euo pipefail

APP="$(cd "$(dirname "$0")/.." && pwd)/Trade Assistant.app"

chmod +x "$APP/Contents/MacOS/launch"
chmod +x "$(dirname "$0")/launch.sh"
xattr -cr "$APP" 2>/dev/null || true
codesign -s - --force --deep "$APP"

echo "Podpisano Trade Assistant.app — spróbuj kliknąć dwukrotnie w Finderze."
