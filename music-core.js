/* @shared music-core 1.1.0 */
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
  const VERSION = '1.1.0';

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
  const LEVEL_KEY = 'musicEco_level';
  function getLevel(){
    try{ return LEVELS[localStorage.getItem(LEVEL_KEY)] || LEVELS.sprout; }
    catch(e){ return LEVELS.sprout; }
  }
  function setLevel(id){
    try{ localStorage.setItem(LEVEL_KEY, id); }catch(e){}
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

  // ── IndexedDB store (shared across apps on the same origin) ───────────
  const DB_NAME = 'music-eco', DB_VER = 1;
  let _db = null;
  function openDB(){
    if(_db) return _db;
    _db = new Promise((res, rej) => {
      if(typeof indexedDB === 'undefined') return rej(new Error('no indexedDB'));
      const rq = indexedDB.open(DB_NAME, DB_VER);
      rq.onupgradeneeded = () => {
        const db = rq.result;
        if(!db.objectStoreNames.contains('takes')) db.createObjectStore('takes', { keyPath:'id' });
        if(!db.objectStoreNames.contains('audio')) db.createObjectStore('audio');
      };
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => { _db = null; rej(rq.error); };
    });
    return _db;
  }
  function tx(store, mode, fn){
    return openDB().then(db => new Promise((res, rej) => {
      const t = db.transaction(store, mode), s = t.objectStore(store);
      const rq = fn(s);
      t.oncomplete = () => res(rq && rq.result);
      t.onerror = t.onabort = () => rej(t.error);
    }));
  }
  const store = {
    saveTake:  take => tx('takes', 'readwrite', s => s.put(take)).then(() => take),
    getTake:   id   => tx('takes', 'readonly',  s => s.get(id)),
    listTakes: ()   => tx('takes', 'readonly',  s => s.getAll())
                         .then(a => (a || []).sort((x,y) => y.createdAt - x.createdAt)),
    deleteTake:id   => tx('takes', 'readwrite', s => s.delete(id)),
    saveAudio: (id, blob) => tx('audio', 'readwrite', s => s.put(blob, id)).then(() => id),
    getAudio:  id   => tx('audio', 'readonly',  s => s.get(id)),
    deleteAudio: id => tx('audio', 'readwrite', s => s.delete(id)),
  };

  // ── Practice log: a SEPARATE database ─────────────────────────────────
  // Not a v2 of 'music-eco': staging and live share this origin, and live's
  // v1 code would fail with a VersionError once staging upgraded it.
  //   sessions {id, ts, day, kind:'song'|'echo'|'today', songId, mode, level,
  //             durMs, stars, notes:[{i,m,dtMs,vel,res}], stats, echo}
  //   items    key 'song:<id>' | 'echo' → spaced-repetition / stage state
  const LOG_NAME = 'music-eco-log', LOG_VER = 1;
  let _log = null;
  function openLog(){
    if(_log) return _log;
    _log = new Promise((res, rej) => {
      if(typeof indexedDB === 'undefined') return rej(new Error('no indexedDB'));
      const rq = indexedDB.open(LOG_NAME, LOG_VER);
      rq.onupgradeneeded = () => {
        const db = rq.result;
        if(!db.objectStoreNames.contains('sessions')){
          const st = db.createObjectStore('sessions', { keyPath:'id' });
          st.createIndex('day', 'day');
        }
        if(!db.objectStoreNames.contains('items')) db.createObjectStore('items');
      };
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => { _log = null; rej(rq.error); };
    });
    return _log;
  }
  function ltx(st, mode, fn){
    return openLog().then(db => new Promise((res, rej) => {
      const t = db.transaction(st, mode), s = t.objectStore(st);
      const rq = fn(s);
      t.oncomplete = () => res(rq && rq.result);
      t.onerror = t.onabort = () => rej(t.error);
    }));
  }
  const log = {
    add: s => { const rec = { id: 'ses_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                              ts: Date.now(), day: dayKey(new Date()), ...s };
                return ltx('sessions', 'readwrite', st => st.put(rec)).then(() => rec); },
    // sessions with from ≤ day ≤ to ('YYYY-MM-DD'), oldest first
    range: (from, to) => ltx('sessions', 'readonly', st => st.index('day').getAll(IDBKeyRange.bound(from, to)))
                           .then(a => (a || []).sort((x, y) => x.ts - y.ts)),
    item: key => ltx('items', 'readonly', st => st.get(key)),
    items: () => openLog().then(db => new Promise((res, rej) => {
      const t = db.transaction('items', 'readonly'), s = t.objectStore('items'), out = {};
      const rq = s.openCursor();
      rq.onsuccess = () => { const c = rq.result; if(c){ out[c.key] = c.value; c.continue(); } };
      t.oncomplete = () => res(out); t.onerror = () => rej(t.error);
    })),
    setItem: (key, v) => ltx('items', 'readwrite', st => st.put(v, key)).then(() => v),
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
    staffStep, stepToMidi, CLEF_SHIFT,
  };
  if(typeof module !== 'undefined' && module.exports) module.exports = MusicCore;
  else root.MusicCore = MusicCore;
})(typeof window !== 'undefined' ? window : globalThis);
