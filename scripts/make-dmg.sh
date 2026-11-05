#!/bin/bash
# Build .dmg installers for both Mac architectures, without an Apple Developer
# account. electron-builder's own dmg target leaves the bundle only
# linker-signed, so each .app is given a proper ad-hoc signature first: macOS
# then has something to verify, and the app runs once the user allows it.
#
#   yarn build-dmg
#
# The result is unsigned as far as Apple is concerned, so Gatekeeper will still
# ask the first time — see "Installing the app" in the README.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")
NAME=$(node -p "require('./package.json').build.productName")
OUT=dist/installers
mkdir -p "$OUT"

build_one() {
  local arch="$1" appdir="$2" suffix="$3"
  echo "==> $arch"
  CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dir "--$arch" \
    --publish never -c.mac.identity=null -c.mac.hardenedRuntime=false

  codesign --force --deep --sign - "$appdir/$NAME.app"
  codesign --verify --deep --strict "$appdir/$NAME.app"

  local stage="dist/stage-$arch"
  rm -rf "$stage"; mkdir -p "$stage"
  cp -R "$appdir/$NAME.app" "$stage/"
  ln -s /Applications "$stage/Applications"

  local dmg="$OUT/$NAME-$VERSION$suffix.dmg"
  rm -f "$dmg"
  hdiutil create -quiet -volname "$NAME $VERSION" -srcfolder "$stage" \
    -ov -format UDZO "$dmg"
  rm -rf "$stage"
  echo "    $dmg"
}

build_one arm64 dist/mac-arm64 -arm64
build_one x64 dist/mac -intel

shasum -a 256 "$OUT"/*.dmg | tee "$OUT/SHA256SUMS.txt"
