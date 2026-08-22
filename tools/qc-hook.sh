#!/usr/bin/env bash
# PostToolUse hook: run the Beat Hive QC gate whenever dj-lab2.html is edited.
#
# Reads the hook payload on stdin, exits silently (0) for any other file, and on
# QC failure emits {"decision":"block","reason":...} so the failure is surfaced
# back to Claude instead of being swallowed.
#
# Test:  echo '{"tool_input":{"file_path":"/Users/xxc2xx/pitch-trainer/dj-lab2.html"}}' | bash tools/qc-hook.sh

set -uo pipefail

TARGET="/Users/xxc2xx/pitch-trainer/dj-lab2.html"
QC="/Users/xxc2xx/pitch-trainer/tools/qc.js"

# jq is the only hard dependency for reading the payload; bail out quietly if absent
command -v jq >/dev/null 2>&1 || exit 0

f=$(jq -r '.tool_input.file_path // .tool_response.filePath // empty' 2>/dev/null)
[ "$f" = "$TARGET" ] || exit 0

# hooks may run with a trimmed PATH — resolve node explicitly
NODE=$(command -v node || true)
[ -n "$NODE" ] || NODE=/opt/anaconda3/bin/node
[ -x "$NODE" ] || exit 0

if out=$("$NODE" "$QC" 2>&1); then
  exit 0                                  # pass: stay quiet
fi

printf '%s' "$out" | jq -Rs \
  '{decision:"block",
    reason:("Beat Hive QC gate FAILED for dj-lab2.html — fix before continuing:\n\n" + .)}'
exit 0
