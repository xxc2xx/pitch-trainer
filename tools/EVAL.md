# Beat Hive — bug log and eval

A record of what broke, why, and what now catches it. Written because several
of these reached the user's phone when a cheap check would have caught them
first, and because the same *kinds* of mistake kept recurring.

## Scoreboard

| # | Bug | Rounds to find | Root cause class | Caught now by |
|---|---|---|---|---|
| 1 | Dial CSS vanished | 1 | Positional edit deleted code | CSS-rule presence check |
| 2 | `discBtn` used before declaration | 1 | Temporal dead zone | Stub-DOM execution |
| 3 | Whole app landed on the piano page | 1 | Throw aborts the whole `<script>` | Execution + script isolation |
| 4 | `recBtn` null | 1 | `getElementById` on a detached node | Stub models DOM connectivity |
| 5 | Pads fell back to red | 1 | Original `switchDjBank` deletes `--pc` | Pad-colour integrity check |
| 6 | Pad grid overflowed right | 1 | `aspect-ratio` vs `grid-template-rows` | — (visual) |
| 7 | Dial label sat below the band | 1 | Padding not folded into band offset | qa-validator agent |
| 8 | `settle()` fired twice | 1 | Own `scrollTop` write re-entered it | qa-validator agent |
| 9 | Dancer 2 never appeared | 1 | `seed()` never called `onPick` | Roster-derived defaults check |
| 10 | **Mic silent** | **4** | **Four different causes, stacked** | On-screen diagnostic |
| 11 | Pads/piano silent on load | 1 | Context only resumed via the mic path | Resume on any touch, capture phase |
| 12 | Swipe hijacked pad taps and piano notes | 1 | Gesture is inherently ambiguous on a button grid | Removed; dot strip only |
| 13 | Replay speed random (fast/slow) | 1 | No `MediaRecorder` timeslice; bad Safari duration metadata | 250ms timeslice |
| 14 | Dial read as a static label | 1 | Neighbours faded to near-0 opacity | Min opacity raised; tap-to-advance added |
| 15 | Chevron CSS rendered nothing | 1 | Rule overwrote the fade-mask pseudo-elements it needed | Caret moved into caption text |
| 16 | Captions unreadably small | 1 | Press Start 2P too wide at roller-text size | Switched face for captions only |
| 17 | Recorded beat quieter than intended | 1 | Duck added without being asked for | Removed; beat records at 1.0 |
| 18 | **Mic open drops live playback** | **3** | **iOS voice-processing route, not a level** | No full fix on speaker — opt-in toggle |
| 19 | Silence persists after replay, needs reload | 1 | Master bus cached against a context Safari parked as `interrupted` | Bus rebuilds; `statechange` auto-resume |
| 20 | Volume burst right after mic closes | 1 | 3x compensation held across a routing change that had already reverted | Compensation dropped — proven useless earlier, left in anyway |
| 21 | Doubled snare in recordings | 1 | Mic re-recording the beat off the speaker (no echo cancellation) | Cancellation re-enabled — traded back against #18 |
| 22 | Handling noise / hum in recordings | 1 | No high-pass before the compressor amplified everything | 95Hz high-pass added to the mic chain |
| 23 | `ReferenceError` on REC after a rename | 1 | One call site missed in a variable rename | Caught pre-push by execution test |
| 24 | Pitch Trainer UI flashes before DJ mode applies | 1 | Original panels visible for a frame before `setMode('dj')` runs | Hidden until `.mode-dj` lands |

## #18 deserves its own writeup — it's not actually fixed

Bugs 18 and 21 are the **same OS decision, opposite failure mode**, and three
rounds were spent trying to have both before the right question got asked.

`echoCancellation:true` doesn't set a volume — it switches iOS onto its
voice-processing audio route (the one phone calls use), and duck-while-mic-
open is a property of *that route*, not a gain stage. Nothing downstream —
not 1.5x, not 3x, not a compressor — can undo a routing decision made above
the Web Audio graph. Two rounds were spent trying anyway (#18's first two
attempts) before accepting that gain was the wrong tool for a routing
problem.

`echoCancellation:false` avoids the route and the duck, but the mic now
physically hears the beat coming out of the speaker a few milliseconds
late — bug #21, the doubled snare.

**These are not independently fixable.** One boolean controls both. The
project's answer, once asked directly: default `false` — keep the live
volume constant, always, and accept the recording may carry some bleed of
the beat. That is a product decision (this app is for jamming together, not
archival audio), not an engineering one, and it only got made after guessing
at a "compromise" level for two rounds first. The lesson isn't in the code —
it's that *whose priority is this* should have been asked before *how do I
balance it*.

## The mic, in detail

This one cost the most and deserves the write-up. Four separate faults, each
masking the next:

1. **Node not retained.** `ctx.createMediaStreamSource(s).connect(tap)` created
   inline — no strong reference, garbage-collected, silently stops producing.
2. **Cross-context connect.** The source was built when the mic button was
   tapped, but `djAudioCtx()` recreates the context if it was ever closed.
   Connecting across two contexts throws `InvalidAccessError`.
3. **Insecure origin.** On `http://192.168.x.x`, `navigator.mediaDevices` is
   *undefined*. No audio-graph fix could ever have mattered.
4. **Suspended context.** Granted, live track, meter reading flat zero — the
   AudioContext was still suspended because the mic was enabled before Play.

**The actual lesson is not about Web Audio.** Faults 1 and 2 were fixed blind,
on theory, and neither was the live problem. What ended it was spending two
minutes adding an on-screen readout — secure-context, API presence, track
state, live peak, context state. One screenshot then identified fault 3, and
the next identified fault 4, immediately and unambiguously.

> When you cannot see the failing environment, instrument it. Do not theorise
> at it. Every round spent guessing costs a deploy cycle and the user's
> patience; a diagnostic costs minutes and pays out on the first screenshot.

## Recurring failure patterns

**Deletion is invisible to delta checks.** Bugs 1 and the `#rsBottom` CSS loss
both came from editing by string position (`s[:start] + new + s[end:]`) or a
greedy regex, silently removing code between the anchors. Early QC only
verified that new things were *present* — never that old things still were.
The gate now validates the whole rendered state.

**Parsing is not executing.** Bugs 2, 3 and 4 were all syntactically perfect.
`new Function(src)` proves nothing about TDZ, null dereferences, or ordering.
`tools/exec-check.js` runs the script against a stub DOM, and that stub
deliberately models connectivity: `getElementById` returns `null` for elements
created but never inserted, which is exactly where bug 4 hid.

**A safety net in the same `<script>` is not a safety net.** Bug 3: the
`setMode('dj')` fallback sat outside the IIFE but inside the same block. An
uncaught throw aborts the entire block, so it never ran. It needs its own
`<script>` tag — each block fails independently.

**Assertions rot.** The QC hardcoded `who2='girl'`, so an intentional default
change registered as a failure. Rewritten to derive the expected dial index
from the roster, it now validates the real invariant (dial seed = roster index
+ 1, accounting for the "none" entry) instead of a specific name.

## Pattern added this round: confident wrong explanations

Bug #18's proportional-duck theory ("iOS ducks harder the louder you talk")
was stated as fact in conversation before it was corrected. It was a
plausible-sounding mechanism pattern-matched from general AEC behaviour, not
something confirmed for this platform — no console access exists to this
user's phone, so nothing here can actually be verified against device logs.
Corrected when challenged, but should have been hedged the first time:
*"most likely explanation, unverifiable from here"* rather than stated flat.

## Bugs inherited from the original app

Two were pre-existing in `pitch-trainer/index.html`, not introduced here:

- **`switchDjBank()` calls `removeProperty('--pc')`**, permanently deleting the
  inline pad colours. Leaving DRUMS once turns all 16 pads the CSS-default red.
  Still present upstream.
- **iOS fires synthetic mouse events after touch**, so a desktop mouse fallback
  double-fired the bank switch on every swipe.

## What "recording and evaluating bugs" actually means here

There is no automated bug tracker. Two things happen, and only one is
automatic:

1. **`node tools/qc.js` runs before every push** — 15 structural/execution
   checks, real code, fails the build. This is the only part that isn't me
   remembering to do something.
2. **This file is written by hand, from conversation, when asked.** It went
   19 entries stale between the sprite-bug wave and this update because
   nobody asked in between. That gap is the honest answer to "how do you
   make sure this stays current" — it doesn't, unless it's kept up each
   session rather than in a catch-up pass like this one.

The useful part isn't the table. It's asking, after every fix: *does this
generalize into a check, or is it a one-off that needs a written-down
reason it can't be checked?* Bugs 18/20's answer was the latter — no CSS
rule or execution test catches "we chose the wrong tradeoff," only a
product decision does.

## What the gate runs

`node tools/qc.js` — 15 checks, exit 1 on failure:

- every `<script>` block parses (not just the last)
- every CSS rule the JS depends on exists
- every id the JS creates is styled
- no orphan layout CSS for removed elements
- all sprites 16x16 and within palette range
- no two elements collide on a layout slot (declared exceptions aside)
- pad colours survive a bank switch
- swipe is touch-only
- defaults match the roster
- **the script executes against a stub DOM without throwing**

It has since caught: two stale `order` rules, a regex that ate `#rsBottom`'s
CSS, an unstyled `rsPianoRange`, and its own rotted assertion.
