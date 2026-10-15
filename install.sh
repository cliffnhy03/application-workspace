#!/bin/bash
# One-line installer for Application Workspace on macOS:
#   curl -fsSL https://raw.githubusercontent.com/cliffnhy03/application-workspace/main/install.sh | bash
#
# Downloads the latest release's .dmg, copies the app into Applications and opens it.
# Downloading from the Terminal means macOS doesn't flag the file, so there's no
# "can't be opened" warning to work around afterwards.
set -euo pipefail

REPO="cliffnhy03/application-workspace"
APP="Application Workspace.app"
DEST="${AW_INSTALL_DIR:-/Applications}"

say() { printf '\033[1;32m==>\033[0m %s\n' "$1"; }
fail() { printf '\033[1;31mError:\033[0m %s\n' "$1" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fail "This installer is for Macs. On Windows, download the .exe from https://github.com/$REPO/releases/latest"

say "Finding the latest version…"
URL=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
  | grep -o '"browser_download_url": *"[^"]*\.dmg"' | head -1 | sed 's/.*"\(https[^"]*\)"/\1/')
[ -n "$URL" ] || fail "Couldn't find a Mac download. Try again in a minute, or download it from https://github.com/$REPO/releases/latest"

TMP=$(mktemp -d)
MNT="$TMP/mnt"
trap 'hdiutil detach -quiet "$MNT" 2>/dev/null || true; rm -rf "$TMP"' EXIT

say "Downloading $(basename "$URL")…"
curl -fL --progress-bar -o "$TMP/app.dmg" "$URL"

say "Installing into $DEST…"
hdiutil attach -nobrowse -quiet -mountpoint "$MNT" "$TMP/app.dmg"
if [ ! -w "$DEST" ]; then
  DEST="$HOME/Applications"
  mkdir -p "$DEST"
  say "No permission to write to /Applications, so installing into $DEST instead."
fi
if pgrep -f "$DEST/$APP/Contents/MacOS/" >/dev/null; then
  say "Closing the running copy first (your data is saved and won't be touched)…"
  osascript -e 'quit app "Application Workspace"' || true
  sleep 2
fi
rm -rf "$DEST/$APP"
ditto "$MNT/$APP" "$DEST/$APP"
xattr -dr com.apple.quarantine "$DEST/$APP" 2>/dev/null || true

say "Done! Application Workspace is in $DEST."
[ -n "${AW_NO_OPEN:-}" ] || open "$DEST/$APP"
