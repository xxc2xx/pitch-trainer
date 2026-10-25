/* @shared music-core 1.2.1 */
/* music-core.js — shared foundation for pitch-trainer, beat-hive and music-garden.
   VERSION (semver) is the contract consumers pin in vendor.lock.json:
   major = removed/renamed export or changed return shape, minor = additive,
   patch = fix. Bump it in this header, in VERSION below and in
   shared-manifest.json together.

   Classic script (not an ES module) so both apps' inline <script> blocks can
   use it synchronously: it sets window.MusicCore. Under node it exports the
   same object for tools/core-test.mjs.

   beat-hive and music-garden carry vendored copies — edit THIS file, then run
   tools/consumers-test.sh and tools/sync-core.sh (see CLAUDE.md, governance).

   Contents:
   - PALETTE / SOLFEGE / note helpers  (one colour per pitch class, everywhere)
   - LEVELS                             (one engine, three presentations)
   - Take                               (the recording/song shape both apps share)
   - tokens interop                     ("F4:1 G4:0.5 R:1", the app's existing format)
   - IndexedDB store                    (same origin xxc2xx.github.io → shared)
*/
(function(root){
  'use strict';
  const VERSION = '1.2.1';

  // ── Environment namespace ─────────────────────────────────────────────
  // Live, staging and local dev share ONE origin (xxc2xx.github.io /
  // localhost), so storage is shared unless names differ. Every persistent
  // name goes through ns(): unchanged in production, 'name@stg' under
  // /staging/, '@dev' on localhost, '@test' with ?env=test (automated runs).
  let _env = null;
  function env(){
    if(_env != null) return _env;
    const L = root.location;
    if(!L) return (_env = '');
    if(/[?&]env=test(&|$)/.test(L.search || '')) return (_env = 'test');
    if(/\/staging\//.test(L.pathname || '')) return (_env = 'stg');
    if(/^(localhost|127\.0\.0\.1|\[::1\])$/.test(L.hostname || '')) return (_env = 'dev');
    return (_env = '');
  }
  const ns = name => env() ? name + '@' + env() : name;
  // one-time copy of an un-namespaced localStorage value into this env's key,
  // so moving a key behind ns() keeps what she already had; never deletes
  function adoptKey(name){
    const k = ns(name);
    if(k === name) return k;
    try{ if(localStorage.getItem(k) == null){ const v = localStorage.getItem(name); if(v != null) localStorage.setItem(k, v); } }catch(e){}
    return k;
  }

  // ── Pitch classes ─────────────────────────────────────────────────────
  const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const NOTE_BARE  = ['C','Cs','D','Ds','E','F','Fs','G','Gs','A','As','B'];
  const IS_BLACK   = [0,1,0,1,0,0,1,0,1,0,1,0].map(Boolean);
  const SOLFEGE    = ['Do','Di','Re','Ri','Mi','Fa','Fi','Sol','Si','La','Li','Ti'];

  // Boomwhackers-style classroom colours (C red … B pink). Sharps sit between
  // their neighbours; the UI adds a stripe so they never read as a naturals.
  // Verify against the classroom set before treating these as final.
  const PALETTE = [
    '#e53935', // C  red
    '#f4511e', // C# red-orange
    '#fb8c00', // D  orange
    '#fbc02d', // D# amber
    '#fdd835', // E  yellow
    '#9ccc65', // F  light green
    '#43a047', // F# green
    '#1b7f5a', // G  dark green
    '#5e35b1', // G# indigo
    '#8e24aa', // A  purple
    '#c2185b', // A# berry
    '#ec407a', // B  pink
  ];

  const pc = m => ((m % 12) + 12) % 12;
  const octaveOf = m => Math.floor(m / 12) - 1;          // MIDI 60 → 4
  const midiToFreq = m => 440 * Math.pow(2, (m - 69) / 12);
  const freqToMidiFloat = f => 69 + 12 * Math.log2(f / 440);
  const midiName = m => NOTE_NAMES[pc(m)] + octaveOf(m);
  const midiOf = (bare, oct) => 12 * (oct + 1) + NOTE_BARE.indexOf(bare);
  const colorOf = m => PALETTE[pc(m)];
  const isBlack = m => IS_BLACK[pc(m)];

  // Figurenotes-style octave shape: below middle C = square, middle octave =
  // circle, above = triangle. Lets a pre-reader tell low C from high C.
  function shapeOf(m){ return m < 60 ? 'square' : m < 72 ? 'circle' : 'triangle'; }

  function label(m, mode){
    switch(mode){
      case 'solfege': return SOLFEGE[pc(m)];
      case 'letter':  return NOTE_NAMES[pc(m)];
      case 'full':    return midiName(m);
      default:        return '';               // 'color' / 'none'
    }
  }

  // ── Levels — same engine, different presentation ──────────────────────
  // range: playable MIDI range. view: keys visible at once (white-key count).
  const LEVELS = {
    sprout: { id:'sprout', icon:'🌱', name:'Sprout', range:[60,72], view:8,
              labels:'color',   see:'lane',  follow:'wait',  colorAmt:1,
              minimap:false, zoom:false },
    bloom:  { id:'bloom',  icon:'🌸', name:'Bloom',  range:[24,96], view:15,   // C1–C7, slide to explore
              labels:'solfege', see:'staff', follow:'wait',  colorAmt:1,
              minimap:true,  zoom:true },
    grow:   { id:'grow',   icon:'🌳', name:'Grow',   range:[21,108], view:22,
              labels:'letter',  see:'staff', follow:'timed', colorAmt:0.25,
              minimap:true,  zoom:true },
  };
  const LEVEL_KEY = () => adoptKey('musicEco_level');      // env-scoped (plan D1)
  function getLevel(){
    try{ return LEVELS[localStorage.getItem(LEVEL_KEY())] || LEVELS.sprout; }
    catch(e){ return LEVELS.sprout; }
  }
  function setLevel(id){
    try{ localStorage.setItem(LEVEL_KEY(), id); }catch(e){}
    return LEVELS[id] || LEVELS.sprout;
  }

  // ── Take ──────────────────────────────────────────────────────────────
  // notes: [{m, t, d, v}] — MIDI, start and duration in BEATS (not seconds)
  // so tempo can change freely and beat-hive can snap to 16th steps.
  function makeTake(o){
    o = o || {};
    return {
      id: o.id || ('take_' + Date.now().toString(36) + Math.random().toString(36).slice(2,6)),
      title: o.title || 'Untitled',
      createdAt: o.createdAt || Date.now(),
      source: o.source || 'manual',
      bpm: o.bpm || 90,
      timeSig: o.timeSig || [4,4],
      key: o.key || 'C',
      notes: (o.notes || []).map(n => ({ m:n.m, t:n.t, d:n.d, v:n.v == null ? 0.8 : n.v }))
                            .sort((a,b) => a.t - b.t || a.m - b.m),
      audioId: o.audioId || null,
      // Song fields (all optional — a plain Take is still a valid Song)
      sync:    o.sync || null,      // { audioId, kind:'audio'|'video', offsetSec, beatTimes:[sec…] }
      parts:   o.parts || null,     // { chords:[{t,d,label,ms}], parent:[notes] }
      section: o.section || null,   // { from, to } in beats — practice loop
      range:   o.range || null,     // [lo, hi] fitted to her keyboard
      tag:     o.tag || null,
      analyzed: !!o.analyzed,       // notes came from the song analyzer (✨)
      icon:    o.icon || null,
    };
  }

  // ── Sync: beats ↔ seconds of the original recording ───────────────────
  // beatTimes[i] = second at which beat i happens (handles tempo drift);
  // without it, a constant tempo from offsetSec.
  function beatToSec(song, beat){
    const s = song.sync || {}, bt = s.beatTimes;
    if(bt && bt.length > 1){
      const i = Math.max(0, Math.min(bt.length - 2, Math.floor(beat)));
      return bt[i] + (beat - i) * (bt[i + 1] - bt[i]);
    }
    return (s.offsetSec || 0) + beat * 60 / (song.bpm || 90);
  }
  function secToBeat(song, sec){
    const s = song.sync || {}, bt = s.beatTimes;
    if(bt && bt.length > 1){
      let lo = 0, hi = bt.length - 2;
      if(sec <= bt[0]) return (sec - bt[0]) / (bt[1] - bt[0]);
      if(sec >= bt[hi + 1]) return hi + 1 + (sec - bt[hi + 1]) / (bt[hi + 1] - bt[hi]);
      while(lo < hi){ const mid = (lo + hi + 1) >> 1; if(bt[mid] <= sec) lo = mid; else hi = mid - 1; }
      return lo + (sec - bt[lo]) / (bt[lo + 1] - bt[lo]);
    }
    return (sec - (s.offsetSec || 0)) * (song.bpm || 90) / 60;
  }
  // Song analyzer result (seconds, see ~/song-analyzer) → this song on its
  // real beat map: melody + chords in beats, sync.beatTimes from the beats.
  function songFromAnalysis(song, res, grid){
    const bt = (res.beatTimes || []).slice();
    if(bt.length < 4) throw new Error('Analysis found too few beats');
    const probe = { bpm: res.bpm, sync: { beatTimes: bt } };
    const toB = sec => secToBeat(probe, sec);
    let notes = (res.melody || []).map(n => ({ m: n.m, t: toB(n.on), d: Math.max(0.1, toB(n.off) - toB(n.on)), v: n.v == null ? 0.8 : Math.min(1, n.v) }));
    notes = quantize(notes, grid || 0.25);
    const seen = new Map();                      // quantize can stack two notes on one onset
    notes.forEach(n => { const k = n.t; if(!seen.has(k) || seen.get(k).m < n.m) seen.set(k, n); });
    notes = [...seen.values()].sort((a, b) => a.t - b.t);
    const chords = (res.chords || []).map(c => ({ t: Math.round(toB(c.t) * 4) / 4, d: Math.max(0.25, Math.round((toB(c.t + c.d) - toB(c.t)) * 4) / 4),
                                                  label: c.label, root: c.root, minor: !!c.minor }));
    return makeTake({ ...song, notes, bpm: Math.round(res.bpm) || song.bpm, key: (res.key || song.key || 'C').replace(/m$/, ''),
      sync: { ...(song.sync || {}), beatTimes: bt, offsetSec: bt[0] },
      parts: { ...(song.parts || {}), chords }, analyzed: true });
  }

  // Dad's part when the song has no chords: per bar, the I / IV / V / vi
  // chord of the song's key that covers the most melody (weighted by
  // duration, downbeat counts double). Voiced around C3–B3 for the left hand.
  const KEY_PC = { C:0, 'C#':1, Db:1, D:2, Eb:3, 'D#':3, E:4, F:5, 'F#':6, Gb:6, G:7, Ab:8, 'G#':8, A:9, Bb:10, 'A#':10, B:11, Cb:11 };
  function chordTones(root, minor, base){
    base = base == null ? 48 : base;                 // C3
    const r = base + ((root % 12) + 12) % 12;
    return [r, r + (minor ? 3 : 4), r + 7];
  }
  function autoChords(song){
    const k = KEY_PC[String(song.key || 'C').replace(/m$/, '')] || 0;
    const cands = [[0, false, 'I'], [5, false, 'IV'], [7, false, 'V'], [9, true, 'vi']];
    const bpb = song.timeSig ? song.timeSig[0] * 4 / song.timeSig[1] : 4;
    const notes = song.notes || [], end = takeLength(song);
    const out = [];
    for(let b0 = Math.floor((notes[0] ? notes[0].t : 0) / bpb) * bpb; b0 < end; b0 += bpb){
      const inBar = notes.filter(n => n.t < b0 + bpb && n.t + n.d > b0);
      if(!inBar.length){ continue; }
      let best = cands[0], bestSc = -1;
      cands.forEach((c, ci) => {
        const pcs = [0, c[1] ? 3 : 4, 7].map(x => (k + c[0] + x) % 12);
        let sc = 0;
        inBar.forEach(n => {
          const w = Math.min(n.t + n.d, b0 + bpb) - Math.max(n.t, b0);
          sc += pcs.includes(pc(n.m)) ? w * (Math.abs(n.t - b0) < 1e-6 ? 2 : 1) : 0;
        });
        sc -= ci * 0.01;                            // ties → simpler chord (I before IV before V)
        if(sc > bestSc){ bestSc = sc; best = c; }
      });
      const root = (k + best[0]) % 12;
      const prev = out[out.length - 1];
      if(prev && prev.root === root && prev.minor === best[1] && Math.abs(prev.t + prev.d - b0) < 1e-6){ prev.d += bpb; continue; }
      out.push({ t: b0, d: bpb, root, minor: best[1], label: NOTE_NAMES[root].replace('#', '♯') + (best[1] ? 'm' : '') });
    }
    return out.map(c => ({ ...c, ms: chordTones(c.root, c.minor) }));
  }
  function chordAt(chords, beat){
    let cur = null; (chords || []).forEach(c => { if(c.t <= beat + 1e-6) cur = c; });
    return cur && beat < cur.t + cur.d + 1e-6 ? cur : null;
  }

  // Tempo from note onsets (seconds): the 8th-note grid, anchored on the
  // first onset, that the onsets fit best. Folded into 70–150 BPM.
  function estimateTempo(onsets){
    if(!onsets || onsets.length < 4) return 90;
    const t0 = onsets[0];
    let best = 90, bestSc = -Infinity;
    for(let bpm = 60; bpm <= 180; bpm += 0.5){
      const step = 30 / bpm;                         // 8th note
      let sc = 0;
      onsets.forEach(t => { sc += Math.cos(2 * Math.PI * (t - t0) / step); });
      sc -= Math.abs(bpm - 105) * 0.01 * onsets.length;   // mild prior toward moderate tempi
      if(sc > bestSc){ bestSc = sc; best = bpm; }
    }
    while(best > 150) best /= 2;
    while(best < 70) best *= 2;
    return Math.round(best);
  }
  function takeLength(take){
    return take.notes.reduce((mx,n) => Math.max(mx, n.t + n.d), 0);
  }
  // Highest note at each onset — a single melody line out of polyphonic input.
  function skyline(notes){
    const byT = new Map();
    notes.forEach(n => {
      const k = Math.round(n.t * 1000);
      if(!byT.has(k) || byT.get(k).m < n.m) byT.set(k, n);
    });
    return [...byT.values()].sort((a,b) => a.t - b.t);
  }
  // Snap onsets and durations to a grid (in beats: 0.25 = 16th, 0.5 = 8th).
  function quantize(notes, grid){
    grid = grid || 0.25;
    return notes.map(n => {
      const t = Math.round(n.t / grid) * grid;
      const d = Math.max(grid, Math.round(n.d / grid) * grid);
      return { ...n, t, d };
    });
  }

  // ── Tokens interop: "F4:1 Bb4:0.5 R:1" ────────────────────────────────
  const LETTER = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 };
  function parseTokens(text){
    const out = []; let t = 0;
    String(text || '').trim().split(/\s+/).forEach(tok => {
      const mm = tok.match(/^([A-Gr])([#b]?)(-?[0-9]?)(?::([0-9.]+))?$/i);
      if(!mm) return;
      const beats = parseFloat(mm[4] || '1');
      if(!(beats > 0)) return;
      if(mm[1].toLowerCase() === 'r'){ t += beats; return; }
      const oct = mm[3] === '' ? 4 : parseInt(mm[3], 10);
      let idx = LETTER[mm[1].toUpperCase()];
      if(mm[2] === '#') idx++; else if(mm[2] === 'b') idx--;
      out.push({ m: 12 * (oct + 1) + idx, t, d: beats, v: 0.8 });
      t += beats;
    });
    return out;
  }
  function fromTokens(text, meta){
    return makeTake({ ...(meta || {}), notes: parseTokens(text) });
  }
  // Monophonic only: overlapping notes are serialised by onset order.
  function toTokens(take){
    const out = []; let t = 0;
    skyline(take.notes).forEach(n => {
      if(n.t > t + 1e-6) out.push('R:' + +(n.t - t).toFixed(3));
      const name = NOTE_NAMES[pc(n.m)];
      out.push(name + octaveOf(n.m) + ':' + +n.d.toFixed(3));
      t = n.t + n.d;
    });
    return out.join(' ');
  }

  // ── Built-in songs (public domain), all inside C4–C5 for Sprout ───────
  const BUILTIN = [
    { id:'b_hcb', title:'Hot Cross Buns', icon:'🥯', bpm:90,
      tokens:'E4 D4 C4:2 E4 D4 C4:2 C4:0.5 C4:0.5 C4:0.5 C4:0.5 D4:0.5 D4:0.5 D4:0.5 D4:0.5 E4 D4 C4:2' },
    { id:'b_mary', title:'Mary Had a Little Lamb', icon:'🐑', bpm:100,
      tokens:'E4 D4 C4 D4 E4 E4 E4:2 D4 D4 D4:2 E4 G4 G4:2 E4 D4 C4 D4 E4 E4 E4 E4 D4 D4 E4 D4 C4:4' },
    { id:'b_twinkle', title:'Twinkle Twinkle', icon:'⭐', bpm:96,
      tokens:'C4 C4 G4 G4 A4 A4 G4:2 F4 F4 E4 E4 D4 D4 C4:2 G4 G4 F4 F4 E4 E4 D4:2 G4 G4 F4 F4 E4 E4 D4:2 C4 C4 G4 G4 A4 A4 G4:2 F4 F4 E4 E4 D4 D4 C4:2' },
    { id:'b_row', title:'Row Row Your Boat', icon:'🚣', bpm:100, timeSig:[6,8],
      tokens:'C4:1.5 C4:1.5 C4:1 D4:0.5 E4:1.5 E4:1 D4:0.5 E4:1 F4:0.5 G4:3 C5:0.5 C5:0.5 C5:0.5 G4:0.5 G4:0.5 G4:0.5 E4:0.5 E4:0.5 E4:0.5 C4:0.5 C4:0.5 C4:0.5 G4:1 F4:0.5 E4:1 D4:0.5 C4:3' },
    { id:'b_bday', title:'Happy Birthday', icon:'🎂', bpm:96, timeSig:[3,4], key:'F',
      tokens:'C4:0.75 C4:0.25 D4 C4 F4 E4:2 C4:0.75 C4:0.25 D4 C4 G4 F4:2 C4:0.75 C4:0.25 C5 A4 F4 E4 D4:2 Bb4:0.75 Bb4:0.25 A4 F4 G4 F4:3' },
    { id:'b_mac', title:'Old MacDonald', icon:'🐮', bpm:110, key:'F',
      tokens:'F4 F4 F4 C4 D4 D4 C4:2 A4 A4 G4 G4 F4:3 C4 F4 F4 F4 C4 D4 D4 C4:2 A4 A4 G4 G4 F4:4' },
  ];
  function builtinTakes(){
    return BUILTIN.map(b => fromTokens(b.tokens, {
      id:b.id, title:b.title, bpm:b.bpm, timeSig:b.timeSig, key:b.key,
      source:'builtin', createdAt:0, icon:b.icon,
    })).map((t,i) => ({ ...t, icon: BUILTIN[i].icon }));
  }

  // ── Storage adapters ──────────────────────────────────────────────────
  // One tiny interface over IndexedDB (browser) and memory (tests, and the
  // fallback when IndexedDB is blocked), so the logic below is the same code
  // in both and failures can be injected in tests.
  //   adapter.tx(storeNames, mode, async api => …)  — ONE transaction
  //   api.get(s, key) · api.put(s, value, key?) · api.del(s, key)
  //   api.all(s, index?, query?) · api.keys(s)        query: {eq} | {from, to}
  // A transaction resolves after it commits; if fn throws, nothing is written.
  function reqP(r){ return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  // {from, to} may be open on either side (real IDB throws on bound(undefined, …))
  function rangeOf(q){
    if(!q) return undefined;
    if('eq' in q) return IDBKeyRange.only(q.eq);
    if(q.from != null && q.to != null) return IDBKeyRange.bound(q.from, q.to);
    return q.from != null ? IDBKeyRange.lowerBound(q.from) : q.to != null ? IDBKeyRange.upperBound(q.to) : undefined;
  }
  function idbAdapter(name, ver, stores){
    let p = null;
    const open = () => p || (p = new Promise((res, rej) => {
      if(typeof indexedDB === 'undefined') return rej(new Error('IndexedDB unavailable'));
      const rq = indexedDB.open(name, ver);
      rq.onupgradeneeded = () => {
        const db = rq.result;
        Object.entries(stores).forEach(([s, o]) => {
          if(db.objectStoreNames.contains(s)) return;
          const st = db.createObjectStore(s, o.keyPath ? { keyPath: o.keyPath } : undefined);
          (o.idx || []).forEach(i => st.createIndex(i, i));
        });
      };
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => { p = null; rej(rq.error); };
    }));
    const range = rangeOf;
    return {
      name,
      tx(names, mode, fn){
        return open().then(db => new Promise((res, rej) => {
          const t = db.transaction(names, mode); let out, failed = null;
          const api = {
            get: (s, k) => reqP(t.objectStore(s).get(k)),
            put: (s, v, k) => reqP(k === undefined ? t.objectStore(s).put(v) : t.objectStore(s).put(v, k)),
            del: (s, k) => reqP(t.objectStore(s).delete(k)),
            all: (s, idx, q) => reqP(idx ? t.objectStore(s).index(idx).getAll(range(q)) : t.objectStore(s).getAll(range(q))),
            keys: (s) => reqP(t.objectStore(s).getAllKeys()),
          };
          Promise.resolve().then(() => fn(api)).then(v => { out = v; }, e => { failed = e; try{ t.abort(); }catch(_){} });
          t.oncomplete = () => failed ? rej(failed) : res(out);
          t.onerror = t.onabort = () => rej(failed || t.error || new Error('transaction aborted'));
        }));
      },
    };
  }
  // memory adapter: same contract; `faults` injects failures for tests:
  //   { unavailable: true } every tx rejects · { quota: true } every put rejects
  //   { failAfterPuts: n } the (n+1)th put of a tx throws (partial-failure drills)
  function memAdapter(stores, faults){
    faults = faults || {};
    const data = {}; Object.keys(stores).forEach(s => { data[s] = new Map(); });
    const keyOf = (s, v, k) => k !== undefined ? k : v[stores[s].keyPath];
    const match = (v, idx, q) => { if(!q) return true; const x = idx ? v[idx] : undefined; return 'eq' in q ? x === q.eq : (q.from == null || x >= q.from) && (q.to == null || x <= q.to); };
    const clone = v => v == null ? v : JSON.parse(JSON.stringify(v));
    return {
      name: 'memory', data, faults,
      tx(names, mode, fn){
        if(faults.unavailable) return Promise.reject(new Error('storage unavailable'));
        const writes = []; let puts = 0;
        const view = (s) => { const m = new Map(data[s]); writes.filter(w => w.s === s).forEach(w => w.del ? m.delete(w.k) : m.set(w.k, w.v)); return m; };
        const api = {
          get: async (s, k) => clone(view(s).get(k)),
          put: async (s, v, k) => {
            if(faults.quota) throw Object.assign(new Error('QuotaExceededError'), { name: 'QuotaExceededError' });
            if(faults.failAfterPuts != null && ++puts > faults.failAfterPuts) throw new Error('injected failure after ' + faults.failAfterPuts + ' puts');
            writes.push({ s, k: keyOf(s, v, k), v: clone(v) });
          },
          del: async (s, k) => { writes.push({ s, k, del: true }); },
          all: async (s, idx, q) => [...view(s).values()].filter(v => match(v, idx, q)).map(clone),
          keys: async (s) => [...view(s).keys()],
        };
        return Promise.resolve().then(() => fn(api)).then(out => {
          if(mode === 'readwrite') writes.forEach(w => w.del ? data[w.s].delete(w.k) : data[w.s].set(w.k, w.v));
          return out;
        });
      },
    };
  }

  // ── Content store: takes + their audio (env-scoped, plan D1) ──────────
  const CONTENT_STORES = { takes: { keyPath: 'id' }, audio: {} };
  let _content = null;
  const content = () => _content || (_content = idbAdapter(ns('music-eco'), 1, CONTENT_STORES));
  const cTx = (s, mode, fn) => ready().then(() => content().tx([s], mode, fn));
  const store = {
    saveTake:  take => cTx('takes', 'readwrite', a => a.put('takes', take)).then(() => take),
    getTake:   id   => cTx('takes', 'readonly',  a => a.get('takes', id)),
    listTakes: ()   => cTx('takes', 'readonly',  a => a.all('takes'))
                         .then(x => (x || []).sort((p, q) => q.createdAt - p.createdAt)),
    deleteTake:id   => cTx('takes', 'readwrite', a => a.del('takes', id)),
    saveAudio: (id, blob) => cTx('audio', 'readwrite', a => a.put('audio', blob, id)).then(() => id),
    getAudio:  id   => cTx('audio', 'readonly',  a => a.get('audio', id)),
    deleteAudio: id => cTx('audio', 'readwrite', a => a.del('audio', id)),
  };

  // ── Learning store (plan D2): sessions → attempts → derived items ─────
  //   Session  { id, schema, env, app, kind, contentId, planId, stepIdx, day,
  //              startedAt, endedAt, activeMs, status, input, pageId,
  //              attemptCount, applied, summary, rules, …extra }
  //   Attempt  { id:'<sessionId>.<seq>', schema, sessionId, day, t, at, skill,
  //              target, observed, outcome, evidence, conf, errMs, timing,
  //              hints, firstTry, rules, …extra }
  //   items    key → derived state (skills, songs, plans); meta key → markers
  // Attempts are raw and append-only; ids are deterministic, every write is a
  // put, so retries never duplicate. Derived items are applied in the SAME
  // transaction that marks the session applied, so they apply exactly once.
  const LEARN_STORES = { sessions: { keyPath: 'id', idx: ['day', 'kind'] },
                         attempts: { keyPath: 'id', idx: ['sessionId', 'day', 'skill'] }, items: {}, meta: {} };
  const SCHEMA = 1;
  const STATUS   = ['started', 'paused', 'completed', 'exited', 'interrupted', 'error'];
  const OUTCOMES = ['correct', 'wrong', 'miss', 'uncertain', 'self', 'skipped', 'unavailable'];
  const EVIDENCE = ['clock', 'mic-verified', 'mic-uncertain', 'self', 'none'];
  const SKILLS   = ['pitch', 'echo', 'reading', 'rhythm', 'motor', 'writing'];
  const rnd = n => Math.random().toString(36).slice(2, 2 + (n || 6));
  const tnow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  function validate(type, r){
    const e = [], need = (k, ok) => { if(!ok) e.push(k); };
    if(!r || typeof r !== 'object') return ['not an object'];
    need('schema', r.schema === SCHEMA || r.schema === 0);
    need('id', typeof r.id === 'string' && r.id.length > 0);
    need('day', /^\d{4}-\d{2}-\d{2}$/.test(r.day));
    if(type === 'session'){
      need('kind', typeof r.kind === 'string' && r.kind.length > 0);
      need('status', STATUS.includes(r.status));
      need('startedAt', Number.isFinite(r.startedAt));
    } else if(type === 'attempt'){
      need('sessionId', typeof r.sessionId === 'string' && r.id.startsWith(r.sessionId + '.'));
      need('skill', SKILLS.includes(r.skill));
      need('outcome', OUTCOMES.includes(r.outcome));
      need('evidence', EVIDENCE.includes(r.evidence));
      need('at', Number.isFinite(r.at));
    } else e.push('unknown type');
    return e;
  }
  function createLearn(A, o){
    o = o || {};
    const pageId = 'pg_' + Date.now().toString(36) + rnd(4);
    const health = { ok: true, lastError: null, dropped: 0 };
    const onError = o.onError || (() => {});
    const fail = (e, what) => { health.ok = false; health.lastError = (what ? what + ': ' : '') + String((e && e.message) || e); onError(health.lastError); };
    const write = (names, fn, what) => A.tx(names, 'readwrite', fn).then(() => { health.ok = true; return true; }, e => { fail(e, what); return false; });
    const checked = (type, r) => { const err = validate(type, r); if(err.length){ health.dropped++; onError(`invalid ${type} dropped (${err.join(', ')})`); return false; } return true; };

    function begin(f){
      f = f || {};
      const t0 = tnow();
      let seq = 0, ended = false, pausedAt = null, pausedMs = 0;
      const rec = Object.assign({}, f.extra || {}, {
        id: 's_' + Date.now().toString(36) + '_' + rnd(6), schema: SCHEMA, env: env(), app: f.app || o.app || 'pt',
        kind: f.kind, contentId: f.contentId ?? null, planId: f.planId ?? null, stepIdx: f.stepIdx ?? null,
        day: dayKey(new Date()), startedAt: Date.now(), endedAt: null, activeMs: 0, status: 'started',
        input: f.input ?? null, pageId, attemptCount: 0, applied: false, summary: {}, rules: f.rules ?? null,
      });
      const ok = checked('session', rec);
      let chain = ok ? write(['sessions'], a => a.put('sessions', rec), 'session') : Promise.resolve(false);
      const then = (fn) => { chain = chain.then(fn); return chain; };    // writes for one session stay in order
      const active = () => Math.max(0, Math.round(tnow() - t0 - pausedMs - (pausedAt != null ? tnow() - pausedAt : 0)));
      return {
        get id(){ return rec.id; }, get ended(){ return ended; }, rec,
        attempt(a){
          if(ended || !ok) return null;
          const r = Object.assign({}, a.extra || {}, {
            id: rec.id + '.' + (++seq), schema: SCHEMA, sessionId: rec.id, day: rec.day, t: Math.round(tnow() - t0), at: Date.now(),
            skill: a.skill, target: a.target ?? null, observed: a.observed ?? null, outcome: a.outcome,
            evidence: a.evidence || 'clock', conf: a.conf ?? null, errMs: a.errMs ?? null, timing: a.timing ?? null,
            hints: a.hints || 0, firstTry: !!a.firstTry, rules: rec.rules,
          });
          rec.attemptCount = seq;
          if(checked('attempt', r)) then(() => write(['attempts'], x => x.put('attempts', r), 'attempt'));
          return r;
        },
        pause(){ if(ended || pausedAt != null) return; pausedAt = tnow(); rec.status = 'paused'; rec.activeMs = active();
          if(ok) then(() => write(['sessions'], x => x.put('sessions', Object.assign({}, rec)), 'pause')); },
        resume(){ if(ended || pausedAt == null) return; pausedMs += tnow() - pausedAt; pausedAt = null; rec.status = 'started';
          if(ok) then(() => write(['sessions'], x => x.put('sessions', Object.assign({}, rec)), 'resume')); },
        // status: completed | exited | error. items: derived state, applied once.
        end(status, summary, items){
          if(ended) return chain; ended = true;
          rec.status = STATUS.includes(status) ? status : 'completed';
          rec.activeMs = active(); rec.endedAt = Date.now(); rec.summary = summary || {};
          if(!ok) return chain;
          return then(() => applyOnce(Object.assign({}, rec), items));
        },
      };
    }
    function applyOnce(rec, items){
      return write(['sessions', 'items'], async a => {
        const cur = await a.get('sessions', rec.id);
        if(cur && cur.applied){ rec.applied = true; await a.put('sessions', Object.assign(cur, { status: rec.status, endedAt: rec.endedAt, activeMs: rec.activeMs, summary: rec.summary })); return; }
        if(items) for(const [k, v] of Object.entries(items)) await a.put('items', v, k);
        rec.applied = !!items;
        await a.put('sessions', rec);
      }, 'end');
    }
    // sessions left started/paused by an earlier page (closed app, crash) → interrupted
    function recover(days){
      const from = addDays(dayKey(new Date()), -(days || 14));
      return A.tx(['sessions', 'attempts'], 'readwrite', async a => {
        const open = (await a.all('sessions', 'day', { from, to: '9999-12-31' })).filter(s => (s.status === 'started' || s.status === 'paused') && s.pageId !== pageId);
        for(const s of open){
          const at = await a.all('attempts', 'sessionId', { eq: s.id });
          s.status = 'interrupted';
          s.endedAt = at.length ? Math.max(...at.map(x => x.at)) : s.startedAt;
          s.attemptCount = Math.max(s.attemptCount || 0, at.length);
          await a.put('sessions', s);
        }
        return open;
      }).catch(e => { fail(e, 'recover'); return []; });
    }
    const read = (names, fn, dflt) => A.tx(names, 'readonly', fn).catch(e => { fail(e, 'read'); return dflt; });
    const pairs = (s) => a => Promise.all([a.keys(s), a.all(s)]).then(([k, v]) => k.map((x, i) => [x, v[i]]));
    return {
      pageId, health, validate, begin, recover,
      sessions: (from, to) => read(['sessions'], a => a.all('sessions', 'day', { from, to }), []).then(x => x.sort((p, q) => p.startedAt - q.startedAt)),
      attempts: (from, to) => read(['attempts'], a => a.all('attempts', 'day', { from, to }), []),
      attemptsFor: (id) => read(['attempts'], a => a.all('attempts', 'sessionId', { eq: id }), []),
      item: (k) => read(['items'], a => a.get('items', k), undefined),
      items: () => read(['items'], pairs('items'), []).then(p => Object.fromEntries(p)),
      setItem: (k, v) => write(['items'], a => a.put('items', v, k), 'item').then(() => v),
      meta: (k) => read(['meta'], a => a.get('meta', k), undefined),
      setMeta: (k, v) => write(['meta'], a => a.put('meta', v, k), 'meta'),
      // export / import (idempotent: same ids → same records)
      export: () => read(['sessions', 'attempts', 'items', 'meta'], async a => ({
        format: 'music-learn', schema: SCHEMA, env: env(), exportedAt: new Date().toISOString(),
        sessions: await a.all('sessions'), attempts: await a.all('attempts'), items: await pairs('items')(a), meta: await pairs('meta')(a),
      }), null),
      import: (j) => {
        if(!j || j.format !== 'music-learn' || !Array.isArray(j.sessions)) return Promise.reject(new Error('not a music-learn export'));
        const s = j.sessions.filter(r => !validate('session', r).length), t = (j.attempts || []).filter(r => !validate('attempt', r).length);
        return A.tx(['sessions', 'attempts', 'items'], 'readwrite', async a => {
          // merge-only: a local record wins unless it is still open and the
          // backup's copy has ended (a restore never rewinds a session)
          const open = (x) => x.status === 'started' || x.status === 'paused';
          for(const r of s){ const cur = await a.get('sessions', r.id); if(!cur || (open(cur) && !open(r))) await a.put('sessions', r); }
          for(const r of t) if(await a.get('attempts', r.id) === undefined) await a.put('attempts', r);
          for(const [k, v] of (j.items || [])) if(await a.get('items', k) === undefined) await a.put('items', v, k);   // never overwrite newer state
          return { sessions: s.length, attempts: t.length, skipped: j.sessions.length - s.length + (j.attempts || []).length - t.length };
        });
      },
      _adapter: A,
    };
  }

  // ── Legacy → env-scoped migration (plan D1; staging only, copy-only) ──
  // Old staging builds wrote 'music-eco-log' (sessions/items) and 'music-eco'
  // (takes/audio) without a namespace. Copy them once into this env's stores;
  // the originals are never modified, so rolling back to an old build still
  // finds everything up to the migration. Markers live in the NEW meta store,
  // set in the same transaction as the last copy: a crash part-way leaves no
  // marker and the retry re-puts the same ids (no duplicates).
  const LEGACY_LOG = { sessions: { keyPath: 'id', idx: ['day'] }, items: {} };
  const MAX_BLOB = 25 * 1024 * 1024;
  function legacyAttempts(s){
    return (s.notes || []).map((n, i) => ({
      id: s.id + '.' + (i + 1), schema: 0, sessionId: s.id, day: s.day, t: null, at: s.ts || 0, skill: 'rhythm',
      target: { m: n.m, i: n.i }, observed: null, outcome: n.dtMs != null ? 'correct' : 'miss', evidence: 'clock',
      conf: null, errMs: n.dtMs ?? null, timing: n.dtMs != null ? 'clock' : null, hints: 0, firstTry: true, rules: null, legacy: true,
    }));
  }
  async function migrateLog(learnA, legacyA){
    const done = await learnA.tx(['meta'], 'readonly', a => a.get('meta', 'migrated_log_v1'));
    if(done) return { skipped: true };
    const [sessions, itemPairs] = await legacyA.tx(['sessions', 'items'], 'readonly', async a =>
      [await a.all('sessions'), await Promise.all([a.keys('items'), a.all('items')]).then(([k, v]) => k.map((x, i) => [x, v[i]]))]);
    let ns_ = 0, na = 0, ni = 0;
    await learnA.tx(['sessions', 'attempts', 'items', 'meta'], 'readwrite', async a => {
      for(const s of sessions){
        const at = legacyAttempts(s);
        await a.put('sessions', Object.assign({}, s, { schema: 0, legacy: true, env: env(), app: s.app || 'pt', status: 'completed',
          startedAt: s.ts || 0, endedAt: (s.ts || 0) + (s.durMs || 0), activeMs: s.durMs || 0, attemptCount: at.length,
          pageId: 'legacy', applied: true, summary: s.stats || {} }));
        for(const x of at) await a.put('attempts', x);
        ns_++; na += at.length;
      }
      for(const [k, v] of itemPairs) if(await a.get('items', k) === undefined){ await a.put('items', v, k); ni++; }
      await a.put('meta', { at: Date.now(), sessions: ns_, attempts: na, items: ni }, 'migrated_log_v1');
    });
    return { sessions: ns_, attempts: na, items: ni };
  }
  async function migrateContent(learnA, legacyC, newC){
    const done = await learnA.tx(['meta'], 'readonly', a => a.get('meta', 'migrated_content_v1'));
    if(done) return { skipped: true };
    const [takes, audio] = await legacyC.tx(['takes', 'audio'], 'readonly', async a =>
      [await a.all('takes'), await Promise.all([a.keys('audio'), a.all('audio')]).then(([k, v]) => k.map((x, i) => [x, v[i]]))]);
    const big = audio.filter(([, b]) => b && b.size > MAX_BLOB).map(([k]) => k);
    await newC.tx(['takes', 'audio'], 'readwrite', async a => {
      for(const t of takes) if(await a.get('takes', t.id) === undefined) await a.put('takes', t);
      for(const [k, b] of audio) if(!big.includes(k) && await a.get('audio', k) === undefined) await a.put('audio', b, k);
    });
    await learnA.tx(['meta'], 'readwrite', a => a.put('meta', { at: Date.now(), takes: takes.length, audio: audio.length - big.length, skippedBig: big }, 'migrated_content_v1'));
    return { takes: takes.length, audio: audio.length - big.length, skippedBig: big };
  }

  // ── The app's learning store + one-time startup work ──────────────────
  let _learn = null, _ready = null, _onError = () => {};
  const learnAdapter = () => idbAdapter(ns('music-learn'), 1, LEARN_STORES);
  function learn(){ return _learn || (_learn = createLearn(learnAdapter(), { onError: m => _onError(m) })); }
  // Resolves when migration (staging) and recovery are done. Never rejects:
  // if storage is blocked the child still plays; learn().health says why.
  function ready(){
    if(_ready) return _ready;
    const L = learn();
    _ready = (async () => {
      const out = {};
      // staging only, on purpose: live builds never shipped music-core, so the
      // un-scoped legacy stores on this shared origin hold STAGING data —
      // copying them into prod would be the contamination plan D1 forbids.
      // Go-live moves progress with an explicit Grown-ups import (PR8).
      if(env() === 'stg'){
        try{ out.log = await migrateLog(L._adapter, idbAdapter('music-eco-log', 1, LEGACY_LOG)); }catch(e){ out.log = { error: String(e && e.message || e) }; _onError('migrate log: ' + out.log.error); }
        try{ out.content = await migrateContent(L._adapter, idbAdapter('music-eco', 1, CONTENT_STORES), content()); }catch(e){ out.content = { error: String(e && e.message || e) }; _onError('migrate content: ' + out.content.error); }
      }
      out.recovered = (await L.recover()).length;
      return out;
    })();
    return _ready;
  }

  // ── Practice log (the API pitch-trainer's modules use) ────────────────
  // Same calls as before, now backed by the env-scoped learning store:
  //   sessions {kind:'song'|'echo'|'today', songId, mode, level, durMs, stars,
  //             notes:[{i,m,dtMs,vel,res}], stats, echo} + the Session fields
  //   items    'song:<id>' | 'echo' | 'card:…' → spaced-repetition / stage state
  const lTx = (names, mode, fn) => ready().then(() => learn()._adapter.tx(names, mode, fn));
  const log = {
    add: s => {
      const ts = Date.now();
      const rec = Object.assign({ app: 'pt', status: 'completed' }, s, {
        id: 'ses_' + ts.toString(36) + rnd(4), schema: SCHEMA, env: env(), ts, day: dayKey(new Date()),
        startedAt: ts - (s.durMs || 0), endedAt: ts, activeMs: s.durMs || 0, attemptCount: (s.notes || []).length,
        pageId: learn().pageId, applied: true, summary: s.stats || {},
      });
      return lTx(['sessions'], 'readwrite', a => a.put('sessions', rec)).then(() => rec);
    },
    // sessions with from ≤ day ≤ to ('YYYY-MM-DD'), oldest first (all apps)
    range: (from, to) => lTx(['sessions'], 'readonly', a => a.all('sessions', 'day', { from, to }))
                           .then(a => (a || []).sort((x, y) => (x.ts || x.startedAt) - (y.ts || y.startedAt))),
    item: key => lTx(['items'], 'readonly', a => a.get('items', key)),
    items: () => lTx(['items'], 'readonly', a => Promise.all([a.keys('items'), a.all('items')]))
                   .then(([k, v]) => Object.fromEntries(k.map((x, i) => [x, v[i]]))),
    setItem: (key, v) => lTx(['items'], 'readwrite', a => a.put('items', v, key)).then(() => v),
  };

  // ── Staff position ────────────────────────────────────────────────────
  // step 0 = bottom line of the G clef (E4); each line/space is one step.
  // Middle C = −2 (one ledger line below), G4 = 2 (2nd line), F3 on the F
  // clef = its 4th line. flats: spell black keys as flats (key of F, B♭…).
  const SPELL_SHARP = [['C',''],['C','♯'],['D',''],['D','♯'],['E',''],['F',''],['F','♯'],['G',''],['G','♯'],['A',''],['A','♯'],['B','']];
  const SPELL_FLAT  = [['C',''],['D','♭'],['D',''],['E','♭'],['E',''],['F',''],['G','♭'],['G',''],['A','♭'],['A',''],['B','♭'],['B','']];
  const DIA = { C:0, D:1, E:2, F:3, G:4, A:5, B:6 };
  function staffStep(m, flats){
    const [letter, acc] = (flats ? SPELL_FLAT : SPELL_SHARP)[pc(m)];
    const oct = octaveOf(m) + (flats && acc === '♭' && letter === 'C' ? 1 : 0);
    return { step: (oct - 4) * 7 + DIA[letter] - 2, letter, acc, oct };
  }
  // the natural (white-key) note sitting on a staff step — inverse of staffStep
  function stepToMidi(step){
    const d = step + 2, oct = 4 + Math.floor(d / 7), i = ((d % 7) + 7) % 7;
    return 12 * (oct + 1) + [0, 2, 4, 5, 7, 9, 11][i];
  }
  // clef offsets: the F clef is drawn on the same 5 lines, 12 steps lower
  // (its bottom line is G2), so F3 sits on the 4th line
  const CLEF_SHIFT = { G: 0, F: -12 };

  // ── Practice helpers (pure) ───────────────────────────────────────────
  // local calendar day, 'YYYY-MM-DD'
  function dayKey(d){
    d = d instanceof Date ? d : new Date(d);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function addDays(day, n){ const [y, m, d] = day.split('-').map(Number); return dayKey(new Date(y, m - 1, d + n)); }
  // consecutive practised days ending today (or yesterday: today isn't over)
  function streak(days, today){
    const set = new Set(days); today = today || dayKey(new Date());
    let d = set.has(today) ? today : addDays(today, -1), n = 0;
    while(set.has(d)){ n++; d = addDays(d, -1); }
    return n;
  }
  // Spaced repetition for a child's songs (SM-2-lite; ts-fsrs would need a
  // build step). 3★ grows the gap, 2★ nudges it, 1★ starts over tomorrow.
  function srsNext(st, stars, today){
    st = { ease: 2.3, intervalD: 0, reps: 0, lapses: 0, ...(st || {}) };
    today = today || dayKey(new Date());
    if(stars >= 3){
      st.intervalD = st.reps === 0 ? 1 : st.reps === 1 ? 3 : Math.round(st.intervalD * st.ease);
      st.reps++; st.ease = Math.min(2.8, st.ease + 0.05);
    } else if(stars === 2){
      st.intervalD = Math.max(1, Math.round((st.intervalD || 1) * 1.2));
    } else {
      st.intervalD = 1; st.reps = 0; st.lapses++; st.ease = Math.max(1.5, st.ease - 0.2);
    }
    st.due = addDays(today, st.intervalD);
    st.last = today; st.lastStars = stars;
    return st;
  }
  // per-note timing of a Play-along run → numbers for the parent page
  // notes: [{dtMs (signed: − early, + late; null = missed), vel (0..127|null)}]
  function timingStats(notes){
    const hit = notes.filter(n => n.dtMs != null), dts = hit.map(n => n.dtMs);
    const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
    const sd = a => { if(a.length < 2) return 0; const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };
    const vels = hit.map(n => n.vel).filter(v => v != null);
    return {
      n: notes.length, hit: hit.length,
      onBeatPct: notes.length ? Math.round(hit.length / notes.length * 100) : 0,
      meanAbsMs: Math.round(mean(dts.map(Math.abs))),
      biasMs: Math.round(mean(dts)),               // − rushing, + dragging
      evennessMs: Math.round(sd(dts)),             // lower = steadier
      velMean: vels.length ? Math.round(mean(vels)) : null,
      velSpread: vels.length ? Math.round(sd(vels)) : null,
    };
  }

  const MusicCore = {
    CORE_VERSION: 1, VERSION, env, ns, adoptKey,
    _setEnv: e => { _env = e; },                   // tests only
    NOTE_NAMES, NOTE_BARE, SOLFEGE, PALETTE,
    pc, octaveOf, midiToFreq, freqToMidiFloat, midiName, midiOf,
    colorOf, isBlack, shapeOf, label,
    LEVELS, getLevel, setLevel,
    makeTake, takeLength, skyline, quantize, beatToSec, secToBeat, estimateTempo, songFromAnalysis,
    autoChords, chordAt, chordTones,
    parseTokens, fromTokens, toTokens,
    BUILTIN, builtinTakes,
    store, log, dayKey, addDays, streak, srsNext, timingStats,
    learn, ready, onStorageError: fn => { _onError = fn || (() => {}); },
    createLearn, memAdapter, idbAdapter, _rangeOf: rangeOf, validateRecord: validate, migrateLog, migrateContent,
    LEARN_STORES, LEGACY_LOG, CONTENT_STORES,
    staffStep, stepToMidi, CLEF_SHIFT,
  };
  if(typeof module !== 'undefined' && module.exports) module.exports = MusicCore;
  else root.MusicCore = MusicCore;
})(typeof window !== 'undefined' ? window : globalThis);
