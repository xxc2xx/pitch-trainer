#!/bin/sh
# Producer gate: before pushing a change to a shared module, run every
# consumer's own gate against the CANDIDATE modules, in a throwaway copy.
# Nothing in the real consumer repos is touched.
#   tools/consumers-test.sh [--major]
# Exit 1 if any consumer would break.
HERE="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
node "$HERE/tools/shared.mjs" check || exit 1
FAIL=0
for c in beat-hive music-garden; do
  SRC="$HERE/../$c"; [ -d "$SRC" ] || { echo "skip $c (not checked out)"; continue; }
  rsync -a --exclude .git --exclude reports --exclude staging "$SRC/" "$TMP/$c/"
  echo "── $c"
  if ! node "$HERE/tools/shared.mjs" sync "$TMP/$c" "$@" >/dev/null; then echo "  FAIL  sync refused for $c"; FAIL=1; continue; fi
  if [ -f "$TMP/$c/tools/gate.sh" ]; then (cd "$TMP/$c" && PITCH_TRAINER="$HERE" sh tools/gate.sh) || FAIL=1
  else (cd "$TMP/$c" && PITCH_TRAINER="$HERE" node tools/qc.js) || FAIL=1; fi
done
[ $FAIL = 0 ] && echo "\nCONSUMERS PASS" || echo "\nCONSUMERS FAIL — do not push the shared change"
exit $FAIL
