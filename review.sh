#!/bin/bash
# review.sh — run after hard gates pass, before requesting Winston approval.
# Thin wrapper: all review logic lives in the shared script, so this can't
# drift from the git pre-push hook or the /dispatch code-domain pre-flight.
#
# Usage: bash review.sh [--force]
# Prerequisite: codex login (done once)
#
# Note: dj-lab2.html has its own purpose-built validator — run that too:
#   node tools/qc.js dj-lab2.html

exec "$HOME/busy-brain/claude-config/hooks/codex-review-run.sh" "$(cd "$(dirname "$0")" && pwd)" "$@"
