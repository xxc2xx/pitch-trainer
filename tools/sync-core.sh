#!/bin/sh
# Copy the shared modules into beat-hive (vendored, same origin at runtime but
# separate repos). beat-hive's tools/qc.js fails if the copies drift.
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${1:-$HERE/../beat-hive}"
for f in music-core.js hear.js midi.js; do cp "$HERE/$f" "$DEST/$f"; echo "synced $f → $DEST"; done
