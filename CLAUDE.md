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
- ✨ Better notes (Song page, songs with a recording): `Hear.analyzeRemote`
  → user's HF Space `~/song-analyzer` (Demucs → melody, beats, chords, key;
  Gradio upload → call → SSE, same protocol as OMR). Address stored in
  `musicEco_analyzerUrl`; `MC.songFromAnalysis` maps seconds → beats on the
  returned beat map and adds `parts.chords` (shown above the notes).
- `studio.js` → `Studio`: ✏️ Fix notes — piano roll over the original's
  loudness envelope; tap a note then press the right key (screen or MIDI)
  to fix it by ear; nudge/length/split/delete, double-tap adds, undo,
  practice part (`section`), 🪄 Easy (drop slivers, merge splits, fit to
  her learned range). Starter songs save as "(my version)" copies. Pointer
  maths use clientX − rect (offsetX proved unreliable).
- 👨‍👧 Together (Song page): MIDI = her (song, scored); screen/computer keys
  = Dad (`Sound.noteOnAs('parent')`, e-piano, never scored). Dad's part =
  song's `parts.chords` or `MC.autoChords` (I/IV/V/vi per bar); current
  chord's tones outlined (`kb.setDad`), keyboard widens to C3–C6.
- 📄 Export (Song page): `SongFile.writeMusicXML` (bars, ties across
  barlines, rests, key/time/tempo, chord symbols; validated against the
  W3C MusicXML 3.1 XSD) and `writeMidi(song,{chords:true})` (melody +
  chords tracks). Print from MuseScore. Round-trip tests in core-test.
- `sw.js`: HTML/JS revalidated every load (`cache:'no-cache'`; navigations
  refetched by URL) — Pages' 10-min HTTP cache served stale modules in
  testing. Cache name prefix `pt-`; only own caches are cleaned (Beat Hive
  shares the origin, prefix `bh-`).
- **Curriculum = her Yamaha Junior Music Course: FIXED do (do = C).** Echo,
  cards and writing all name notes Do/Re/Mi (🌱) → "Do · C" (🌸) → C (🌳).
- `echo.js` → `Echo`: 🎤 hear a tune → sing it back (judged by intervals,
  any octave) → find it on the keyboard. Stages follow Yamaha: do-re →
  do-re-mi → …fa → C position → la → high/low do → all seven. One mic per
  session, opened inside the tap (iOS). State: `MC.log` item `echo` (`v:2`).
- `notes.js` → `Notes` (🧠 Notes tab; a 2nd instance runs Today's steps in
  the Songs view): 🃏 key cards, 🔢 low/middle/high, 🎼 G clef (F clef
  unlocks via `Notes.fUnlocked`), ✏️ write (put → trace → write by card box;
  freehand head/stem analysis in `analyzeWrite`). Leitner boxes per card
  (`card:<game>:<m>`, ≤ one box up per day), decks unlock at ≥ 85 %.
- `today.js` → `Today`: daily path Echo → Notes → Write → Learn (2-bar
  phrase: step-by-step then play along) → Review (spaced repetition via
  `MC.srsNext`) → Prize. Song state `song:<id>`; progress in
  `localStorage.musicEco_today`.
- `progress.js` → `Progress`: parent page in the (hidden) stats view, opened
  by HOLDING ⚙︎ on the piano bar 1.5 s. Weekly summary text, latency
  calibration (`musicEco_latencyMs`, used by Play-along judging).
- Practice log = IndexedDB `MusicCore.ns('music-learn')` (music-core 1.2.0,
  see "Learning store" below). `MC.log` keeps its old calls on top of it.
  Never bump `music-eco` / `music-eco-log`: old staging builds still open
  them. Play along stores per-note `dtMs`/`vel`.
- `hear.js` → `Hear`: live sing → Take (segmentation, key-snap, octave
  normalise); offline basic-pitch (Spotify, TF.js) loaded lazily from
  jsDelivr for audio files. Live pitch = `Hear.mpm` (McLeod NSDF; frames
  under clarity 0.8 count as silence) → `Hear.pitchTracker` (5-frame
  median, octave-slip fold, note hysteresis ±0.7 semitone / 3 frames) so
  the 🎤 Listen note doesn't flicker on a wobbly child's voice.
- Computer keys (Keys/Songs): ⇪ A–' ⏎ white, Q W–] black (Caps Lock = one event per press on Mac → a 350 ms tap); mapped by `e.code` (works with a Chinese
  input source / non-US layout). G = middle visible white key; the map
  follows user slides/zoom only — `onView(c,{auto})` auto-scrolls (song
  target, her MIDI key, Listen) leave the letters where they are.

**beat-hive carries vendored copies of `music-core.js` and `hear.js`.**
Edit here, then `tools/sync-core.sh`; beat-hive's `tools/qc.js` fails on
drift. `node tools/core-test.mjs` is the gate for music-core.

Keys are 30px minimum; Sprout locks to C4–C5 (the classroom bell set).
Chrome only treats touch *pointerup* as a user gesture, so the piano resumes
its AudioContext on both edges (`ensureKbCtx`).

## Shared-module governance (2026-10-24)

pitch-trainer is the source of truth for the engine modules other apps vendor:
`music-core.js`, `hear.js`, `midi.js` (beat-hive, music-garden), `sound.js`
(music-garden), `echo.js`, `notes.js` (music-garden, from PR3).

- Each starts with `/* @shared <name> <semver> */` and exports `VERSION`.
  major = removed/renamed export or changed return shape, minor = additive,
  patch = fix. Bump header + `VERSION` together, then
  `node tools/shared.mjs manifest` (rewrites `shared-manifest.json`, the
  API read by running each module in a stub window).
- `node tools/shared.mjs check` — fails if the API change doesn't match the
  bump (or code changed with no bump).
- `tools/consumers-test.sh` — runs every consumer's own gate against the
  candidate modules in a throwaway copy. Must pass before pushing a shared
  change.
- `tools/sync-core.sh [dir…] [--major] [--to <commit>]` — copies modules +
  `tools/shared.mjs` into consumers and writes their `vendor.lock.json`. A
  major bump is refused without `--major`; `--to` rolls a consumer back.
- `node tools/governance-test.mjs` — failure injection for all of the above.

## Environment isolation (2026-10-24)

Live, staging and localhost share one origin. `MusicCore.env()` is `''`
(live), `stg` (`/staging/`), `dev` (localhost) or `test` (`?env=test`);
`MusicCore.ns(name)` scopes a storage name to it, `adoptKey(name)` copies an
old un-scoped value once (never deletes). The four keys live reads
(`pitchTrainer_flowSessions/flowAttempts/onboarded/avatar`) go through it,
so staging no longer writes into live Beat Stats. Since PR3 the IndexedDB
stores are env-scoped too (`music-eco@stg`, `music-learn@stg`, …).

## Learning store (music-core 1.2.x, 2026-10-25)

`MusicCore.learn()` = one env-scoped IDB `music-learn<ns>` with stores
`sessions` (idx day, kind), `attempts` (idx sessionId, day, skill), `items`,
`meta`. Contracts in music-garden `docs/plan/00-overview.md` D2.
- `begin(f)` → handle `{attempt, pause, resume, end(status, summary, items)}`;
  attempt ids are `<sessionId>.<seq>`, every write is a `put` (retries are
  idempotent); `end` applies derived items once (`applied` flag).
- `recover()` (run by `MusicCore.ready()`) marks other pages' open sessions
  `interrupted`; `export()` / `import(j)` (import never overwrites an item).
- Storage failures never throw into the app: `learn().health` +
  `MusicCore.onStorageError(fn)`. Invalid records are dropped and counted.
- Adapters: `idbAdapter` (real) / `memAdapter(stores, faults)` (tests).
  Key ranges may be open-ended (`_rangeOf`; real IDB throws on
  `bound(undefined)` — found only in Chrome, keep the core-test).
- Staging migration (in `ready()`, env `stg` only): copy-only from
  `music-eco-log` and `music-eco` into the `@stg` stores; markers
  `migrated_log_v1` / `migrated_content_v1` in the new `meta`, set with the
  last write, so a failed copy retries without duplicates. Legacy stores are
  never written: rolling back to an old staging build still works (drilled
  in Chrome 2026-10-25).

## Music Garden moved out (2026-10-24)

The kid-facing Music Garden now lives in its own repo, `~/music-garden`
(github.com/xxc2xx/music-garden). It vendors engine modules from here (see governance above).

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
