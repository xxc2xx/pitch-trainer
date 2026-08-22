# Plan — multitrack recording

Record a drum pass, then play it back while you record a melody pass over it,
then chords, then vocals. Mix the layers. Share one file.

Not built. This is the plan.

## Why it is not a UI change

Today there is **one** audio graph and **one** recorder:

```
pads / sequencer ──► ctx.destination ──► speakers
                          │
                          └─► (patched) recBeatBus ──► recTap ──► MediaRecorder
```

One pass, one blob, done. Multitrack needs three things that graph cannot do:

1. **Per-track buffers** — each pass must survive as its own audio, not be
   flattened into the mix immediately.
2. **A loop clock** — pass 2 must start exactly where pass 1 started, or the
   layers drift and it sounds broken within two bars.
3. **Per-track playback** — earlier passes must play *while* the next records,
   and must be mutable and re-recordable without touching the others.

## Proposed architecture

Move from `MediaRecorder` on the master to **per-track PCM capture**, then mix
and encode once at the end.

```
                     ┌──────────────┐
  live pads ────────►│  trackBus[n] │──► speakers
                     └──────┬───────┘
                            ▼
                     ScriptProcessor / AudioWorklet
                            │
                            ▼
                     Float32 buffer  (track n)

  playback: buffer 0..n-1 ──► BufferSource ──► speakers  (while track n records)

  MIX: sum all buffers ──► offline render ──► WAV blob ──► share
```

### Why raw PCM rather than more MediaRecorders

Running several `MediaRecorder`s produces several containers that must be
decoded and aligned afterwards, and Safari's duration metadata is already
unreliable (that is what caused the variable replay speed). Capturing
`Float32Array` per track gives sample-accurate alignment for free, and WAV
encoding is about 30 lines with no codec dependency.

Cost: WAV is roughly 10x the size of AAC. A 30-second 4-track mix is ~5MB.
Acceptable for share-sheet use; worth revisiting if it ever needs uploading.

### Loop-length locking

The first recorded pass **defines the loop length**, rounded to the nearest bar
at the current BPM:

```
loopSamples = round(bars * 4 * 60 / bpm * sampleRate)
```

Every later pass is written into a buffer of exactly that length and wraps.
This is the single most important detail — without it nothing lines up, and
the feature is worthless no matter how good the UI looks.

Changing BPM after track 1 must therefore be blocked, or trigger a "clear all
tracks?" prompt.

## UI

Second page of the bottom-right box, reached by the existing two-dot swipe.
The box widens on that page.

```
┌────────────────────────────────┐
│ ●  DRUMS    ▓▓▓▓▓▓▓▓░░  0:08   │   ● = armed / recorded
│ ●  MELODY   ▓▓▓▓▓▓░░░░  0:08   │   waveform = level, not shape
│ ○  CHORDS   ──────────  ────   │   ○ = empty
│ ○  VOCAL    ──────────  ────   │
│                                │
│   [ ● REC ]  [ ▶ MIX ]  [ ⌫ ]  │
└────────────────────────────────┘
```

- Tap a row to arm it. REC captures into that row while every other filled row
  plays back.
- MIX sums and previews. Share exports the mix.
- ⌫ clears the armed row only. Long-press clears all.

Four fixed tracks, named for the banks. Not user-creatable — a 4-year-old does
not need track management, and fixed slots remove a whole class of UI.

## Build order

Each step is independently testable and independently shippable.

1. **PCM capture of one track** — replace `MediaRecorder` with worklet capture
   plus WAV encode. Same single-track behaviour, new plumbing. Ship it. If the
   share file is right, the foundation is right.
2. **Loop-length lock** — derive from BPM, round to bars, display it.
3. **Playback while recording** — buffer 0 plays while buffer 1 records. This
   is where latency compensation gets decided (see risks).
4. **Track UI** — the four rows, arm/clear.
5. **Mix and export.**

Steps 1-2 are worth doing even if multitrack is abandoned: they fix the WAV
timing properly and make the recorder deterministic.

## Risks

**Latency compensation.** What you hear during pass 2 is delayed by output
latency, so you play late, so the recording lands late. Web Audio exposes
`AudioContext.outputLatency` — but Safari's value is unreliable. Likely needs a
fixed offset tuned by ear on the actual device, which means it cannot be
verified without you testing it.

**`ScriptProcessor` is deprecated.** Still universally supported, and
`AudioWorklet` needs a separate module file — which conflicts with the
single-file architecture. Recommend `ScriptProcessor` and accept the warning;
revisit only if it actually breaks.

**Memory.** Four tracks x 30s x 48kHz x Float32 = ~23MB. Fine on a phone, but
cap the loop length (8 bars) rather than letting it grow unbounded.

**It touches the recording path just stabilised.** The mic chain, the ducked
beat bus and the timeslice fix all live in the code this would replace. Step 1
must reproduce the current behaviour exactly before anything else starts.

## Estimate

Steps 1-2: half a session. Steps 3-5: a full session, most of it on latency.

## Recommendation

Do step 1 regardless — it fixes recording determinism and is a strict
improvement on today. Hold steps 3-5 until GroovyG has used the current build
and asked, in her own way, to play over herself.
