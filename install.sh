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
# A copy left mounted from an earlier browser download would still be blocked by macOS; eject it.
for vol in /Volumes/Application\ Workspace*; do
  [ -d "$vol" ] && hdiutil detach -quiet "$vol" 2>/dev/null || true
done
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

# Copies from an earlier browser download carry the flag that makes macOS refuse to open them.
for other in "/Applications/$APP" "$HOME/Applications/$APP" "$HOME/Downloads/$APP"; do
  [ -d "$other" ] && [ "$other" != "$DEST/$APP" ] || continue
  xattr -r "$other" 2>/dev/null | grep -q com.apple.quarantine || continue
  if xattr -dr com.apple.quarantine "$other" 2>/dev/null; then
    say "Also fixed an older copy at $other."
  else
    printf '\033[1;33mNote:\033[0m an older copy at %s may still be blocked. Drag it to the Bin and use the one in %s.\n' "$other" "$DEST"
  fi
done

say "Done! Application Workspace is in $DEST."
[ -z "${AW_NO_OPEN:-}" ] || exit 0

open "$DEST/$APP"
for _ in $(seq 1 20); do
  pgrep -f "$DEST/$APP/Contents/MacOS/" >/dev/null && { say "It's open. Enjoy!"; exit 0; }
  sleep 0.5
done

# macOS still refused (stricter versions or school-managed Macs). Point straight at the fix.
cat <<'MSG'

macOS blocked the app because it isn't registered with Apple. To allow it (one time only):
  1. Click "Done" on the warning, if one is showing.
  2. In the Privacy & Security window that's opening now, scroll down to
     "Application Workspace was blocked" and click "Open Anyway".
  3. Enter your Mac password, then click "Open Anyway" once more.
MSG
open "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension" 2>/dev/null || true
