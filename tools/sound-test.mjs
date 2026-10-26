// node tools/sound-test.mjs — Sound.schedule against a fake smplr that
// copies smplr 1.1.0's real rules (dist/index.mjs, SmplrImpl.start +
// Scheduler + VoiceManager):
//   - a note within the 200 ms lookahead becomes a voice at once; a later
//     note waits in a queue
//   - start() returns stop(time): it CANCELS a still-queued note and stops
//     every voice sharing the note's stopId at `time`
//   - event.duration releases a voice by itself
// Regression: 1.0.0 called stop(when + dur) right after scheduling, which
// cancelled every queued note of a tagged tune — only its first note sounded
// (Garden "Hear it" on iPhone, 2026-10-26).
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.argv[2] || path.join(ROOT, 'sound.js');
let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok    ' : '  FAIL  ') + m); if(!c) fail++; };

function makeFakeSmplr(clock){
  const LOOK = 0.2;
  return function Instrument(){
    const queue = new Set(), voices = [];
    const voice = (e) => { const v = { m: e.note, start: e.time, end: e.duration != null ? e.time + e.duration : Infinity, stopId: e.stopId }; voices.push(v); return v; };
    const inst = {
      ready: Promise.resolve(),
      voices,
      start(e){
        if(e.stopId === undefined) e = Object.assign({}, e, { stopId: e.note });   // normalizeNoteEvent: stopId ?? note
        let q = null;
        if(e.time <= clock.t + LOOK) voice(e); else { q = e; queue.add(q); }
        return (time) => {                       // = smplr 1.1.0's StopFn
          if(q) queue.delete(q);                 // schedulerStop(): cancel if still queued
          // real voice.stop(t) ends in gain.cancelScheduledValues(t), which
          // throws for a non-number t (old callers passed { time })
          if(time != null && typeof time !== 'number' && voices.some(v => v.stopId === e.stopId)) throw new TypeError('non-finite time');
          const at = time == null ? clock.t : time;
          voices.filter(v => v.stopId === e.stopId).forEach(v => { v.end = Math.min(v.end, at); });
        };
      },
      stop(id){ voices.filter(v => v.stopId === id).forEach(v => { v.end = Math.min(v.end, clock.t); }); },
      tick(){ queue.forEach(e => { if(e.time <= clock.t + LOOK){ queue.delete(e); voice(e); } }); },
    };
    return inst;
  };
}

async function run(src){
  const clock = { t: 0 };
  const Fake = makeFakeSmplr(clock), made = [];
  const lib = { SplendidGrandPiano(){ const i = Fake(); made.push(i); return i; }, ElectricPiano: Fake, Soundfont: Fake };
  const code = fs.readFileSync(src, 'utf8').replace(/import\(SMPLR\)/, '__fakeImport()');
  const win = { console: { warn(){}, log(){} }, __fakeImport: () => Promise.resolve(lib), setTimeout, clearTimeout };
  win.window = win;
  vm.runInNewContext(code, win);
  const ctx = { get currentTime(){ return clock.t; }, destination: {}, createGain(){ return { gain: {}, connect(){}, disconnect(){} }; } };
  win.Sound.use(ctx);
  for(let i = 0; i < 20 && !win.Sound.sampled; i++) await new Promise(r => setImmediate(r));
  const piano = made[0];
  const t0 = 0.2;
  [60, 62, 60].forEach((m, k) => win.Sound.schedule(m, t0 + k * 0.7, 0.6, { vel: 90, tag: 'sing' }));
  for(; clock.t < 3; clock.t += 0.05) made.forEach(i => i.tick());
  const heard = piano.voices.filter(v => v.end > v.start);
  // cancel(tag) still silences a tune that is playing
  clock.t = 10;
  const t1 = 10.2;
  [60, 62, 64].forEach((m, k) => win.Sound.schedule(m, t1 + k * 0.7, 0.6, { vel: 90, tag: 'listen' }));
  clock.t = 10.5; made.forEach(i => i.tick());
  win.Sound.cancel('listen');
  for(; clock.t < 13; clock.t += 0.05) made.forEach(i => i.tick());
  const afterCancel = piano.voices.filter(v => v.stopId === 'listen' && v.end > v.start && v.start > 10.5);
  // a live key: noteOn then noteOff 0.3 s later must end the note then
  clock.t = 20; win.Sound.noteOn(67, 90); clock.t = 20.3; win.Sound.noteOff(67);
  const key = piano.voices.find(v => v.m === 67);
  return { held: key ? +(key.end - key.start).toFixed(2) : null, version: win.Sound.VERSION, sampled: win.Sound.sampled, heard: heard.map(v => [v.m, +v.start.toFixed(2), +(v.end - v.start).toFixed(2)]), afterCancel: afterCancel.length };
}

const r = await run(SRC);
ok(r.sampled, `sound ${r.version}: sampled piano path in use`);
ok(r.heard.length === 3 && r.heard.map(h => h[0]).join() === '60,62,60', 'a 3-note tagged tune: all 3 notes sound — ' + JSON.stringify(r.heard));
ok(r.heard.every(h => Math.abs(h[2] - 0.6) < 0.01), 'each note lasts its scheduled 0.6 s');
ok(r.afterCancel === 0, 'Sound.cancel(tag) still stops the notes not yet played');
ok(r.held === 0.3, `letting go of a key ends the sampled note (lasted ${r.held} s, want 0.3)`);

console.log(fail ? `\nSOUND TEST FAIL (${fail})` : '\nSOUND TEST PASS');
process.exit(fail ? 1 : 0);
