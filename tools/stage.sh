#!/bin/sh
# Build a staging copy of a repo's feature branch into staging/ on main,
# served by GitHub Pages at https://xxc2xx.github.io/<repo>/staging/.
# Live files at the repo root are not touched. Commits locally; push is a
# separate, deliberate step: git -C <worktree> push origin HEAD:main
# (the worktree is a detached HEAD, so plain `push origin main` does nothing).
#
#   tools/stage.sh <repo-dir> <branch> <files...>
set -e
REPO="$(cd "$1" && pwd)"; BRANCH="$2"; shift 2
NAME="$(basename "$REPO")"
WT="${TMPDIR:-/tmp}/stage-$NAME"
git -C "$REPO" fetch -q origin
[ -d "$WT" ] && git -C "$REPO" worktree remove --force "$WT"
git -C "$REPO" worktree add -q --detach "$WT" origin/main
rm -rf "$WT/staging"; mkdir -p "$WT/staging"
for f in "$@"; do mkdir -p "$WT/staging/$(dirname "$f")"; git -C "$REPO" show "$BRANCH:$f" > "$WT/staging/$f"; done
SHA="$(git -C "$REPO" rev-parse --short "$BRANCH")"
# Mark it unmistakably: banner, noindex, distinct install name
python3 - "$WT/staging" "$SHA" <<'PY'
import sys, os, re, json
d, sha = sys.argv[1], sys.argv[2]
p = os.path.join(d, 'index.html'); s = open(p).read()
badge = ('<div style="position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:99999;'
         'background:#ff9800;color:#000;font:700 10px/1.6 sans-serif;padding:0 8px;'
         'border-radius:0 0 6px 6px;pointer-events:none">STAGING ' + sha + '</div>')
s = s.replace('<meta charset="UTF-8">', '<meta charset="UTF-8">\n  <meta name="robots" content="noindex">', 1)
# cache-bust local scripts: Pages caches .js for 10 min, and an old module
# against a new index.html breaks (seen in testing)
s = re.sub(r'<script src="([\w.-]+\.js)"></script>', lambda m: '<script src="%s?v=%s"></script>' % (m.group(1), sha), s)
s = re.sub(r'(<body[^>]*>)', lambda m: m.group(1) + '\n' + badge, s, count=1)
open(p, 'w').write(s)
m = os.path.join(d, 'manifest.json')
if os.path.exists(m):
    j = json.load(open(m)); j['name'] += ' (staging)'; j['short_name'] += ' β'
    json.dump(j, open(m, 'w'), indent=2)
sw = os.path.join(d, 'sw.js')
if os.path.exists(sw):
    t = open(sw).read(); t = re.sub(r"const CACHE = '([^']+)'", r"const CACHE = 'staging-\1'", t, count=1)
    open(sw, 'w').write(t)
PY
git -C "$WT" add staging
git -C "$WT" commit -q -m "staging: $BRANCH @ $SHA

Preview build at /staging/ — live files untouched.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HytTH57eALNofyptgsFGY2"
echo "staged $NAME $BRANCH@$SHA in $WT ($(git -C "$WT" rev-parse --short HEAD)) — not pushed"
