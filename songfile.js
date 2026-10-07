/* songfile.js — exact song imports: Standard MIDI Files and MusicXML.
   Classic script → window.SongFile; also a node module for tools/core-test.mjs.
   Depends on music-core.js (MusicCore).

   SongFile.parseMidi(arrayBuffer, meta)   → Song (Take)
   SongFile.parseMusicXML(doc|text, meta)  → Song (Take)   (uncompressed .musicxml/.xml)

   These are the "no transcription errors" path: a public-domain MIDI or
   MusicXML of her song gives exact notes; the audio path (hear.js) guesses.
   Melody choice for multi-track files: a track/part literally named
   melody/vocal/voice/right/RH wins; otherwise the busiest non-drum track
   with the highest average pitch — the tune usually sits on top.
*/
(function(root){
  'use strict';
  const MC = root.MusicCore || (typeof require !== 'undefined' ? require('./music-core.js') : null);
  const MELODY_NAME = /melod|vocal|voice|lead|sing|right|\brh\b|treble|soprano/i;

  // ── MIDI (SMF type 0/1) ───────────────────────────────────────────────
  function parseMidi(buf, meta){
    const d = new DataView(buf instanceof ArrayBuffer ? buf : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    let p = 0;
    const str = n => { let s = ''; for(let i = 0; i < n; i++) s += String.fromCharCode(d.getUint8(p + i)); p += n; return s; };
    const u32 = () => { const v = d.getUint32(p); p += 4; return v; };
    const u16 = () => { const v = d.getUint16(p); p += 2; return v; };
    const vlq = () => { let v = 0, b; do { b = d.getUint8(p++); v = (v << 7) | (b & 0x7f); } while(b & 0x80); return v; };
    if(str(4) !== 'MThd') throw new Error('Not a MIDI file');
    const hlen = u32(); const fmt = u16(), ntrk = u16(), div = u16(); p += hlen - 6;
    if(div & 0x8000) throw new Error('SMPTE-timed MIDI is not supported');
    const ppq = div;
    let tempoUs = 500000, timeSig = [4, 4], keySig = null;
    const tracks = [];
    for(let t = 0; t < ntrk && p < d.byteLength; t++){
      const id = str(4), len = u32(), end = p + len;
      if(id !== 'MTrk'){ p = end; continue; }
      let tick = 0, status = 0, name = '';
      const open = new Map(), notes = [];
      while(p < end){
        tick += vlq();
        let b = d.getUint8(p);
        if(b & 0x80){ status = b; p++; }               // else: running status
        const type = status & 0xf0, ch = status & 0x0f;
        if(status === 0xff){                           // meta
          const mt = d.getUint8(p++), ml = vlq(), at = p;
          if(mt === 0x03) name = str(ml);
          else if(mt === 0x51 && ml === 3) tempoUs = (d.getUint8(at) << 16) | (d.getUint8(at+1) << 8) | d.getUint8(at+2);
          else if(mt === 0x58 && ml >= 2) timeSig = [d.getUint8(at), Math.pow(2, d.getUint8(at+1))];
          else if(mt === 0x59 && ml >= 2) keySig = [d.getInt8(at), d.getUint8(at+1)];
          p = at + ml;
        } else if(status === 0xf0 || status === 0xf7){ p += vlq(); }   // sysex
        else if(type === 0x90 || type === 0x80){
          const m = d.getUint8(p++), v = d.getUint8(p++);
          const k = ch * 128 + m;
          if(type === 0x90 && v > 0){ open.set(k, { m, v, tick, ch }); }
          else if(open.has(k)){ const o = open.get(k); open.delete(k); notes.push({ m, ch, v: o.v, t0: o.tick, t1: tick }); }
        }
        else if(type === 0xa0 || type === 0xb0 || type === 0xe0){ p += 2; }
        else if(type === 0xc0 || type === 0xd0){ p += 1; }
        else { p = end; }                              // malformed — skip track
      }
      p = end;
      tracks.push({ name, notes });
    }
    // drums live on channel 10 (index 9)
    const cands = tracks.map(tr => ({ ...tr, notes: tr.notes.filter(n => n.ch !== 9) })).filter(tr => tr.notes.length);
    if(!cands.length) throw new Error('No notes found in this MIDI file');
    const avg = tr => tr.notes.reduce((s, n) => s + n.m, 0) / tr.notes.length;
    const named = cands.find(tr => MELODY_NAME.test(tr.name));
    const busy = cands.filter(tr => tr.notes.length >= Math.min(8, Math.max(...cands.map(c => c.notes.length))));
    const pick = named || busy.sort((a, b) => avg(b) - avg(a))[0];
    let notes = pick.notes.map(n => ({ m: n.m, t: n.t0 / ppq, d: Math.max(1 / 16, (n.t1 - n.t0) / ppq), v: n.v / 127 }));
    notes = MC.skyline(notes.sort((a, b) => a.t - b.t));
    const bpm = Math.round(60000000 / tempoUs);
    const sharpsToKey = s => ['Cb','Gb','Db','Ab','Eb','Bb','F','C','G','D','A','E','B','F#','C#'][s + 7] || 'C';
    // track names are "Melody"/"Piano 1" — not song titles; the caller names it
    return MC.makeTake({ title: (meta && meta.title) || 'MIDI song', source: 'midi-file',
      bpm, timeSig, key: keySig ? sharpsToKey(keySig[0]) : 'C',
      notes, ...(meta || {}) });             // file timing kept as-is (pickup bars stay aligned)
  }

  // ── MusicXML (partwise, uncompressed) ─────────────────────────────────
  const STEP = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 };
  function parseMusicXML(input, meta){
    let doc = input;
    if(typeof input === 'string'){
      const DP = root.DOMParser || (typeof require !== 'undefined' ? require('@xmldom/xmldom').DOMParser : null);
      doc = new DP().parseFromString(input, 'application/xml');
    }
    const kids = (el, tag) => Array.from(el.childNodes || []).filter(n => n.nodeType === 1 && n.nodeName === tag);
    const kid = (el, tag) => kids(el, tag)[0] || null;
    const txt = (el, tag) => { const k = kid(el, tag); return k ? k.textContent.trim() : null; };
    const all = (el, tag) => Array.from(el.getElementsByTagName(tag));
    const score = doc.documentElement;
    if(!score || !/score-partwise/.test(score.nodeName)){
      if(score && /score-timewise/.test(score.nodeName)) throw new Error('Timewise MusicXML — re-export as partwise');
      throw new Error('Not a MusicXML score (export as uncompressed .musicxml)');
    }
    const names = {};
    all(score, 'score-part').forEach(sp => { names[sp.getAttribute('id')] = (txt(sp, 'part-name') || '') + ' ' + (txt(sp, 'part-abbreviation') || ''); });
    const parts = kids(score, 'part').map(part => {
      let div = 1, pos = 0, bpm = null, timeSig = null, fifths = null;
      const notes = []; let lastStart = 0;
      kids(part, 'measure').forEach(meas => {
        Array.from(meas.childNodes).forEach(el => {
          if(el.nodeType !== 1) return;
          if(el.nodeName === 'attributes'){
            const dv = txt(el, 'divisions'); if(dv) div = +dv;
            const tm = kid(el, 'time'); if(tm && !timeSig) timeSig = [+txt(tm, 'beats'), +txt(tm, 'beat-type')];
            const ky = kid(el, 'key'); if(ky && fifths == null) fifths = +txt(ky, 'fifths');
          } else if(el.nodeName === 'direction' || el.nodeName === 'sound'){
            const snd = el.nodeName === 'sound' ? el : all(el, 'sound')[0];
            if(snd && snd.getAttribute('tempo') && !bpm) bpm = Math.round(+snd.getAttribute('tempo'));
          } else if(el.nodeName === 'backup'){ pos -= (+txt(el, 'duration') || 0) / div; }
          else if(el.nodeName === 'forward'){ pos += (+txt(el, 'duration') || 0) / div; }
          else if(el.nodeName === 'note'){
            if(kid(el, 'grace')) return;                       // ornaments carry no time
            const dur = (+txt(el, 'duration') || 0) / div;
            const voice = txt(el, 'voice') || '1';
            const isChord = !!kid(el, 'chord');
            const start = isChord ? lastStart : pos;
            if(!isChord) pos += dur;
            if(voice !== '1' || isChord || kid(el, 'rest')) { if(!isChord) lastStart = start; return; }
            lastStart = start;
            const pt = kid(el, 'pitch'); if(!pt) return;
            const m = 12 * (+txt(pt, 'octave') + 1) + STEP[txt(pt, 'step')] + (+(txt(pt, 'alter') || 0));
            const ties = kids(el, 'tie').map(t => t.getAttribute('type'));
            const prev = notes[notes.length - 1];
            if(ties.includes('stop') && prev && prev.m === m && Math.abs(prev.t + prev.d - start) < 1e-6){ prev.d += dur; return; }
            notes.push({ m, t: start, d: dur, v: 0.8 });
          }
        });
      });
      return { id: part.getAttribute('id'), name: names[part.getAttribute('id')] || '', notes, bpm, timeSig, fifths };
    }).filter(p => p.notes.length);
    if(!parts.length) throw new Error('No notes found in this score');
    const avg = p => p.notes.reduce((s, n) => s + n.m, 0) / p.notes.length;
    const pick = parts.find(p => MELODY_NAME.test(p.name)) || parts.slice().sort((a, b) => avg(b) - avg(a))[0];
    const fifths = pick.fifths || 0;
    const key = ['Cb','Gb','Db','Ab','Eb','Bb','F','C','G','D','A','E','B','F#','C#'][fifths + 7] || 'C';
    const workTitle = all(score, 'work-title')[0] || all(score, 'movement-title')[0];
    return MC.makeTake({ title: (meta && meta.title) || (workTitle && workTitle.textContent.trim()) || 'Sheet song',
      source: 'musicxml', bpm: pick.bpm || parts.find(p => p.bpm)?.bpm || 96,
      timeSig: pick.timeSig || [4, 4], key, notes: MC.skyline(pick.notes), ...(meta || {}) });
  }

  // ── Writer (for tests, and later "export MIDI") ───────────────────────
  function writeMidi(take){
    const ppq = 480, bytes = [];
    const push = (...b) => bytes.push(...b);
    const vlq = v => { const out = [v & 0x7f]; while((v >>= 7)) out.unshift((v & 0x7f) | 0x80); return out; };
    const evs = [];
    take.notes.forEach(n => {
      evs.push({ tick: Math.round(n.t * ppq), on: true, m: n.m, v: Math.round((n.v || .8) * 127) });
      evs.push({ tick: Math.round((n.t + n.d) * ppq), on: false, m: n.m, v: 0 });
    });
    evs.sort((a, b) => a.tick - b.tick || (a.on - b.on));
    const trk = [];
    const us = Math.round(60000000 / (take.bpm || 120));
    trk.push(0, 0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255);
    const ts = take.timeSig || [4,4];
    trk.push(0, 0xff, 0x58, 4, ts[0], Math.log2(ts[1]), 24, 8);
    const nm = take.trackName || 'Melody'; trk.push(0, 0xff, 0x03, nm.length, ...Array.from(nm).map(c => c.charCodeAt(0)));
    let last = 0;
    evs.forEach(e => { trk.push(...vlq(e.tick - last), e.on ? 0x90 : 0x80, e.m, e.v); last = e.tick; });
    trk.push(0, 0xff, 0x2f, 0);
    const u32 = v => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
    push(0x4d,0x54,0x68,0x64, ...u32(6), 0,0, 0,1, (ppq >> 8) & 255, ppq & 255);
    push(0x4d,0x54,0x72,0x6b, ...u32(trk.length), ...trk);
    return new Uint8Array(bytes);
  }

  const SongFile = { parseMidi, parseMusicXML, writeMidi };
  if(typeof module !== 'undefined' && module.exports) module.exports = SongFile;
  else root.SongFile = SongFile;
})(typeof window !== 'undefined' ? window : globalThis);
