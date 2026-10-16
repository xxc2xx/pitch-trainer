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

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
