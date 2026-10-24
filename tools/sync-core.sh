#!/bin/sh
# Copy the shared engine modules into the consumer apps and pin them in each
# consumer's vendor.lock.json (governance: CLAUDE.md, tools/shared.mjs).
#   tools/sync-core.sh [consumer-dir…] [--major] [--to <commit>] [--dry]
# Default consumers: ../beat-hive ../music-garden (when present).
# Run tools/consumers-test.sh first — it proves the change against every
# consumer's own gate before anything is copied for real.
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"
DIRS=""; FLAGS=""
while [ $# -gt 0 ]; do
  case "$1" in
    --to) FLAGS="$FLAGS --to $2"; shift 2 ;;
    --*)  FLAGS="$FLAGS $1"; shift ;;
    *)    DIRS="$DIRS $1"; shift ;;
  esac
done
[ -n "$DIRS" ] || for d in "$HERE/../beat-hive" "$HERE/../music-garden"; do [ -d "$d" ] && DIRS="$DIRS $d"; done
node "$HERE/tools/shared.mjs" check
for d in $DIRS; do
  echo "→ $(basename "$d")"
  node "$HERE/tools/shared.mjs" sync "$d" $FLAGS
done
