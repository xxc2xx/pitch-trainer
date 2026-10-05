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

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
