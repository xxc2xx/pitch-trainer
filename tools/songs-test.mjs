// node tools/songs-test.mjs — the practice arrangement (songs.js arrangeFor):
// short exercises repeat ≥ 8× and always last ≥ 20 s of real music; other
// songs repeat only when shorter than 20 s; recordings never repeat; whole
// bars only (the closing rest counts), notes keep their length and pitch.
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok    ' : '  FAIL  ') + m); if(!c) fail++; };
const win = { console, document: { getElementById(){ return null; }, createElement(){ return { style: {} }; }, head: { appendChild(){} } }, localStorage: { getItem(){ return null; }, setItem(){} }, location: { pathname: '/', search: '', hostname: 'example.test' }, navigator: {} };
win.window = win; win.self = win;
const ctx = vm.createContext(win);
for(const f of ['music-core.js', 'songs.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
const { arrangeFor, exerciseTakes } = win.Songs, MC = win.MusicCore;
const ex = exerciseTakes(), drd = ex.find(t => t.id === 'x_drd');
const sky = t => MC.skyline(t.notes);

for(const [bpm, want] of [[60, 32.0], [76, 25.26], [92, 20.87]]){
  const a = arrangeFor(drd, sky(drd), bpm);
  ok(a.reps === 8 && Math.abs(a.sec - want) < 0.01, `Do Re Do @${bpm}: 8 repeats, ${a.sec.toFixed(2)} s (want ${want})`);
}
const fast = arrangeFor(drd, sky(drd), 140);
ok(fast.reps === 12 && fast.sec >= 20, `faster tempo adds whole repeats: @140 → ${fast.reps}×, ${fast.sec.toFixed(2)} s`);
const a76 = arrangeFor(drd, sky(drd), 76);
ok(a76.notes.length === 24 && a76.beats === 4 && a76.totalBeats === 32, 'Do Re Do: 4-beat bar incl. its rest, 24 notes over 32 beats');
ok(a76.notes.every((n, i) => n.m === sky(drd)[i % 3].m && n.d === 1 && Math.abs(n.t - (Math.floor(i / 3) * 4 + i % 3)) < 1e-9), 'repeats keep pitch, length and bar position — no stretching, no padding');
ok(ex.every(t => { const a = arrangeFor(t, sky(t), 76); return a.reps >= 8 && a.sec >= 20; }), 'every book exercise: ≥ 8 repeats and ≥ 20 s at 76');
ok(ex.find(t => t.id === 'x_low').notes[0].m === 48, 'Low hill stays in its real octave (C3)');

const long = MC.fromTokens('C4 D4 E4 F4 G4 A4 B4 C5 '.repeat(4), { bpm: 90 });          // 32 beats ≈ 21.3 s
ok(arrangeFor(long, sky(long), 90).reps === 1, 'a song already ≥ 20 s plays once');
const shortSong = MC.fromTokens('E4 D4 C4:2 E4 D4 C4:2', { bpm: 90 });                      // 8 beats = 5.3 s
const ss = arrangeFor(shortSong, sky(shortSong), 90);
ok(ss.reps === 4 && ss.sec >= 20, `a short song repeats whole until ≥ 20 s: ${ss.reps}×, ${ss.sec.toFixed(1)} s`);
const rec = Object.assign({}, shortSong, { audioId: 'a1' });
ok(arrangeFor(rec, sky(rec), 90).reps === 1, 'a recording never repeats');

console.log(fail ? `\nSONGS TEST FAIL (${fail})` : '\nSONGS TEST PASS');
process.exit(fail ? 1 : 0);
