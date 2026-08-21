# pitch-trainer

Client-side ear-training PWA. Single file (`index.html`, ~3,700 lines —
HTML/CSS/JS in one `<script>` block), no backend, no build step. Tone.js/
Web Audio for pitch and beat detection. `sw.js` + `manifest.json` for PWA
install; service worker always re-fetches the HTML fresh, only caches
icons.

## Modes (tabs)

`listen` (real-time pitch feedback, no target to match — see note below),
`keys` (free-play synth), `flow` (beat/rhythm practice — has real
attempt+outcome data), `stats` (practice history dashboard), `play`
(sheet-music photo → playback via Claude Vision or an OMR server), `dj`
(pads/scratch/sequencer).

## Practice logging (added 2026-08-17)

Ported from the shadow/eval/adjudicate architecture built for the
busy-brain QC gate the same week (`~/busy-brain/claude-config/
ARCHITECTURE.md` is the reference). **Flow mode only** — `listen` shows
deviation from the *nearest* note, not an *intended* one, so there's no
real correct/incorrect signal there yet. Adding a target-matching quiz to
Listen mode is a legitimate future feature; don't retrofit fake scoring
onto it in the meantime.

localStorage keys:
- `pitchTrainer_flowSessions` — one row per practice session (start→stop),
  capped at 500. The durable trend source; the Stats tab reads this.
- `pitchTrainer_flowAttempts` — ring buffer of individual beats, capped at
  ~1500. Raw detail, not currently surfaced in the UI beyond aggregation.

Outcome classification (`classifyBeatOutcome`, `qc_log_writer.py`-shaped —
see the function itself) uses fraction-of-beat-period thresholds, not
fixed ms, so it stays meaningful across tempos. Three buckets —
`HIT_TIGHT`/`HIT_LOOSE`/`MISS` — reusing the app's own existing
green/gold/red accuracy language rather than new terminology.

Session-grain persistence, not per-beat writes (buffer in memory, flush at
`stop()` and on a `visibilitychange` safety net — iOS doesn't reliably
fire `beforeunload`).

## Avatar onboarding (added 2026-08-17)

First-load gate (`#avatarGate`) — upload/take a photo, pixelate client-side
(canvas downscale + `imageSmoothingEnabled=false` upscale, no library),
store as a ~240px PNG data URL. `pitchTrainer_onboarded` gates whether the
gate shows; `pitchTrainer_avatar` holds the image. Header badge
(`#avatarBadge`) reopens the gate for redo.

## Rules

- Run `python -m py_compile <file>` after any Python edit (n/a here — no
  Python in this repo, this rule is inherited convention).
- No backend, no npm/build step — keep it that way. Any new feature needing
  server-side logic is a bigger architectural decision, not a quick add.
- Verify JS changes with `node --check` on the extracted `<script>` block
  before considering a change done — no test suite exists, this is the
  cheap first gate. See commit history from 2026-08-17 for the pattern
  (extract script, `node --check`, then real browser verification via
  claude-in-chrome for anything DOM/canvas/localStorage-dependent).
