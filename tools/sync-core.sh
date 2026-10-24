#!/bin/sh
# Copy the shared modules into the sibling apps (vendored, same origin at
# runtime but separate repos). Their tools/qc.js fail if the copies drift.
#   beat-hive    music-core.js hear.js midi.js
#   music-garden music-core.js hear.js midi.js sound.js
# tools/sync-core.sh [dest…]   (default: both, when present)
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"
[ $# -gt 0 ] || set -- "$HERE/../beat-hive" "$HERE/../music-garden"
for DEST in "$@"; do
  [ -d "$DEST" ] || continue
  FILES="music-core.js hear.js midi.js"
  [ -f "$DEST/sound.js" ] && FILES="$FILES sound.js"
  for f in $FILES; do cp "$HERE/$f" "$DEST/$f"; echo "synced $f → $DEST"; done
done
