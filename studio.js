/* studio.js — ✏️ Fix notes: a small piano-roll editor for a song.
   Classic script → window.Studio. Depends on music-core.js.

   Studio.open(host, song, {
     audio: () => AudioContext,         // resumed inside a tap
     playNote(m, when, dur, {tag}),     // sound.js schedule
     cancelNotes(tag),
     range: () => [lo, hi] | null,      // her keyboard (midi.js), for Easy mode
     onSave(song), onClose(),
   })
   Studio.onKey(m)   — keyboard/MIDI note-on while open: sets the selected
                       note's pitch (fix by ear: hear the original, press the
                       right key), or auditions when nothing is selected.
   Studio.active

   Transcriptions are never perfect; this is what makes them playable.
*/
(function(){
  'use strict';
  const MC = window.MusicCore;
  const CSS = `
  .st-wrap{display:flex;flex-direction:column;gap:8px;width:100%;}
  .st-top{display:flex;gap:6px;flex-wrap:wrap;align-items:center;}
  .st-top .t{flex:1;font-weight:800;color:#e6e6f5;min-width:120px;}
  .st-btn{background:#1e1e3a;border:2px solid #34346a;color:#c8c8f0;border-radius:10px;padding:6px 10px;font-size:.78rem;font-weight:700;cursor:pointer;}
  .st-btn.go{background:#2e7d32;border-color:#2e7d32;color:#fff;}
  .st-btn.sel{background:#3a3a7a;color:#fff;border-color:#6a6ad0;}
  .st-btn:disabled{opacity:.35;cursor:default;}
  .st-roll{width:100%;height:260px;display:block;border-radius:12px;background:#07061a;border:1px solid #1c1c3c;touch-action:none;cursor:crosshair;}
  .st-tools{display:flex;gap:4px;flex-wrap:wrap;justify-content:center;min-height:36px;align-items:center;}
  .st-hint{font-size:.72rem;color:#8a8ab8;text-align:center;}
  @media(orientation:landscape) and (max-height:500px){.st-roll{height:150px;}}`;
  function injectCSS(){ if(document.getElementById('st-css')) return; const s = document.createElement('style'); s.id = 'st-css'; s.textContent = CSS; document.head.appendChild(s); }
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
  const clone = o => JSON.parse(JSON.stringify(o));

  let S = null;          // current session

  function open(host, song, d){
    injectCSS();
    d = d || {};
    const s = S = { host, d, song: clone(song), notes: clone(song.notes).sort((a, b) => a.t - b.t),
      sel: -1, hist: [], ppb: 48, scroll: 0, play: null, media: null, url: null, env: null, section: song.section ? clone(song.section) : null,
      tag: 'studio' + Date.now() };
    host.innerHTML = `<div class="st-wrap">
      <div class="st-top">
        <button class="st-btn" id="stCancel">← Back</button>
        <span class="t">✏️ ${esc(song.title)}</span>
        <button class="st-btn" id="stPlay">▶ Play</button>
        <button class="st-btn" id="stUndo" disabled>↶ Undo</button>
        <button class="st-btn" id="stEasy" title="Drop tiny notes, merge split notes, fit to her keyboard">🪄 Easy</button>
        <button class="st-btn" id="stFrom" title="Practice part starts at the playhead">⟦ From</button>
        <button class="st-btn" id="stTo" title="Practice part ends at the playhead">To ⟧</button>
        <button class="st-btn go" id="stSave">✓ Save</button>
      </div>
      <canvas class="st-roll" id="stRoll"></canvas>
      <div class="st-tools" id="stTools"></div>
      <div class="st-hint" id="stHint">Tap a note, then press the right key to fix it · double-tap to add · drag to scroll</div>
    </div>`;
    const $ = id => host.querySelector('#' + id);
    s.canvas = $('stRoll'); s.g = s.canvas.getContext('2d');
    $('stCancel').onclick = () => close(false);
    $('stSave').onclick = () => close(true);
    $('stUndo').onclick = undo;
    $('stEasy').onclick = easy;
    $('stPlay').onclick = () => s.play ? stop() : play();
    $('stFrom').onclick = () => { snap(); s.section = { from: Math.floor(s.head || 0), to: s.section && s.section.to > (s.head || 0) ? s.section.to : null }; draw(); };
    $('stTo').onclick = () => { snap(); const to = Math.ceil(s.head || 0); s.section = { from: s.section ? s.section.from : 0, to }; if(s.section.to <= s.section.from) s.section = null; draw(); };
    wirePointer();
    size(); s.head = s.notes[0] ? s.notes[0].t : 0; s.scroll = Math.max(0, s.head - 2);
    loadMedia(); tools(); draw();
    window.addEventListener('resize', size);
  }

  // ── Original recording + loudness envelope (so you can see the notes) ─
  async function loadMedia(){
    const s = S, id = s.song.sync && (s.song.sync.audioId || s.song.audioId);
    if(!id) return;
    let blob = null; try{ blob = await MC.store.getAudio(id); }catch(e){}
    if(!blob || S !== s) return;
    s.url = URL.createObjectURL(blob);
    s.media = new Audio(s.url); s.media.preload = 'auto'; s.media.preservesPitch = true;
    try{
      // offline decode: no gesture or audio session needed (Codex P1)
      const buf = await Hear.decode(await blob.arrayBuffer());
      const x = buf.getChannelData(0), sr = buf.sampleRate, step = Math.floor(sr * 0.05), env = [];
      for(let i = 0; i < x.length; i += step){ let a = 0; for(let j = i; j < Math.min(i + step, x.length); j++) a += x[j] * x[j]; env.push(Math.sqrt(a / step)); }
      const mx = Math.max(...env, 1e-6); s.env = env.map(v => v / mx); s.envStep = 0.05;
      if(S === s) draw();
    }catch(e){ /* no envelope — still editable */ }
  }

  // ── Geometry ──────────────────────────────────────────────────────────
  function size(){
    const s = S; if(!s) return;
    const w = s.canvas.clientWidth || 600, h = s.canvas.clientHeight || 260, dpr = Math.min(2, window.devicePixelRatio || 1);
    s.canvas.width = w * dpr; s.canvas.height = h * dpr; s.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    s.W = w; s.H = h; s.ppb = Math.max(36, Math.min(80, w / 12));
    draw();
  }
  function pitchSpan(){
    const ms = S.notes.map(n => n.m);
    const lo = (ms.length ? Math.min(...ms) : 60) - 2, hi = (ms.length ? Math.max(...ms) : 72) + 2;
    return [lo, Math.max(hi, lo + 12)];
  }
  const LEFT = 34, TOP = 16;
  function xOf(b){ return LEFT + (b - S.scroll) * S.ppb; }
  function bOf(x){ return (x - LEFT) / S.ppb + S.scroll; }
  function rowH(){ const [lo, hi] = pitchSpan(); return (S.H - TOP - 6) / (hi - lo + 1); }
  function yOf(m){ const [, hi] = pitchSpan(); return TOP + (hi - m) * rowH(); }
  // row for pitch m spans [hi-m, hi-m+1) row-heights below TOP
  function mOf(y){ const [, hi] = pitchSpan(); return hi - Math.floor((y - TOP) / rowH()); }

  function draw(){
    const s = S; if(!s || !s.g) return;
    const g = s.g, W = s.W, H = s.H, [lo, hi] = pitchSpan(), rh = rowH();
    g.clearRect(0, 0, W, H);
    for(let m = lo; m <= hi; m++){                        // piano-key rows
      g.fillStyle = MC.isBlack(m) ? '#0b0a20' : '#100f28';
      g.fillRect(LEFT, yOf(m), W - LEFT, rh);
      if(m % 12 === 0){ g.fillStyle = '#6a6aa0'; g.font = '10px sans-serif'; g.textAlign = 'right'; g.fillText(MC.midiName(m), LEFT - 4, yOf(m) + rh * 0.75); }
    }
    if(s.env){                                            // loudness of the original, under the notes
      g.fillStyle = 'rgba(120,140,255,.14)';
      for(let x = LEFT; x < W; x += 2){
        const sec = MC.beatToSec(s.song, bOf(x)), i = Math.floor(sec / s.envStep);
        const v = s.env[i] || 0; const h = v * (H - TOP) * 0.9;
        g.fillRect(x, H - h, 2, h);
      }
    }
    if(s.section){                                        // practice part
      g.fillStyle = 'rgba(255,213,79,.08)';
      const a = xOf(s.section.from), b = s.section.to != null ? xOf(s.section.to) : W;
      g.fillRect(a, 0, b - a, H);
      g.fillStyle = '#ffd54f'; g.fillRect(a, 0, 2, H); if(s.section.to != null) g.fillRect(b - 2, 0, 2, H);
    }
    const bpb = s.song.timeSig ? s.song.timeSig[0] * 4 / s.song.timeSig[1] : 4;
    for(let b = Math.floor(s.scroll); xOf(b) < W; b++){   // beat / bar lines
      if(b < 0) continue;
      g.fillStyle = b % bpb === 0 ? '#3a3a6a' : '#1c1c3a'; g.fillRect(xOf(b), TOP, 1, H - TOP);
      if(b % bpb === 0){ g.fillStyle = '#6a6aa0'; g.font = '10px sans-serif'; g.textAlign = 'left'; g.fillText(String(b / bpb + 1), xOf(b) + 2, 11); }
    }
    s.notes.forEach((n, i) => {
      const x = xOf(n.t), w = Math.max(4, n.d * s.ppb - 2), y = yOf(n.m);
      if(x + w < LEFT || x > W) return;
      g.fillStyle = MC.colorOf(n.m);
      g.globalAlpha = i === s.sel ? 1 : 0.85;
      g.beginPath(); (g.roundRect ? g.roundRect(x, y + 1, w, rh - 2, 4) : g.rect(x, y + 1, w, rh - 2)); g.fill();
      if(i === s.sel){ g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke(); }
      g.globalAlpha = 1;
    });
    g.fillStyle = '#ff5c7a'; g.fillRect(xOf(s.head || 0), TOP, 2, H - TOP);   // playhead
  }

  // ── Editing ───────────────────────────────────────────────────────────
  function snap(){ S.hist.push({ notes: clone(S.notes), section: clone(S.section) }); if(S.hist.length > 60) S.hist.shift(); S.host.querySelector('#stUndo').disabled = false; }
  function undo(){
    const h = S.hist.pop(); if(!h) return;
    S.notes = h.notes; S.section = h.section; S.sel = -1;
    S.host.querySelector('#stUndo').disabled = !S.hist.length; tools(); draw();
  }
  function sortKeep(){ const cur = S.notes[S.sel]; S.notes.sort((a, b) => a.t - b.t || a.m - b.m); S.sel = cur ? S.notes.indexOf(cur) : -1; }
  function edit(fn){ if(S.sel < 0) return; snap(); fn(S.notes[S.sel]); sortKeep(); tools(); draw(); }
  function tools(){
    const s = S, el = s.host.querySelector('#stTools');
    if(s.sel < 0){ el.innerHTML = ''; return; }
    const n = s.notes[s.sel];
    el.innerHTML = `<span style="color:${MC.colorOf(n.m)};font-weight:800;margin-right:6px">${MC.midiName(n.m)} · ${MC.label(n.m, 'solfege')}</span>` +
      [['up','⬆','Higher'],['down','⬇','Lower'],['left','⇠','Earlier'],['right','⇢','Later'],['short','⟵','Shorter'],['long','⟶','Longer'],['split','✂','Split in two'],['del','🗑','Delete']]
        .map(([k, ic, tt]) => `<button class="st-btn" data-k="${k}" title="${tt}">${ic}</button>`).join('');
    el.querySelectorAll('[data-k]').forEach(b => b.onclick = () => {
      const k = b.dataset.k;
      if(k === 'del'){ snap(); s.notes.splice(s.sel, 1); s.sel = -1; tools(); draw(); return; }
      edit(n => {
        if(k === 'up') n.m++; else if(k === 'down') n.m--;
        else if(k === 'left') n.t = Math.max(0, n.t - 0.25); else if(k === 'right') n.t += 0.25;
        else if(k === 'short') n.d = Math.max(0.25, n.d - 0.25); else if(k === 'long') n.d += 0.25;
        else if(k === 'split' && n.d >= 0.5){ const h = Math.round(n.d / 2 * 4) / 4; s.notes.push({ ...n, t: n.t + h, d: n.d - h }); n.d = h; }
      });
      audition(s.notes[s.sel] && s.notes[s.sel].m);
    });
  }
  function noteAt(x, y){
    const b = bOf(x), m = mOf(y);
    return S.notes.findIndex(n => n.m === m && b >= n.t - 0.05 && b <= n.t + n.d + 0.05);
  }
  function wirePointer(){
    const s = S, c = s.canvas;
    let down = null, lastTap = 0;
    // client coords minus the box — offsetX/Y are unreliable (seen wrong in testing)
    const pos = e => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    c.onpointerdown = e => {
      try{ c.setPointerCapture(e.pointerId); }catch(_){}   // can throw (e.g. pointer already gone) — never abort the tap
      const p = pos(e); down = { x: p.x, y: p.y, scroll: s.scroll, moved: false };
    };
    c.onpointermove = e => {
      if(!down) return;
      const dx = pos(e).x - down.x;
      if(Math.abs(dx) > 6) down.moved = true;
      if(down.moved){ s.scroll = Math.max(-1, down.scroll - dx / s.ppb); draw(); }
    };
    c.onpointerup = e => {
      if(!down) return;
      const wasMove = down.moved; down = null;
      if(wasMove) return;
      const p = pos(e), i = noteAt(p.x, p.y), now = performance.now();
      if(i >= 0){ s.sel = i; audition(s.notes[i].m); }
      else if(now - lastTap < 350){                       // double-tap empty: add a note
        snap();
        const n = { m: mOf(p.y), t: Math.max(0, Math.round(bOf(p.x) * 4) / 4), d: 1, v: 0.8 };
        s.notes.push(n); s.notes.sort((a, b) => a.t - b.t); s.sel = s.notes.indexOf(n); audition(n.m);
      } else { s.sel = -1; s.head = Math.max(0, bOf(p.x)); if(s.play) seekPlay(); }
      lastTap = now; tools(); draw();
    };
    c.onwheel = e => { e.preventDefault(); s.scroll = Math.max(-1, s.scroll + (e.deltaX || e.deltaY) / s.ppb); draw(); };
  }

  // 🪄 Easy: drop slivers, merge split repeats, fit to her keyboard
  function easy(){
    const s = S; snap();
    let ns = s.notes.filter(n => n.d >= 0.24);
    const out = [];
    ns.forEach(n => {
      const p = out[out.length - 1];
      if(p && p.m === n.m && n.t - (p.t + p.d) < 0.05 && p.d < 1 && n.d < 1) p.d = n.t + n.d - p.t;   // split → one note
      else out.push({ ...n });
    });
    const r = s.d.range && s.d.range();
    const fit = !!(r && r[1] - r[0] >= 11);           // a learned range narrower than an octave isn't her whole keyboard
    if(fit){
      const lo = Math.min(...out.map(n => n.m)), hi = Math.max(...out.map(n => n.m));
      let sh = 0;
      while(lo + sh < r[0] && hi + sh + 12 <= r[1]) sh += 12;
      while(hi + sh > r[1] && lo + sh - 12 >= r[0]) sh -= 12;
      out.forEach(n => { n.m += sh; while(n.m < r[0]) n.m += 12; while(n.m > r[1]) n.m -= 12; });
    }
    s.notes = out; s.sel = -1; tools(); draw();
    const k = s.hist[s.hist.length - 1].notes.length - out.length;
    s.host.querySelector('#stHint').textContent = `🪄 ${k} note${k === 1 ? '' : 's'} tidied` + (fit ? ' · fitted to her keyboard' : '') + ' — ↶ to undo';
  }

  // ── Playback: the original (if any) + the notes, from the playhead ────
  function audition(m){
    if(m == null || !S.d.audio) return;
    const ac = S.d.audio(); S.d.playNote(m, ac.currentTime + 0.01, 0.45, { tag: S.tag + 'a' });
  }
  function play(){
    const s = S, ac = s.d.audio(), from = Math.max(-0.5, s.head || 0);
    stop();
    const startSec = MC.beatToSec(s.song, from), t0 = ac.currentTime + 0.1;
    s.play = { from, t0, startSec, tag: s.tag + 'p' + Date.now() };
    if(s.media){ s.media.currentTime = Math.max(0, startSec); const p = s.media.play(); if(p && p.catch) p.catch(() => {}); }
    // notes softly with the original (or alone), on the same timeline
    s.notes.forEach(n => {
      const at = MC.beatToSec(s.song, n.t) - startSec; if(at < -0.05) return;
      const dur = MC.beatToSec(s.song, n.t + n.d) - MC.beatToSec(s.song, n.t);
      s.d.playNote(n.m, t0 + Math.max(0, at), Math.max(0.1, dur), { tag: s.play.tag, soft: !!s.media });
    });
    s.host.querySelector('#stPlay').textContent = '⏸ Stop';
    const run = s.play;
    const tick = () => {
      if(S !== s || s.play !== run) return;
      const sec = s.media ? s.media.currentTime : startSec + (ac.currentTime - t0);
      s.head = MC.secToBeat(s.song, sec);
      if(xOf(s.head) > s.W - 60) s.scroll = s.head - 2;
      draw();
      const endB = s.section && s.section.to != null ? s.section.to : (s.notes.length ? s.notes[s.notes.length - 1].t + s.notes[s.notes.length - 1].d + 1 : 4);
      if(s.head > endB || (s.media && s.media.ended)){ stop(); return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  function seekPlay(){ play(); }
  function stop(){
    const s = S; if(!s) return;
    if(s.play){ s.d.cancelNotes && s.d.cancelNotes(s.play.tag); s.play = null; }
    if(s.media) try{ s.media.pause(); }catch(e){}
    const b = s.host.querySelector('#stPlay'); if(b) b.textContent = '▶ Play';
  }

  function close(save){
    const s = S; if(!s) return;
    stop();
    window.removeEventListener('resize', size);
    if(s.url) URL.revokeObjectURL(s.url);
    S = null;
    if(save){
      const out = MC.makeTake({ ...s.song, notes: s.notes, section: s.section });
      s.d.onSave && s.d.onSave(out);
    } else s.d.onClose && s.d.onClose();
  }

  window.Studio = {
    open,
    get active(){ return !!S; },
    pause(){ if(S) stop(); },
    get _s(){ return S; },                         // test hook (read-only use)
    // keyboard / MIDI while editing: fix the selected note's pitch, else audition
    onKey(m){
      if(!S) return false;
      if(S.sel >= 0){ snap(); S.notes[S.sel].m = m; tools(); draw(); }
      return true;
    },
  };
})();
