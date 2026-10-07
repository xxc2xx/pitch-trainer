# pitch-trainer

Client-side ear-training + music-learning PWA. `index.html` plus a few
classic-script modules (below), no backend, no build step. Tone.js/
Web Audio for pitch and beat detection. `sw.js` + `manifest.json` for PWA
install; service worker always re-fetches the HTML fresh, only caches
icons.

## Music ecosystem modules (added 2026-10-05)

Hear → See → Play → Integrate, built for a 4-year-old first (plan:
`~/.claude/plans/bubbly-rolling-milner.md`). Each is a classic `<script src>`
that sets a global, loaded before the inline script:

- `music-core.js` → `MusicCore`: Boomwhackers palette (C red … B pink),
  Figurenotes octave shapes, `LEVELS` (sprout/bloom/grow — one engine,
  three presentations), the **Take** shape (`notes:[{m,t,d,v}]`, times in
  BEATS), token interop with the old `"F4:1 R:1"` format, 6 built-in songs,
  IndexedDB store `music-eco` (shared with beat-hive: same origin).
- `piano.js` → `PianoV2`: generated keys over any MIDI range, minimap
  slider, zoom, two-row, multi-touch + glissando via Pointer Events.
- `songs.js` → `Songs`: Songs tab — shelf, colour lane (Sprout) / colour
  staff (Bloom/Grow); 👂 Listen and 🎵 Play along scroll on the audio clock
  (per-level timing windows, Sprout never scored down), 👆 Step by step
  (wait mode), 🎤 Sing it, stickers. Computer keys (G=C4…) work in Keys and
  Songs through `kb.press/release`. Imported songs with an original
  recording use it as the clock (`media.currentTime` → `MC.secToBeat`):
  ▶ Watch/👂 Listen plays her video/MP3 with notes in sync, speed 50–100 %
  (`preservesPitch`), 🔁 A–B loop, tap the strip to seek. A refused
  `play()` resets to step mode ("▶ Tap again") rather than a dead Stop.
- `sound.js` → `Sound`: instrument voices. Sampled via smplr (lazy from
  jsDelivr): Steinway grand (ONE velocity layer, ~5.8 MB — all five are
  ~20 MB; velocities are clamped into it or notes go silent), CP80 e-piano,
  GM soundfonts for guitar/bass/strings. Synth fallback until loaded or
  offline. `noteOn`/`noteOff` = press-and-hold sustain; `schedule`/`cancel`
  by tag for Songs. Safari gets .m4a (smplr skips ogg there).
- `midi.js` → `Midi`: her physical keyboard via Web MIDI (Chrome/Edge/
  Firefox — NOT Safari/iPad). Notes route through `kb.press/release`, so a
  MIDI key = a tap (sound, song, recorder). Sustain pedal, velocity-0
  note-off, drum channel ignored, range learned (`musicEco_kbRange`).
- `songfile.js` → `SongFile`: exact imports — MIDI (own SMF reader, melody
  track picked by name or highest busy track) and uncompressed MusicXML
  (voice 1, ties, chords skipped). `writeMidi` for tests/export.
- `addsong.js` → `AddSong`: ➕ Add a song — video/audio file, capture a
  Chrome tab's audio (`getDisplayMedia`, desktop Chrome), MIDI/MusicXML,
  sing it. Audio sources keep the original blob + `sync.offsetSec` for the
  synced player; tempo from `MC.estimateTempo` (onset grid fit).
- `hear.js` → `Hear`: live sing → Take (segmentation, key-snap, octave
  normalise); offline basic-pitch (Spotify, TF.js) loaded lazily from
  jsDelivr for audio files.

**beat-hive carries vendored copies of `music-core.js` and `hear.js`.**
Edit here, then `tools/sync-core.sh`; beat-hive's `tools/qc.js` fails on
drift. `node tools/core-test.mjs` is the gate for music-core.

Keys are 30px minimum; Sprout locks to C4–C5 (the classroom bell set).
Chrome only treats touch *pointerup* as a user gesture, so the piano resumes
its AudioContext on both edges (`ensureKbCtx`).

## Modes (tabs)

`listen` (real-time pitch feedback, plus ⏺ Sing a song / 📁 From audio →
Take), `songs` (follow-along), `keys` (Piano v2 free play, ⏺ records a Take), `flow` (beat/rhythm practice — has real
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
  and on each module
  before considering a change done — no test suite exists, this is the
  cheap first gate. See commit history from 2026-08-17 for the pattern
  (extract script, `node --check`, then real browser verification via
  claude-in-chrome for anything DOM/canvas/localStorage-dependent).
