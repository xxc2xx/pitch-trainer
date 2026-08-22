# AGENTS.md — Reviewer Entry Point (pitch-trainer)

This file is read by Codex. Your role is **reviewer only** — not implementer.
Claude implements changes guided by CLAUDE.md. You review the complete diff.

Shared invariants, severity definitions, and the escalation table: `~/my-agent/QUALITY.md`.
Rules here are additive — they extend QUALITY.md for pitch-trainer specifically.

Client-side ear-training PWA. `index.html` is the entire app (~3,700 lines,
HTML+CSS+JS in one `<script>` block). No backend, no build step, no package
manager. Tone.js / Web Audio for pitch and beat detection.

---

## Division of labour with the existing QC tooling — read this first

**Both files referenced below are currently UNTRACKED — local-only, not in
HEAD.** So in a clean checkout neither exists and none of this applies:
there is no `dj-lab2.html` to review and no validator to defer to. Codex
correctly flagged this on 2026-08-22 (the first review of this repo) as a
dangling deferral; the note is kept here rather than deleted because the
files do exist in the working tree, and re-tracking them is a pending
decision, not an oversight.

When `dj-lab2.html` (the "Beat Hive" reskin prototype) **is** present, it has
a purpose-built validator at `tools/qc.js` — 15+ checks including stub-DOM
execution, CSS-rule presence, sprite integrity, and layout-order collision.
It catches classes of bug that static review cannot (temporal dead zone,
detached nodes, CSS silently deleted by positional edits). `tools/EVAL.md`
is its bug log.

**Only when both files are present in the tree under review:** don't
duplicate those checks — defer to `tools/qc.js` for `dj-lab2.html` and raise
only what it structurally cannot see (e.g. a hardcoded secret). If
`dj-lab2.html` is present but `tools/qc.js` is not, review it normally;
there is nothing to defer to.

Either way, your primary focus is `index.html` — it is tracked, it is the
whole shipped app, and it has no automated coverage at all.

Known-failing check, already understood — do not re-report (applies only in
the local working tree, since the validator isn't tracked):
`tools/qc.js` check #6 ("live app untouched") compares every line of
`index.html` against `dj-lab2.html` and currently reports ~337 missing lines.
Cause: `index.html` gained the practice-logging / Stats / avatar features
(commit `defc7f3`) and the prototype was not re-synced. The check cannot
distinguish "prototype deleted app code" (the bug it guards against) from
"live app moved ahead" (what actually happened).

---

## When you are triggered

- Via the `pre-push` hook on any push (advisory — prints findings, never blocks)
- Via `bash review.sh` locally
- Always against `origin/main..HEAD`

---

## Review guidelines

### Output format

```
FILE: <path>
PASS | FLAG
  [if FLAG]
  RULE: <rule name>
  LINE: <line number or range>
  ISSUE: <one sentence — what is wrong>
  SEVERITY: critical | major | minor
```

Final line:
```
VERDICT: APPROVE | REQUEST_CHANGES
```

`REQUEST_CHANGES` if any critical or major finding. `APPROVE` with findings
listed if minor only.

---

## Rules

### CRED — credential safety `[critical]`
- The Play tab accepts an **Anthropic API key** (`pitchy_api_key`) and an OMR
  server URL (`pitchy_omr_url`), both stored in `localStorage`. Neither may
  ever be hardcoded as a string literal, written into a comment, or included
  in a `console.log` / error message / thrown Error.
- `.certs/` holds local HTTPS dev certs including a **private key**. This repo
  has a public remote. Flag any diff that adds `.pem`/`.key` content, removes
  their `.gitignore` entries, or prints key material.
- No API keys in `manifest.json`, `sw.js`, or any committed JSON.

### AUDIO — iOS audio unlock is load-bearing `[critical]`
- The `touchstart`/`touchend` capture-phase listener plus the silent-WAV
  `<audio>` element is the **only** thing that lets Web Audio bypass the iPhone
  mute switch. It must fire on the first touch anywhere on the page and must
  stay idempotent.
- Flag any change that: attaches it to a specific element instead of
  `document`, removes the capture phase, gates it behind a specific button, or
  reorders it after code that creates an `AudioContext`.
- Multiple contexts exist (`djCtx`, `audioCtx`, `kbCtx`). Flag any new
  `AudioContext` created outside a user gesture.

### STORAGE — localStorage is the whole persistence layer `[major]`
- Practice logging writes `pitchTrainer_flowSessions` (cap 500) and
  `pitchTrainer_flowAttempts` (cap ~1500). Flag any write that drops the cap,
  or that writes inside an animation-frame / per-beat loop rather than
  buffering and flushing at session end.
- Every `localStorage` read must tolerate absent or corrupt values —
  `JSON.parse` on user-editable storage needs try/catch. Flag bare parses.
- Avatar images are stored as PNG data URLs. Flag any change that stores an
  un-downscaled image (quota risk).

### AUDIOLOOP — real-time path must stay allocation-light `[major]`
- `loop()`, `detectPitch()`, `stepPLO()` and `drawMetronome()` run per
  animation frame. Flag work added to these that allocates per frame,
  writes to `localStorage`, touches the DOM beyond the existing canvas/
  textContent updates, or does synchronous JSON work.

### PWA — offline and install integrity `[minor]`
- `sw.js` deliberately always re-fetches the HTML fresh and only caches icons/
  manifest. Flag any change that starts caching `index.html` (would ship stale
  app code to an installed PWA with no obvious way to clear it).

---

## Key files

- `index.html` — the entire app. **Your main focus.**
- `sw.js` / `manifest.json` — PWA wiring, rarely changes
- `dj-lab2.html` — Beat Hive prototype, covered by `tools/qc.js` (see above)
- `tools/qc.js`, `tools/qc-hook.sh` — the prototype's own validator
- `generate_icons.py` — one-off icon generation

---

## What NOT to flag

- The single-file architecture itself. No build step, no modules, no bundler,
  no npm — this is a deliberate constraint, not tech debt. Do not recommend
  splitting `index.html` or adding tooling.
- Code style, formatting, naming, missing docstrings.
- Hidden tabs (`play`, `dj`, `stats`, and the avatar gate). These are complete
  features deliberately hidden via `style="display:none"` / `class="hidden"`,
  documented in the commits that hid them. Not dead code, not a bug.
- Missing tests — there is no test suite and no plan for one. `node --check`
  on the extracted script block plus browser verification is the process.
- `tools/qc.js` check #6 (see the known-failing note above).
- Anything marked `# approved` or `// approved` in a comment.
