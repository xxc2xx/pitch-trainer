# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
- **The child (primary player):** about 4 years old, in a Yamaha Junior Music Course, reads little or no text. She plays songs and exercises, sings, and does note games.
- **The parent (set-up and coach):** picks the song, level and settings, adds songs from class (video, audio, sheet photo, MIDI), fixes notes, checks progress, then hands the device over. Sits nearby.
- Devices are mixed: iPad/tablet touch, Mac with a MIDI keyboard, and phone. Every screen must work on all three.

## Product Purpose
Help a young child learn to hear, read and play the tunes from her music class at home. Hear → See → Play → Integrate. Success: she can start a song and play it with no help once the parent has set it up, and comes back each day for the Today path.

## Positioning
Built around her actual curriculum: fixed-do solfège (Do = C), classroom Boomwhacker note colours, her book's exercises, and songs imported from her own class recordings with notes kept in sync with the original audio.

## Operating Context
- Parent sets up, child plays. Grown-up tools (add a song, fix notes, export, together/jam, level, keyboard range, sound, theme, progress, latency) are used before or after her turn, not during it.
- Child input: on-screen piano (multi-touch), computer keys, or a physical MIDI keyboard (not Safari/iPad); microphone for singing.
- Daily Today path: Echo → Notes → Write → Learn → Review → Prize.

## Capabilities and Constraints
- Static PWA, no build step, plain HTML/CSS/JS (`index.html` + classic-script modules). Shared engine modules are vendored by beat-hive and music-garden; keep their APIs.
- Levels Sprout / Bloom / Grow change presentation, not the engine. Sprout keys locked to C4–C5.
- Note colours come from `MusicCore.colorOf()` (classroom palette) and must not change.
- Keys at least 30px wide; piano must stay usable with many fingers at once.
- Repo is public: never the child's name, photo or likeness in code or assets.

## Brand Commitments
- Will become a Nueava product (noo·EH·fah). Public-facing copy uses "Nueava", never the legal name. Visual identity for this app is not decided yet.
- Solfège naming follows her course: Do/Re/Mi → "Do · C" → C by level.

## Evidence on Hand
- Built-in songs and her book's exercises (own titles, no lyrics).
- No testimonials, users or metrics yet. Do not invent any.

## Product Principles
1. The child's screen has one obvious next thing to do; she should never need to read to find it.
2. Grown-up tools exist but stay out of her way.
3. Follow her class: same note names, colours and order as the course.
4. Never score a Sprout down; mistakes get a gentle retry.
5. Works offline and on whatever device is at hand.

## Accessibility & Inclusion
Pre-reader: icons, colour and sound carry meaning, with text as backup. Large touch targets for small hands. Note colour is never the only cue (shapes/labels too).
