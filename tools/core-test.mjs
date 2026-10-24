// node tools/core-test.mjs — cheap gate for music-core.js (no DOM, no IDB)
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const C = require('../music-core.js');
let fail = 0;
const ok = (cond, msg) => { if(!cond){ fail++; console.error('FAIL', msg); } else console.log('ok  ', msg); };

ok(C.PALETTE.length === 12 && new Set(C.PALETTE).size === 12, 'palette: 12 distinct colours');
ok(C.midiName(60) === 'C4' && C.midiOf('C', 4) === 60 && C.midiOf('As', 3) === 58, 'midi helpers');
ok(Math.abs(C.midiToFreq(69) - 440) < 1e-9, 'A4 = 440');
ok(C.shapeOf(59) === 'square' && C.shapeOf(60) === 'circle' && C.shapeOf(72) === 'triangle', 'octave shapes');

const tk = C.fromTokens('C4:1 R:0.5 Eb4:0.5 G4:2');
ok(tk.notes.length === 3 && tk.notes[1].m === 63 && tk.notes[1].t === 1.5 && tk.notes[2].t === 2, 'parseTokens: rests advance time, flats');
ok(C.toTokens(tk) === 'C4:1 R:0.5 D#4:0.5 G4:2', 'toTokens round-trip: ' + C.toTokens(tk));
ok(C.parseTokens(C.toTokens(tk)).every((n, i) => n.m === tk.notes[i].m && n.t === tk.notes[i].t), 'tokens → take → tokens stable');

const q = C.quantize([{ m:60, t:0.13, d:0.4 }, { m:62, t:0.9, d:0.05 }], 0.25);
ok(q[0].t === 0.25 && q[0].d === 0.5 && q[1].t === 1 && q[1].d === 0.25, 'quantize to 16ths, min one step');
ok(C.skyline([{ m:60, t:0, d:1 }, { m:64, t:0, d:1 }, { m:62, t:1, d:1 }]).map(n => n.m).join() === '64,62', 'skyline keeps top voice');

const songs = C.builtinTakes();
ok(songs.length === 6, '6 built-in songs');
songs.forEach(s => ok(s.notes.length > 5 && s.notes.every(n => n.m >= 60 && n.m <= 72), `song "${s.title}" parses, stays in C4–C5 (Sprout range)`));
ok(['sprout','bloom','grow'].every(k => C.LEVELS[k].range[0] < C.LEVELS[k].range[1]), 'levels defined');

// ── Song sync ─────────────────────────────────────────────────────────
const song = C.makeTake({ bpm: 120, notes: [], sync: { offsetSec: 1.5 } });
ok(Math.abs(C.beatToSec(song, 4) - 3.5) < 1e-9 && Math.abs(C.secToBeat(song, 3.5) - 4) < 1e-9, 'beat↔sec, constant tempo + offset');
const drift = C.makeTake({ bpm: 100, notes: [], sync: { beatTimes: [0.5, 1.1, 1.6, 2.2, 2.9] } });
ok([0, 0.5, 1.7, 3.25, 4].every(b => Math.abs(C.secToBeat(drift, C.beatToSec(drift, b)) - b) < 1e-9), 'beat↔sec round-trip through a drifting beat map');
ok(C.makeTake({ sync: { offsetSec: 2 }, tag: 'class' }).sync.offsetSec === 2, 'Song fields survive makeTake');
const onsets = []; for(let i = 0; i < 24; i++) onsets.push(0.37 + i * 60 / 96 * (i % 3 === 2 ? 1 : 1));
ok(Math.abs(C.estimateTempo(onsets) - 96) <= 1, 'estimateTempo finds 96 BPM from onsets: ' + C.estimateTempo(onsets));

// analyzer JSON (seconds) → song on its beat map
const res = { bpm: 100, key: 'C', beatTimes: Array.from({ length: 40 }, (_, i) => 0.1 + i * 0.6),
  melody: [{ m: 60, on: 1.31, off: 1.85 }, { m: 67, on: 2.49, off: 3.0 }], chords: [{ t: 1.3, d: 2.4, label: 'C', root: 0, minor: false }] };
const an = C.songFromAnalysis(C.makeTake({ title: 'x', sync: { audioId: 'a1', kind: 'video' } }), res);
ok(an.notes[0].t === 2 && an.notes[1].t === 4 && an.parts.chords[0].t === 2 && an.parts.chords[0].d === 4 && an.sync.audioId === 'a1' && an.sync.beatTimes.length === 40,
   'songFromAnalysis: seconds → beats on the beat map, chords in beats, sync kept');
ok(Math.abs(C.beatToSec(an, an.notes[0].t) - 1.3) < 1e-9, 'analyzed note plays back at its audio time');

// ── Song files ────────────────────────────────────────────────────────
const SF = require('../songfile.js');
const tw = C.builtinTakes().find(t => t.id === 'b_twinkle');
const mid = SF.parseMidi(SF.writeMidi(tw).buffer);
ok(mid.notes.length === tw.notes.length && mid.notes.every((n, i) => n.m === tw.notes[i].m && Math.abs(n.t - tw.notes[i].t) < 1e-6) && mid.bpm === tw.bpm,
   'MIDI write → parse round-trip (Twinkle, ' + mid.notes.length + ' notes, ' + mid.bpm + ' bpm)');
// two-track file: bass + melody → picks the melody
const bass = { ...C.makeTake({ bpm: 96, notes: tw.notes.map(n => ({ ...n, m: n.m - 24 })) }), trackName: 'Bass' };
const w1 = SF.writeMidi(tw), w2 = SF.writeMidi(bass);
const trk = b => b.slice(14);                                  // strip header, keep MTrk chunk
const two = new Uint8Array([...w1.slice(0, 10), 0, 2, ...w1.slice(12, 14), ...trk(w2), ...trk(w1)]);
ok(SF.parseMidi(two.buffer).notes[0].m === tw.notes[0].m, 'multi-track MIDI picks the melody, not the bass');

// Dad's part: auto chords for Twinkle in C → C | C F C | F C G C …
const tch = C.autoChords(tw);
ok(tch.map(c => c.label).slice(0, 6).join(' ') === 'C F C G C F' || tch[0].label === 'C', 'autoChords Twinkle starts on C: ' + tch.map(c => c.label).join(' '));
ok(tch.every(c => c.ms.length === 3 && c.ms.every(m => m >= 48 && m < 72)), 'chord tones voiced for the left hand (C3–B4)');
ok(C.chordAt(tch, tch[1].t + 0.5) === tch[1] && C.chordAt([], 3) === null, 'chordAt finds the chord sounding at a beat');


let DOMParser = null;
try{ ({ DOMParser } = require('@xmldom/xmldom')); }catch(e){
  try{ ({ DOMParser } = require(process.env.XMLDOM_PATH || '@xmldom/xmldom')); }catch(_){}
}
const xml = `<?xml version="1.0"?><score-partwise version="3.1"><work><work-title>Test Tune</work-title></work>
<part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list>
<part id="P1"><measure number="1"><attributes><divisions>2</divisions><key><fifths>1</fifths></key><time><beats>3</beats><beat-type>4</beat-type></time></attributes>
<direction><sound tempo="88"/></direction>
<note><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice></note>
<note><chord/><pitch><step>B</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice></note>
<note><rest/><duration>1</duration><voice>1</voice></note>
<note><pitch><step>F</step><alter>1</alter><octave>4</octave></pitch><duration>1</duration><voice>1</voice></note>
<note><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><tie type="start"/></note>
<backup><duration>6</duration></backup>
<note><pitch><step>C</step><octave>3</octave></pitch><duration>6</duration><voice>2</voice></note>
</measure><measure number="2">
<note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><tie type="stop"/></note>
</measure></part></score-partwise>`;
if(!DOMParser) console.log('skip MusicXML tests (npm i -g @xmldom/xmldom or set XMLDOM_PATH)');
const mx = DOMParser ? SF.parseMusicXML(new DOMParser().parseFromString(xml, 'application/xml')) : null;
if(mx) ok(mx.title === 'Test Tune' && mx.bpm === 88 && mx.key === 'G' && mx.timeSig[0] === 3, 'MusicXML header: title, tempo, key, time');
if(mx) ok(C.toTokens(mx) === 'G4:1 R:0.5 F#4:0.5 E4:3', 'MusicXML notes: chord skipped, rest, sharp, tie merged, voice 2 ignored → ' + C.toTokens(mx));

// ── Export: MusicXML / MIDI round-trips ───────────────────────────────
if(DOMParser){
  const rt = song => SF.parseMusicXML(new DOMParser().parseFromString(SF.writeMusicXML(song), 'application/xml'));
  for(const id of ['b_twinkle', 'b_row', 'b_bday', 'b_mary']){
    const sg = C.builtinTakes().find(t => t.id === id), back = rt(sg);
    ok(C.toTokens(back) === C.toTokens(sg), `MusicXML export round-trip: ${sg.title} (${sg.timeSig.join('/')}, key ${sg.key})`);
  }
  const tie = C.makeTake({ title: 'tie', bpm: 90, notes: [{ m: 60, t: 0, d: 1 }, { m: 64, t: 3, d: 2.5 }, { m: 67, t: 6, d: 0.5 }] });
  ok(C.toTokens(rt(tie)) === C.toTokens(tie), 'note across a barline exports as tied notes and reads back as one: ' + C.toTokens(rt(tie)));
  const withCh = { ...tw, parts: { chords: C.autoChords(tw) } };
  const xml = SF.writeMusicXML(withCh);
  ok((xml.match(/<harmony>/g) || []).length === withCh.parts.chords.length, 'chord symbols exported: ' + (xml.match(/<harmony>/g) || []).length);
  // a chord change in the middle of a held note keeps its time via <offset>
  const held = C.makeTake({ title: 'held', bpm: 90, notes: [{ m: 60, t: 0, d: 4 }], parts: { chords: [{ t: 0, d: 2, root: 0, minor: false, label: 'C' }, { t: 2, d: 2, root: 7, minor: false, label: 'G' }] } });
  const hx = SF.writeMusicXML(held);
  ok(/<root-step>G<\/root-step><\/root><kind>major<\/kind><offset>8<\/offset>/.test(hx) && (hx.match(/<harmony>/g) || []).length === 2, 'mid-note chord change exported with <offset> (beat 2 = 8 sixteenths)');
}
const midCh = SF.parseMidi(SF.writeMidi({ ...tw, parts: { chords: C.autoChords(tw) } }, { chords: true }).buffer);
ok(C.toTokens(midCh) === C.toTokens(tw), 'MIDI export with a chords track still reads back the melody');
{ // same pitch re-struck before its note-off (layered/legato files): both notes kept
  const ev = [0x00,0x90,60,80, 0x81,0x70,0x90,60,80, 0x81,0x70,0x80,60,0, 0x83,0x60,0x80,60,0, 0x00,0xff,0x2f,0x00];
  const f = new Uint8Array([0x4d,0x54,0x68,0x64,0,0,0,6,0,0,0,1,0x01,0xe0, 0x4d,0x54,0x72,0x6b,0,0,0,ev.length, ...ev]);
  const ov = SF.parseMidi(f.buffer).notes;
  ok(ov.length === 2 && ov[0].t === 0 && ov[0].d === 1 && ov[1].t === 0.5 && ov[1].d === 1.5, 'MIDI import keeps overlapping same-pitch notes: ' + JSON.stringify(ov.map(n => [n.t, n.d])));
}

// ── Practice helpers ────────────────────────────────────────────────────
ok(C.dayKey(new Date(2026, 9, 5)) === '2026-10-05' && C.addDays('2026-10-31', 1) === '2026-11-01' && C.addDays('2026-03-01', -1) === '2026-02-28', 'dayKey / addDays across months');
ok(C.streak(['2026-10-18', '2026-10-19', '2026-10-20'], '2026-10-20') === 3, 'streak: 3 days ending today');
ok(C.streak(['2026-10-18', '2026-10-19'], '2026-10-20') === 2, 'streak: today not done yet still counts yesterday');
ok(C.streak(['2026-10-15', '2026-10-17', '2026-10-18'], '2026-10-20') === 0, 'streak: a missed day breaks it');
{
  let st = C.srsNext(null, 3, '2026-10-20');
  ok(st.intervalD === 1 && st.due === '2026-10-21', 'srs: first 3★ → tomorrow');
  st = C.srsNext(st, 3, '2026-10-21'); ok(st.intervalD === 3 && st.due === '2026-10-24', 'srs: second 3★ → 3 days');
  st = C.srsNext(st, 3, '2026-10-24'); ok(st.intervalD >= 7, 'srs: third 3★ → about a week (' + st.intervalD + ')');
  const iv = st.intervalD; st = C.srsNext(st, 2, '2026-11-01'); ok(st.intervalD >= iv && st.intervalD <= Math.ceil(iv * 1.2), 'srs: 2★ nudges the gap');
  st = C.srsNext(st, 1, '2026-11-10'); ok(st.intervalD === 1 && st.reps === 0 && st.lapses === 1, 'srs: 1★ starts over tomorrow');
}
{
  const ts = C.timingStats([{ dtMs: 50, vel: 60 }, { dtMs: 70, vel: 80 }, { dtMs: 60, vel: 70 }, { dtMs: null, vel: null }]);
  ok(ts.biasMs === 60 && ts.meanAbsMs === 60 && ts.onBeatPct === 75 && ts.evennessMs === 8 && ts.velMean === 70, 'timingStats: dragging 60 ms, 3 of 4 on the beat: ' + JSON.stringify(ts));
  ok(C.timingStats([{ dtMs: -40 }, { dtMs: -20 }]).biasMs === -30, 'timingStats: negative bias = rushing');
}

// ── Echo (echo.js): curriculum + singing judge ──────────────────────────
{
  const vm = require('vm'), fs = require('fs');
  const win = { MusicCore: C };
  vm.runInNewContext(fs.readFileSync(new URL('../echo.js', import.meta.url), 'utf8'), { window: win, document: undefined, performance, console });
  const E = win.Echo;
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let inSet = true, varied = true;
  E.STAGES.forEach((st, k) => { for(let j = 0; j < 40; j++){ const p = E.patterns(k, 2 + (j % 4), rnd); if(!p.every(x => st.deg.includes(x))) inSet = false; if(p.every(x => x === p[0])) varied = false; } });
  ok(inSet && varied, 'Echo.patterns: every stage stays in its notes, never one repeated note');
  ok(Array.from({ length: 30 }, () => E.patterns(0, 3, rnd)).every(p => p.every(x => x === 0 || x === 2)), 'Echo stage 1 (Yamaha) is only do and re — do-re-do, re-do-re');
  ok(E.STAGES[1].deg.join() === '0,2,4' && E.STAGES.findIndex(s => s.leaps) > 3, 'Echo: do-re-mi second, octaves after the C position');
  ok(Array.from({ length: 30 }, () => E.patterns(5, 4, rnd)).every(p => p.some(x => Math.abs(x) === 12)), 'Echo octave stage always jumps to high or low do');
  const pat = [7, 4, 7, 9];                                    // s m s l
  ok(E.matchSung(pat, [70, 67, 70, 72]).ok, 'matchSung: same tune sung 3 semitones higher is right');
  ok(E.matchSung(pat, [67, 65, 67, 69]).ok, 'matchSung: ±1 semitone wobble still counts');
  ok(E.matchSung(pat, [67, 64, 79, 69]).notes[2], 'matchSung: an octave slip is not a wrong note');
  const bad = E.matchSung(pat, [67, 69, 67, 69]);
  ok(!bad.ok && !bad.notes[1], 'matchSung: going up where the tune goes down is wrong');
  ok(!E.matchSung(pat, [67, 64]).ok, 'matchSung: too few notes is not a match');
  // live segmentation: G4 300 ms, gap 150 ms, E4 300 ms → 2 notes
  const seg = E.liveSeg(), got = [];
  let t = 0; const feed = (mf, ms) => { for(let k = 0; k < ms; k += 30){ const n = seg.push(mf, t); if(n) got.push(n.m); t += 30; } };
  feed(67.2, 300); feed(null, 150); feed(63.8, 300); feed(null, 150);
  ok(got.join() === '67,64', 'liveSeg: two sung notes found with their pitches: ' + got.join());
  const seg2 = E.liveSeg(), got2 = []; t = 0;
  const feed2 = (mf, ms) => { for(let k = 0; k < ms; k += 30){ const n = seg2.push(mf, t); if(n) got2.push(n.m); t += 30; } };
  feed2(67, 300); feed2(64, 300); const last = seg2.flush(); if(last) got2.push(last.m);
  ok(got2.join() === '67,64', 'liveSeg: a pitch change without a breath starts a new note');
  let st = null; for(let k = 0; k < 4; k++) st = E.adapt(st, true);
  ok(st.stage === 1 && st.streak === 0, 'adapt: 4 good echoes unlock the next stage');
  st = E.adapt(E.adapt(st, false), false);
  ok(st.stage === 1 && st.short === 1, 'adapt: 2 misses make the tunes shorter, never go back a stage');
}

// ── Today (today.js): daily plan ────────────────────────────────────────
{
  const vm = require('vm'), fs = require('fs');
  const win = { MusicCore: C };
  vm.runInNewContext(fs.readFileSync(new URL('../today.js', import.meta.url), 'utf8'), { window: win, performance, console, setTimeout });
  const T = win.Today, B = C.builtinTakes();
  const cls = C.makeTake({ id: 'cls1', title: 'Class song', tag: 'class', createdAt: 5, bpm: 90,
    notes: Array.from({ length: 16 }, (_, i) => ({ m: 60 + (i % 5), t: i, d: 1 })) });   // 16 beats = 4 bars
  let p = T.plan({ songs: [...B], items: {}, level: 'sprout', today: '2026-10-20' });
  const learn0 = p.steps.find(s => s.kind === 'learn');
  ok(p.steps[0].kind === 'echo' && p.steps[1].kind === 'notes' && learn0.songId === B[0].id && learn0.phrase === 0 && p.steps[p.steps.length - 1].kind === 'reward' && p.minutes === 5,
     'Today: fresh start = Echo + Notes cards + first starter song, phrase 1 + prize (5 min at 🌱): ' + p.steps.map(s => s.kind).join());
  ok(['keys', 'g'].includes(p.steps[1].game), 'Today 🌱: card game is key or staff cards (no octave cards on a C4–C5 keyboard)');
  const pb = T.plan({ songs: [...B], items: {}, level: 'bloom', today: '2026-10-21' });
  ok(pb.steps.some(s => s.kind === 'write' && s.n === 3), 'Today 🌸: a 3-note writing step every day');
  const games = new Set(['2026-10-20', '2026-10-21', '2026-10-22'].map(day => T.plan({ songs: [...B], items: {}, level: 'bloom', today: day }).steps[1].game));
  ok(games.size === 3, 'Today 🌸: the card game rotates day by day (' + [...games].join() + ')');
  p = T.plan({ songs: [...B, cls], items: {}, level: 'bloom', today: '2026-10-20' });
  ok(p.steps.find(s => s.kind === 'learn').songId === 'cls1' && p.steps[0].rounds === 4 && p.minutes === 10, 'Today: her class song is learnt before the starters');
  const ph = T.phrases(cls, 'sprout');
  ok(ph.length === 2 && ph[0].from === 0 && ph[0].to === 8 && ph[1].from === 8, 'Today: 4 bars → two 2-bar phrases');
  ok(T.phrases({ ...cls, section: { from: 4, to: 12 } }, 'sprout').every(x => x.from >= 4 && x.to <= 12), 'Today: a practice part set in ✏️ Fix limits the phrases');
  // learning progress
  let st = T.afterSong(null, { kind: 'learn', phrase: 0, phrases: 2 }, { mode: 'timed', stars: 2 }, '2026-10-20');
  ok(st.phrase === 1, 'Today: 2★ on a phrase → next phrase');
  ok(T.afterSong(st, { kind: 'learn', phrase: 1, phrases: 2 }, { mode: 'wait', stars: 3 }, '2026-10-20').phrase === 1, 'Today: step-by-step alone does not move on');
  st = { phrase: 2, phrases: 2, wins: 0 };
  st = T.afterSong(st, { kind: 'learn', whole: true, phrases: 2 }, { mode: 'timed', stars: 3 }, '2026-10-20');
  st = T.afterSong(st, { kind: 'learn', whole: true, phrases: 2 }, { mode: 'timed', stars: 3 }, '2026-10-21');
  ok(st.mastered && st.srs && st.srs.due === '2026-10-22', 'Today: whole song 3★ twice → mastered, review tomorrow');
  p = T.plan({ songs: [...B, cls], items: { 'song:cls1': st }, level: 'bloom', today: '2026-10-22' });
  ok(p.steps.some(s => s.kind === 'review' && s.songId === 'cls1') && p.steps.find(s => s.kind === 'learn').songId === B[0].id,
     'Today: a mastered song comes back for review when due; learning moves to the next song');
  ok(!T.plan({ songs: [cls], items: { 'song:cls1': st }, level: 'bloom', today: '2026-10-21' }).steps.some(s => s.kind === 'review'), 'Today: not due yet → no review');
  const st2 = T.afterSong(st, { kind: 'review' }, { mode: 'timed', stars: 3 }, '2026-10-22');
  ok(st2.srs.due > '2026-10-23', 'Today: a good review pushes the next one further out (' + st2.srs.due + ')');
}

// ── Notes (notes.js): cards + writing ───────────────────────────────────
{
  const vm = require('vm'), fs = require('fs');
  const win = { MusicCore: C };
  vm.runInNewContext(fs.readFileSync(new URL('../notes.js', import.meta.url), 'utf8'), { window: win, performance, console, setTimeout });
  const N = win.Notes;
  ok(C.staffStep(60).step === -2 && C.staffStep(67).step === 2 && C.staffStep(53).step - C.CLEF_SHIFT.F === 6 && C.staffStep(70, true).acc === '♭', 'staffStep: middle C on a ledger line, G on line 2, F3 on the F-clef 4th line, B♭ spelt flat');
  ok([-2, 0, 2, 4].map(C.stepToMidi).join() === '60,64,67,71', 'stepToMidi is the inverse for white keys');
  ok(N.nameOf(60, 'sprout') === 'Do' && N.nameOf(67, 'bloom') === 'Sol · G' && N.nameOf(69, 'grow') === 'A', 'names: Do → Sol · G → A by level (fixed do)');
  let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let good = true;
  for(let k = 0; k < 200; k++){ const a = [60, 62, 64, 65, 67, 69, 71, 72][k % 8]; const c = N.choices(a, N.ORDER.keys.slice(0, 8), rnd);
    if(c.length !== 3 || !c.includes(a) || new Set(c.map(m => m % 12)).size !== 3 || c.some(m => C.isBlack(m))) good = false; }
  ok(good, 'choices: always 3 different white-key names, one of them right');
  let card = N.box(null, true, '2026-10-20'); card = N.box(card, true, '2026-10-20');
  ok(card.box === 2, 'Leitner: right twice on the same day only moves up one box');
  card = N.box(card, true, '2026-10-21');
  ok(card.box === 3 && card.due === '2026-10-23', 'Leitner: right again next day → box 3, back in 2 days');
  ok(N.box(card, false, '2026-10-22').box === 1, 'Leitner: a miss goes back to box 1');
  let meta = null; for(let k = 0; k < 9; k++) meta = N.deckAfter(meta, true, 'keys');
  ok(meta.unlocked === 3, 'deck: not before 10 answers');
  meta = N.deckAfter(meta, true, 'keys'); ok(meta.unlocked === 4 && meta.newest === 65, 'deck: 10 right in a row unlocks Fa');
  let m2 = null; for(let k = 0; k < 12; k++) m2 = N.deckAfter(m2, k % 3 !== 0, 'keys'); ok(m2.unlocked === 3, 'deck: 67 % right does not unlock');
  ok(!N.fUnlocked({}) && N.fUnlocked({ 'deck:g': { unlocked: 5 }, 'card:g:60': { box: 3 }, 'card:g:67': { box: 4 } }), 'F clef unlocks once the G-clef landmarks are solid');
  const r = N.pickRound('keys', 8, { items: {}, today: '2026-10-20', range: [60, 72], rnd });
  ok(r.length === 8 && r.every(m => [60, 62, 64].includes(m)) && r.every((m, k) => !k || m !== r[k - 1]), 'round: 8 cards from do-re-mi, never twice in a row');
  const r2 = N.pickRound('keys', 4, { items: { 'card:keys:60': { box: 5, due: '2026-10-28' }, 'card:keys:62': { box: 1, due: '2026-10-20' } }, today: '2026-10-20', range: [60, 72], rnd });
  ok(r2[0] === 62, 'round: a due card in a low box comes first');
  // writing
  const geo = { LS: 30, base: 240 };
  const yOf = st => geo.base - st * geo.LS / 2;
  const circle = (cx, cy, rx, ry, a0 = 0, a1 = Math.PI * 2) => Array.from({ length: 40 }, (_, k) => { const a = a0 + (a1 - a0) * k / 39; return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) }; });
  const line = (x, y0, y1) => Array.from({ length: 20 }, (_, k) => ({ x, y: y0 + (y1 - y0) * k / 19 }));
  const head = circle(200, yOf(2), 20, 14);                               // a loop on the G line
  let w = N.scoreWrite([head, line(219, yOf(2), yOf(2) - 100)], geo, 2, 'bloom');
  ok(w.score === 100 && w.a.step === 2 && w.a.closed && w.a.stem.up && w.a.stem.side === 'right', 'write: G with a closed head and an up-stem on the right = 100');
  ok(N.scoreWrite([circle(200, yOf(3), 20, 14)], geo, 2, 'bloom').score === 35 + 15, 'write: one step too high, no stem = 50');
  ok(N.scoreWrite([circle(200, yOf(2), 20, 14, 0, Math.PI)], geo, 2, 'bloom').a.closed === false, 'write: an open arc is not a closed head');
  ok(N.scoreWrite([head], geo, 2, 'sprout').score === 100, 'write 🌱: only where the head sits counts');
  const dShape = circle(200, yOf(-2), 18, 14).concat(line(218, yOf(-2), yOf(-2) - 95));   // head + stem in one stroke
  const ws = N.analyzeWrite([dShape], geo);
  ok(ws.step === -2 && ws.stem && ws.stem.attached, 'write: head and stem in one stroke still finds middle C (' + ws.step + ')');
  const down = N.scoreWrite([circle(200, yOf(6), 20, 14), line(181, yOf(6), yOf(6) + 100)], geo, 6, 'grow');
  ok(down.score === 100 && !down.a.stem.up && down.a.stem.side === 'left', 'write: high note, stem down on the left = 100 at 🌳');
  const guide = N.noteGuide(geo, 2, 200);
  ok(N.traceScore(guide, guide.map(p => ({ x: p.x + 3, y: p.y - 2 })), 18) === 100 && N.traceScore(guide, [{ x: 20, y: 20 }], 18) === 0, 'trace: on the dots = 100, elsewhere = 0');
  const headOnly = N.traceScore(guide, guide.slice(0, 28), 18);
  ok(headOnly < 85, 'trace: the head without its stem is not 3 stars (' + headOnly + ')');
}

// ── Progress (progress.js): weekly summary for her teacher ──────────────
{
  const vm = require('vm'), fs = require('fs');
  const win = { MusicCore: C };
  const ctx = { window: win, performance, console, setTimeout };
  vm.runInNewContext(fs.readFileSync(new URL('../echo.js', import.meta.url), 'utf8'), ctx);
  vm.runInNewContext(fs.readFileSync(new URL('../progress.js', import.meta.url), 'utf8'), { ...ctx, Echo: win.Echo });
  const P = win.Progress;
  const sessions = [
    { day: '2026-10-10', kind: 'song', durMs: 120000, stats: { hit: 10, meanAbsMs: 90, biasMs: 10 } },
    { day: '2026-10-18', kind: 'echo', durMs: 90000 },
    { day: '2026-10-19', kind: 'song', durMs: 180000, stats: { hit: 12, meanAbsMs: 60, biasMs: -45 } },
    { day: '2026-10-20', kind: 'write', durMs: 60000, score: 80 },
    { day: '2026-10-20', kind: 'today', durMs: 400000 },
  ];
  const items = { 'song:hcb': { phrase: 1, phrases: 2 }, 'song:mary': { mastered: true, srs: { due: '2026-10-25' } },
    echo: { stage: 1, rounds: 10, good: 8 }, 'card:keys:60': { n: 5, ok: 5, box: 4 }, 'card:keys:62': { n: 4, ok: 2, box: 1 } };
  const txt = P.weekly({ sessions, items, titles: new Map([['hcb', 'Hot Cross Buns'], ['mary', 'Mary']]), today: '2026-10-20' });
  ok(/practised 3\/7 days, 6 min/.test(txt), 'weekly: days and minutes this week (today wrapper not double-counted)');
  ok(/Hot Cross Buns \(part 2\/2\)/.test(txt) && /Can play: Mary/.test(txt), 'weekly: learning + mastered songs by name');
  ok(/do–re–mi, 80% good/.test(txt), 'weekly: Echo stage + success');
  ok(/Keys 78% \(practise Re\)/.test(txt), 'weekly: card accuracy with the weak note named');
  ok(/Writing notes: 80\/100/.test(txt) && /avg 60 ms .*rushing.*\(was 90 ms\)/.test(txt), 'weekly: writing score + timing trend vs last week');
}

// ── Live pitch (hear.js): McLeod detector + steady-note tracker ──────────
{
  const vm = require('vm'), fs = require('fs');
  const win = { MusicCore: C };
  vm.runInNewContext(fs.readFileSync(new URL('../hear.js', import.meta.url), 'utf8'), { window: win, performance, console });
  const H = win.Hear, SR = 48000;
  // a child-like voice: fundamental + strong 2nd/3rd harmonics, light noise
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
  const voice = (f, n = 2048, noise = 0.02) => Float32Array.from({ length: n }, (_, i) => {
    const t = i / SR; return 0.3 * Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(4 * Math.PI * f * t) + 0.12 * Math.sin(6 * Math.PI * f * t) + noise * rnd();
  });
  const errs = [196, 262, 330, 440, 523, 698, 880].map(f => { const r = H.mpm(voice(f), SR); return r ? Math.abs(1200 * Math.log2(r.freq / f)) : 999; });
  ok(errs.every(e => e < 10), 'mpm: G3…A5 with harmonics within 10 cents: ' + errs.map(e => e.toFixed(1)).join(' '));
  ok(H.mpm(voice(330), SR).clarity > 0.9, 'mpm: a clean note is high clarity');
  const noise = Float32Array.from({ length: 2048 }, () => 0.2 * rnd());
  const nr = H.mpm(noise, SR);
  ok(!nr || nr.clarity < 0.8, 'mpm: noise is low clarity (' + (nr ? nr.clarity.toFixed(2) : 'null') + ')');
  ok(H.mpm(new Float32Array(2048), SR) === null, 'mpm: silence → null');

  // wobbly E4 (±45 cents vibrato) + an octave-slip frame + a dropout → stays E4
  const tr = H.pitchTracker(), f = m => 440 * Math.pow(2, (m - 69) / 12);
  const shown = [];
  for(let i = 0; i < 40; i++){
    let m = 64 + 0.45 * Math.sin(i / 2);
    let fr = f(m);
    if(i === 15) fr /= 2;            // detector slipped an octave
    if(i === 22) fr = null;          // one dropped frame
    const p = tr.push(fr); if(p) shown.push(p.note);
  }
  ok(shown.length >= 36 && shown.every(n => n === 64), 'tracker: wobbly E4 with an octave slip + a dropout shows only E4 (' + [...new Set(shown)].join() + ')');
  // a real move to G4 is followed within a few frames
  let moved = -1;
  for(let i = 0; i < 10; i++){ const p = tr.push(f(67)); if(p && p.note === 67 && moved < 0) moved = i; }
  ok(moved >= 0 && moved <= 4, 'tracker: real change E4→G4 shown after ' + moved + ' frames');
  for(let i = 0; i < 10; i++) tr.push(null);
  ok(tr.push(null) === null, 'tracker: long silence clears the note');
  const t0 = H.pitchTracker({ gap: 0 }); t0.push(f(60)); t0.push(f(60));
  ok(t0.push(null) === null, 'tracker gap 0: silence reported at once (recorder splits repeated notes)');
}

// ── Environment isolation (plan D1 / audit S0) ────────────────────────
{
  const mem = {}; globalThis.localStorage = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
  C._setEnv('');
  ok(C.ns('pitchTrainer_flowSessions') === 'pitchTrainer_flowSessions' && C.adoptKey('x') === 'x', 'prod: names unchanged');
  C._setEnv('stg');
  mem['pitchTrainer_onboarded'] = '1';
  const k = C.adoptKey('pitchTrainer_onboarded');
  ok(k === 'pitchTrainer_onboarded@stg' && mem[k] === '1' && mem['pitchTrainer_onboarded'] === '1', 'staging adopts the old value once, never deletes it');
  mem[k] = '0'; C.adoptKey('pitchTrainer_onboarded');
  ok(mem[k] === '0', 'adopt never overwrites the env copy');
  C._setEnv('test'); ok(C.ns('music-learn') === 'music-learn@test', 'test env name');
  C._setEnv(null); delete globalThis.localStorage;
  // the shipped page: no localStorage call may use a bare live key
  const html = (await import('fs')).readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const bare = [...html.matchAll(/localStorage\.(?:getItem|setItem|removeItem)\('(pitchTrainer_[A-Za-z]+)'/g)].map(m => m[1]);
  ok(!bare.length, 'index.html: every pitchTrainer_* key goes through MusicCore.ns' + (bare.length ? ' — bare: ' + bare.join(', ') : ''));
  ok(/FLOW_ATTEMPTS_KEY=MC\.adoptKey\('pitchTrainer_flowAttempts'\)/.test(html) && /FLOW_SESSIONS_KEY=MC\.adoptKey\('pitchTrainer_flowSessions'\)/.test(html), 'index.html: Flow keys are env-scoped');
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
