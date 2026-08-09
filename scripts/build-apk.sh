#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "Installing dependencies..."
npm ci

echo "Bumping app version..."
NODE_BIN="${NODE_BIN:-node}"
if [[ -x "$ROOT/.tools/node.exe" ]]; then
  NODE_BIN="$ROOT/.tools/node.exe"
fi
"$NODE_BIN" scripts/bump-version.mjs

echo "Generating native Android project..."
CI=1 npx expo prebuild --platform android

echo "Building release APK..."
cd android
./gradlew assembleRelease --no-daemon

APK_OUT="$ROOT/android/app/build/outputs/apk/release/app-release.apk"
if [[ ! -f "$APK_OUT" ]]; then
  echo "ERROR: APK not found at $APK_OUT" >&2
  exit 1
fi

APP_VERSION="$("$NODE_BIN" -e "console.log(require(process.argv[1]).expo.version)" "$ROOT/app.json")"
VERSIONED_APK="$ROOT/CDV-Plan-$APP_VERSION.apk"
cp "$APK_OUT" "$VERSIONED_APK"
echo "Done: $(basename "$VERSIONED_APK") updated ($(du -h "$VERSIONED_APK" | cut -f1))"
