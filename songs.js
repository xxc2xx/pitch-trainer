/* songs.js — Songs tab: shelf, colour lane / colour staff, follow engine.
   Classic script → window.Songs. Depends on music-core.js.

   const songs = Songs.create({
     host,                 // element the shelf + player render into
     getKb:  () => kb,     // Piano v2 instance (piano.js) — targets/flash/wobble
     getLevel: () => level,
     getLabels: () => 'solfege',
     audio:  () => AudioContext (already resumed inside a gesture),
     playNote(ac, midi, when, dur, {vel, tag}),  // scheduled note (sound.js)
     cancelNotes(tag),                // stop every note scheduled with tag
     click(ac, when, accent),         // metronome click
     avatar: () => dataURL|null,
     onOpen(take) / onClose(),        // index.html adjusts the keyboard
   });
   songs.onKey(m)   — call from the keyboard's note-on
   songs.show() / songs.hide() / songs.refresh()

   Follow modes:
   - wait   : the next key pulses; nothing moves until it's pressed. No timing
              pressure, wrong keys get a gentle wobble — never a buzzer.
   - timed  : 🎵 Play along — the music plays and the notes scroll to the
              line after a one-bar count-in; presses are graded against the
              beat with a per-level window (Sprout: generous, never scored down).
   - demo   : 👂 Listen — the app plays it, the notes scroll, keys light up.
*/
(function(){
  'use strict';
  const MC = window.MusicCore;
  const STICKER_KEY = 'musicEco_stickers';
  const FLAT_KEYS = new Set(['F','Bb','Eb','Ab','Db','Gb']);
  const DIATONIC = { C:0, D:1, E:2, F:3, G:4, A:5, B:6 };
  const SHARP_SPELL = [['C',''],['C','♯'],['D',''],['D','♯'],['E',''],['F',''],['F','♯'],['G',''],['G','♯'],['A',''],['A','♯'],['B','']];
  const FLAT_SPELL  = [['C',''],['D','♭'],['D',''],['E','♭'],['E',''],['F',''],['G','♭'],['G',''],['A','♭'],['A',''],['B','♭'],['B','']];

  const CSS = `
  #songsView{width:100%;max-width:1100px;display:none;flex-direction:column;gap:8px;}
  .sg-shelf h3{font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;color:#6a6a9a;margin:6px 2px;}
  .sg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;}
  .sg-card{background:#16213e;border:2px solid #242448;border-radius:14px;padding:12px 8px;cursor:pointer;
    display:flex;flex-direction:column;align-items:center;gap:4px;color:#e6e6f5;font-weight:700;font-size:.8rem;
    text-align:center;transition:transform .1s,border-color .15s;position:relative;}
  .sg-card:active{transform:scale(.96);}
  .sg-card .ic{font-size:2rem;line-height:1;}
  .sg-card.sg-add{border-style:dashed;border-color:#4a4a8a;background:#121230;}
  .sg-card .st{font-size:.68rem;color:#ffd54f;min-height:1em;}
  .sg-card .dots{display:flex;gap:2px;justify-content:center;flex-wrap:wrap;max-width:100%;}
  .sg-card .dots i{width:7px;height:7px;border-radius:50%;}
  .sg-card .del{position:absolute;top:4px;right:6px;font-size:.7rem;color:#5a5a8a;padding:2px 4px;}
  .sg-empty{font-size:.74rem;color:#4a4a72;padding:4px 2px;}
  .sg-top{display:flex;align-items:center;gap:6px 8px;flex-wrap:wrap;}
  .sg-top .t{flex:1 1 55%;font-weight:800;font-size:.95rem;color:#e6e6f5;text-align:center;}
  .sg-top .sg-ctrl{flex:1 1 100%;}
  @media(min-width:700px){.sg-top .sg-ctrl{flex:0 1 auto;} .sg-top .t{flex:1 1 auto;}}
  @media(orientation:landscape) and (max-height:500px){
    .sg-top .t{display:none;} .sg-top .sg-ctrl{flex:1 1 auto;justify-content:flex-start;}
    .sg-btn{padding:5px 10px;} .sg-ctrl label{display:none;}
  }
  .sg-btn{background:#1e1e3a;border:2px solid #34346a;color:#c8c8f0;border-radius:12px;padding:7px 12px;
    font-size:.8rem;font-weight:700;cursor:pointer;}
  .sg-btn.sel{background:#3a3a7a;color:#fff;border-color:#6a6ad0;}
  .sg-btn.go{background:#e94560;border-color:#e94560;color:#fff;}
  .sg-media video{display:block;max-height:28vh;max-width:100%;margin:0 auto;border-radius:10px;background:#000;}
  @media(orientation:landscape) and (max-height:500px){.sg-media video{max-height:22vh;}}
  .sg-canvas{width:100%;display:block;border-radius:12px;background:#06050f;border:1px solid #14142c;touch-action:pan-y;}
  .sg-ctrl{display:flex;gap:6px;justify-content:center;flex-wrap:wrap;align-items:center;}
  .sg-ctrl label{font-size:.72rem;color:#7a7aa8;display:flex;gap:4px;align-items:center;}
  .sg-ctrl input[type=range]{width:90px;accent-color:#ffd54f;}
  .sg-prog{height:6px;border-radius:3px;background:#14142c;overflow:hidden;}
  .sg-prog i{display:block;height:100%;width:0;background:linear-gradient(90deg,#e53935,#fb8c00,#fdd835,#43a047,#8e24aa);transition:width .25s;}
  .sg-done{position:fixed;inset:0;z-index:50;background:rgba(8,8,20,.86);display:flex;flex-direction:column;
    align-items:center;justify-content:center;gap:14px;animation:sgfade .25s;}
  .sg-done img,.sg-done .emo{width:120px;height:120px;border-radius:20px;image-rendering:pixelated;
    animation:sgdance .5s ease-in-out infinite alternate;font-size:90px;line-height:120px;text-align:center;}
  .sg-done .stars{font-size:2.4rem;letter-spacing:.2em;}
  .sg-done .msg{font-size:1.1rem;font-weight:800;color:#fff;text-align:center;padding:0 16px;}
  .sg-conf{position:fixed;top:-40px;font-size:26px;pointer-events:none;animation:sgfall linear forwards;z-index:51;}
  @keyframes sgfade{from{opacity:0}to{opacity:1}}
  @keyframes sgdance{from{transform:translateY(0) rotate(-6deg)}to{transform:translateY(-14px) rotate(6deg)}}
  @keyframes sgfall{to{transform:translateY(110vh) rotate(540deg)}}
  `;
  function injectCSS(){
    if(document.getElementById('sg-css')) return;
    const s = document.createElement('style'); s.id = 'sg-css'; s.textContent = CSS;
    document.head.appendChild(s);
  }
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
  function readStickers(){
    try{
      const v = JSON.parse(localStorage.getItem(STICKER_KEY) || '{}');
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {};   // storage is user-editable
    }catch(e){ return {}; }
  }
  function addSticker(id){ const s = readStickers(); s[id] = (s[id] || 0) + 1; try{ localStorage.setItem(STICKER_KEY, JSON.stringify(s)); }catch(e){} return s[id]; }
  function mix(hex, toHex, amt){            // amt=1 → hex, amt=0 → toHex
    const p = h => [1,3,5].map(i => parseInt(h.slice(i, i+2), 16));
    const a = p(hex), b = p(toHex);
    return 'rgb(' + a.map((v,i) => Math.round(b[i] + (v - b[i]) * amt)).join(',') + ')';
  }
  // Shift a melody by whole octaves so it sits inside the playable range.
  function fitToRange(notes, range){
    if(!notes.length) return notes;
    const lo = Math.min(...notes.map(n => n.m)), hi = Math.max(...notes.map(n => n.m));
    let shift = 0;
    while(lo + shift < range[0] && hi + shift + 12 <= range[1]) shift += 12;
    while(hi + shift > range[1] && lo + shift - 12 >= range[0]) shift -= 12;
    // a melody wider than the range (Grow take opened at Sprout) can't move
    // as a whole — fold the stragglers note by note so every step has a key
    const span = range[1] - range[0];
    return notes.map(n => {
      let m = n.m + shift;
      if(span >= 11){ while(m < range[0]) m += 12; while(m > range[1]) m -= 12; }
      return m === n.m ? n : { ...n, m };
    });
  }

  // Play-along timing windows in beats: [tight, loose, accept]. A 4-year-old
  // gets most of a beat either side; Grow is closer to a real rhythm game.
  const WINDOWS = { sprout:[0.3, 0.6, 0.8], bloom:[0.15, 0.35, 0.5], grow:[0.12, 0.3, 0.45] };

  const bpbOf = t => t.timeSig ? t.timeSig[0] * 4 / t.timeSig[1] : 4;

  function create(d){
    injectCSS();
    const host = d.host;
    let take = null, notes = [], idx = 0, mode = 'wait', wrong = 0;
    let demo = null, timed = null, camX = 0, raf = 0, bpm = 90;
    let sing = null, sungM = null, hold = 0, needGap = false, gapT = 0;
    let finishT = 0;                       // pending completion — cancelled on leave
    let guideOn = true, runSeq = 0;        // guide = the melody plays along softly
    // Imported songs carry their original recording: it becomes the clock.
    let media = null, mediaUrl = null, rate = 1, loopAB = null, abStage = 0, partOnly = false;
    // 👨‍👧 Together: her MIDI keyboard plays the tune; the screen is Dad's chords
    let together = false, dadChords = [], dadAt = null;
    function later(fn, ms){ clearTimeout(finishT); finishT = setTimeout(fn, ms); }
    let canvas = null, ctx2 = null, progEl = null;
    const judged = new Map();     // note index → 'tight'|'loose'|'miss'|'ok'

    // ── Shelf ───────────────────────────────────────────────────────────
    function card(t, deletable){
      const st = readStickers()[t.id] || 0;
      const dots = MC.skyline(t.notes).slice(0, 14).map(n => `<i style="background:${MC.colorOf(n.m)}"></i>`).join('');
      return `<div class="sg-card" data-id="${esc(t.id)}">
        ${deletable ? '<span class="del" data-del="1" title="Delete">✕</span>' : ''}
        <span class="ic">${t.icon || ({ sing:'🎤', piano:'🎹', video:'🎬', 'audio-file':'🎵', 'midi-file':'📄', musicxml:'📄', 'beat-hive':'🥁' }[t.source] || '🎵')}</span>
        <span>${esc(t.title)}</span><span class="dots">${dots}</span>
        <span class="st">${st ? '⭐'.repeat(Math.min(st, 5)) + (st > 5 ? '+' : '') : ''}</span></div>`;
    }
    let shelfTakes = new Map();
    async function renderShelf(){
      if(together){ together = false; const kb0 = d.getKb(); kb0 && kb0.setDad([]); d.onTogether && d.onTogether(false); }
      stopAll(); pulse(false); stopSing(); dropMedia(); take = null; d.onClose && d.onClose();
      const builtin = MC.builtinTakes();
      let mine = [];
      try{ mine = await MC.store.listTakes(); }catch(e){}
      shelfTakes = new Map([...builtin, ...mine].map(t => [t.id, t]));
      const fromClass = mine.filter(t => t.tag === 'class'), own = mine.filter(t => t.tag !== 'class');
      const addCard = d.addSong ? `<div class="sg-card sg-add" id="sgAdd"><span class="ic">➕</span><span>Add a song</span>
        <span class="st" style="color:#8a8ab8">video · music · MIDI</span></div>` : '';
      // her songs lead; the built-ins are just a starter set
      host.innerHTML = `<div class="sg-shelf">
        <h3>🎒 From class</h3>
        <div class="sg-grid">${addCard}${fromClass.map(t => card(t, true)).join('')}</div>
        ${own.length ? `<h3>🎹 My songs</h3><div class="sg-grid">${own.map(t => card(t, true)).join('')}</div>` : ''}
        <h3>⭐ Starter songs</h3><div class="sg-grid">${builtin.map(t => card(t, false)).join('')}</div>
      </div>`;
      const add = host.querySelector('#sgAdd');
      if(add) add.onclick = () => d.addSong(t => open(t));
      host.querySelectorAll('.sg-card[data-id]').forEach(el => el.addEventListener('click', async e => {
        const t = shelfTakes.get(el.dataset.id); if(!t) return;
        if(e.target.dataset.del){
          e.stopPropagation();
          el.style.opacity = .3;
          try{ await MC.store.deleteTake(t.id); }catch(_){}
          // the raw recording can be MBs — don't strand it in IndexedDB
          if(t.audioId){ try{ await MC.store.deleteAudio(t.audioId); }catch(_){} }
          renderShelf(); return;
        }
        open(t);
      }));
    }

    // ── Player ──────────────────────────────────────────────────────────
    function open(t){
      take = t;
      const level = d.getLevel();
      notes = fitToRange(MC.skyline(t.notes), level.range);
      // practice part set in ✏️ Fix notes: practise just that bit
      partOnly = !!(t.section && t.section.to != null);
      if(partOnly){
        const part = notes.filter(n => n.t >= t.section.from - 1e-6 && n.t < t.section.to);
        if(!part.length) partOnly = false;
        // no recording: the part starts at beat 0, so Play along doesn't sit
        // through empty bars first. With a recording the clock IS the media,
        // so beats stay absolute and the loop handles the part.
        else notes = (t.sync && (t.sync.audioId || t.audioId)) ? part : part.map(n => ({ ...n, t: n.t - t.section.from }));
      }
      // Sprout starts a little slower — rhythm is new
      if(together){ together = false; dadChords = []; dadAt = undefined; const kb0 = d.getKb(); kb0 && kb0.setDad([]); d.onTogether && d.onTogether(false); }
      bpm = Math.round((t.bpm || 90) * (level.id === 'sprout' ? 0.8 : 1)); idx = 0; wrong = 0; judged.clear();
      mode = 'wait';
      d.onOpen && d.onOpen({ ...t, notes });
      host.innerHTML = `
        <div class="sg-top"><button class="sg-btn" id="sgBack">←</button>
          <span class="t">${esc(t.icon || '🎵')} ${esc(t.title)}</span>
          <div class="sg-ctrl">
            <button class="sg-btn" id="sgDemo" title="Hear it and watch the notes">👂 Listen</button>
            <button class="sg-btn go" id="sgTimed" title="The music plays — tap each note as it reaches the line">🎵 Play along</button>
            <button class="sg-btn" id="sgWait" title="The next key glows and waits for you">👆 Step by step</button>
            ${d.mic ? '<button class="sg-btn" id="sgSing">🎤 Sing it</button>' : ''}
            <button class="sg-btn" id="sgTogether" title="Her keyboard plays the tune — the screen keyboard is Dad's chords">👨‍👧 Together</button>
            <button class="sg-btn" id="sgJam" title="Open this song on Beat Hive's pads, at its tempo">🥁 Jam</button>
            <button class="sg-btn sel" id="sgGuide" title="Melody plays along in Play along">🔈</button>
            <button class="sg-btn" id="sgLoop" title="Loop a part: tap at the start, tap at the end, tap again to clear" style="display:none">🔁</button>
            <button class="sg-btn" id="sgBetter" title="Send the recording to your song analyzer for cleaner notes + chords" style="display:none">✨ Better notes</button>
            <button class="sg-btn" id="sgRestart" title="Start over">↺</button>
            ${window.Studio ? '<button class="sg-btn" id="sgEdit" title="Fix wrong notes, set the practice part">✏️ Fix</button>' : ''}
            <label>🐢<input type="range" id="sgTempo" min="40" max="160" value="${bpm}">🐇 <span id="sgBpm">${bpm}</span></label>
          </div></div>
        <div id="sgAnRow" class="sg-ctrl" style="display:none">
          <input id="sgAnUrl" type="text" placeholder="https://<you>-song-analyzer.hf.space" style="flex:1;min-width:220px;background:#0c0c1e;border:1px solid #2c2c5a;border-radius:8px;color:#fff;padding:6px 8px">
          <button class="sg-btn go" id="sgAnGo">Analyze</button></div>
        ${partOnly ? `<div class="sg-ctrl" style="font-size:.75rem;color:#ffd54f">⟦ Practice part: bars ${Math.floor(t.section.from / bpbOf(t)) + 1}–${Math.ceil(t.section.to / bpbOf(t))} ⟧ <button class="sg-btn" id="sgWhole">Whole song</button></div>` : ''}
        <div class="sg-prog"><i id="sgProg"></i></div>
        <div id="sgMedia" class="sg-media"></div>
        <canvas class="sg-canvas" id="sgCanvas"></canvas>`;
      canvas = host.querySelector('#sgCanvas'); ctx2 = canvas.getContext('2d');
      progEl = host.querySelector('#sgProg');
      host.querySelector('#sgBack').onclick = renderShelf;
      host.querySelector('#sgRestart').onclick = () => startMode(mode);
      // stopping Listen goes back to step-by-step from the top, guide key lit
      host.querySelector('#sgDemo').onclick = () => { if(demo) startMode('wait'); else startDemo(); };
      host.querySelector('#sgWait').onclick = () => startMode('wait');
      const tb = host.querySelector('#sgTimed'); if(tb) tb.onclick = () => { if(timed){ startMode('wait'); } else startMode('timed'); };
      const sb = host.querySelector('#sgSing'); if(sb) sb.onclick = toggleSing;
      const gb = host.querySelector('#sgGuide');
      gb.onclick = () => { guideOn = !guideOn; gb.classList.toggle('sel', guideOn); gb.textContent = guideOn ? '🔈' : '🔇'; };
      const tr = host.querySelector('#sgTempo');
      if(tr) tr.oninput = () => {
        if(media){ rate = +tr.value / 100; media.playbackRate = rate; host.querySelector('#sgBpm').textContent = tr.value + '%'; }
        else { bpm = +tr.value; host.querySelector('#sgBpm').textContent = bpm; }
      };
      host.querySelector('#sgLoop').onclick = setLoop;
      const wb = host.querySelector('#sgWhole'); if(wb) wb.onclick = () => open({ ...t, section: null });
      const eb = host.querySelector('#sgEdit'); if(eb) eb.onclick = openStudio;
      host.querySelector('#sgTogether').onclick = () => setTogether(!together);
      // same origin → Beat Hive reads this song from the shared library
      host.querySelector('#sgJam').onclick = () => { stopAll(); window.open('../beat-hive/?song=' + encodeURIComponent(t.id), '_blank'); };
      host.querySelector('#sgBetter').onclick = betterNotes;
      host.querySelector('#sgAnGo').onclick = () => {
        const u = host.querySelector('#sgAnUrl').value.trim();
        if(!/^https:\/\//.test(u) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(u)) { host.querySelector('#sgAnUrl').style.borderColor = '#e94560'; return; }
        try{ localStorage.setItem(AN_KEY, u); }catch(e){}
        host.querySelector('#sgAnRow').style.display = 'none';
        betterNotes();
      };
      canvas.onclick = seekTo;
      sizeCanvas(); pulse(true);
      startMode('wait');
      loadMedia(t);
    }

    // ── Original recording (video / audio) ──────────────────────────────
    function dropMedia(){
      if(media){ try{ media.pause(); }catch(e){} media.removeAttribute('src'); media = null; }
      if(mediaUrl){ URL.revokeObjectURL(mediaUrl); mediaUrl = null; }
      loopAB = null; abStage = 0; rate = 1;
    }
    async function loadMedia(t){
      dropMedia();
      const id = t.sync && (t.sync.audioId || t.audioId);
      if(!id) return;
      let blob = null; try{ blob = await MC.store.getAudio(id); }catch(e){}
      if(!blob || take !== t) return;                       // gone, or user moved on
      const isVideo = t.sync.kind === 'video' || /^video\//.test(blob.type);
      const el = document.createElement(isVideo ? 'video' : 'audio');
      mediaUrl = URL.createObjectURL(blob);
      el.src = mediaUrl; el.preload = 'auto'; el.playsInline = true;
      el.preservesPitch = true; el.webkitPreservesPitch = true;   // slow down, same pitch
      if(isVideo){ el.muted = false; host.querySelector('#sgMedia').appendChild(el); }
      media = el;
      // the slider becomes speed (50–100 %), the guide melody is the original itself
      const tr = host.querySelector('#sgTempo');
      if(tr){ tr.min = 50; tr.max = 100; tr.value = 100; host.querySelector('#sgBpm').textContent = '100%'; }
      const gb = host.querySelector('#sgGuide'); if(gb) gb.style.display = 'none';
      host.querySelector('#sgLoop').style.display = '';
      if(partOnly){                                         // the saved part loops on the recording
        loopAB = { from: t.section.from, to: t.section.to }; abStage = 2;
        const lb = host.querySelector('#sgLoop'); lb.textContent = '🔁 Part'; lb.classList.add('sel');
      }
      if(window.Hear && Hear.analyzeRemote) host.querySelector('#sgBetter').style.display = '';
      if(t.analyzed){ const bb = host.querySelector('#sgBetter'); bb.textContent = '✨ Analyzed'; bb.title = 'Analyzed by the song analyzer — tap to run again'; }
      const dt = host.querySelector('#sgDemo'); if(dt) dt.textContent = isVideo ? '▶ Watch' : '👂 Listen';
    }
    // ✨ Better notes: full-band separation + melody + beats + chords on the
    // user's own HF Space (~/song-analyzer). On-device notes stay if it fails.
    const AN_KEY = 'musicEco_analyzerUrl';
    async function betterNotes(){
      const t = take, b = host.querySelector('#sgBetter');
      let url = ''; try{ url = localStorage.getItem(AN_KEY) || ''; }catch(e){}
      if(!url){ host.querySelector('#sgAnRow').style.display = 'flex'; host.querySelector('#sgAnUrl').focus(); return; }
      const id = t.sync && (t.sync.audioId || t.audioId);
      let blob = null; try{ blob = await MC.store.getAudio(id); }catch(e){}
      if(!blob){ b.textContent = '✨ No recording'; return; }
      stopAll();
      const label = { preparing: '✨ Preparing…', uploading: '✨ Uploading…', queued: '✨ Analyzing… (up to a minute)' };
      b.disabled = true; b.textContent = label.preparing;
      try{
        const res = await Hear.analyzeRemote(url, blob, { onPhase: ph => { if(take === t) b.textContent = label[ph] || b.textContent; } });
        const better = MC.songFromAnalysis(t, res);
        if(better.notes.length < 4) throw new Error('the analyzer found no clear tune');
        await MC.store.saveTake(better);
        if(take === t) open(better);
      }catch(e){
        b.disabled = false; b.textContent = '✨ Try again'; b.title = 'Last try: ' + e.message;
        if(/address|https/.test(e.message)) { try{ localStorage.removeItem(AN_KEY); }catch(_){} }
        console.warn('[songs] analyzer:', e.message);
      }
    }

    // ✏️ Fix notes (studio.js) takes over this panel; the keyboard stays below
    function openStudio(){
      const t = take;
      stopAll(); stopSing(); pulse(false); dropMedia();
      d.onClose && d.onClose();
      Studio.open(host, t, {
        audio: d.audio,
        playNote: (m, when, dur, o) => d.playNote(d.audio(), m, when, dur, o),
        cancelNotes: d.cancelNotes,
        range: d.range,
        onSave: async edited => {
          // a starter song is saved as her own copy; the built-in stays as is
          if(edited.source === 'builtin') edited = MC.makeTake({ ...edited, id: null, createdAt: Date.now(),
            source: 'edited', title: edited.title + ' (my version)' });
          try{ await MC.store.saveTake(edited); }catch(e){}
          open(edited);
        },
        onClose: () => open(t),
      });
    }

    function setTogether(on){
      together = on;
      const b = host.querySelector('#sgTogether'); if(b) b.classList.toggle('sel', on);
      if(on){
        const given = take.parts && take.parts.chords && take.parts.chords.length ? take.parts.chords : null;
        dadChords = given
          ? given.map(c => ({ ...c, ms: c.ms || MC.chordTones(c.root, c.minor) }))
          : MC.autoChords({ ...take, notes });           // no chords in the song: harmonise the tune
      } else { dadChords = []; }
      dadAt = undefined;
      d.onTogether && d.onTogether(on);
      updateDad(curBeat()); draw();
    }
    function updateDad(beat){
      const kb = d.getKb(); if(!kb) return;
      const c = together ? MC.chordAt(dadChords, beat) : null;
      if(c === dadAt) return;
      dadAt = c; kb.setDad(c ? c.ms : []);
    }

    function curBeat(){
      const run = timed || demo;
      if(run) return nowBeat(run);
      return notes[Math.min(idx, notes.length - 1)] ? notes[Math.min(idx, notes.length - 1)].t : 0;
    }
    // 🔁: tap = loop starts here, tap = ends here, tap = clear
    function setLoop(){
      const b = host.querySelector('#sgLoop');
      if(abStage === 0){ loopAB = { from: Math.floor(curBeat()), to: null }; abStage = 1; b.textContent = '🔁 A…'; b.classList.add('sel'); }
      else if(abStage === 1){
        const to = Math.ceil(curBeat());
        if(to <= loopAB.from + 1){ return; }
        loopAB.to = to; abStage = 2; b.textContent = '🔁 A–B';
      } else { loopAB = null; abStage = 0; b.textContent = '🔁'; b.classList.remove('sel'); }
    }
    // tap the note strip: jump there (playing) or move the next step there (step mode)
    function seekTo(e){
      if(!take) return;
      const x = e.clientX - canvas.getBoundingClientRect().left;   // offsetX is unreliable
      const beat = (x + camX - 70) / ppb();
      const run = timed || demo;
      if(run && run.media){
        run.media.currentTime = Math.max(0, MC.beatToSec(take, beat - 0.5));
        notes.forEach((n, i) => { if(n.t >= beat - 0.5) judged.delete(i); });
      } else if(!run){
        const i = notes.findIndex(n => n.t >= beat - 0.25);
        if(i >= 0){ idx = i; progress(); target(); animateTo(); }
      }
    }

    function sizeCanvas(){
      if(!canvas) return;
      const lane = d.getLevel().see === 'lane';
      // short landscape phones: keep the keyboard on screen
      const short = window.innerHeight < 500;
      const w = canvas.clientWidth || 360, h = lane ? (short ? 92 : 150) : (short ? 120 : 170);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      canvas.style.height = h + 'px';
      ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    }

    function setBtns(){
      if(!canvas) return;
      const q = id => host.querySelector(id);
      q('#sgWait') && q('#sgWait').classList.toggle('sel', mode === 'wait');
      q('#sgTimed') && q('#sgTimed').classList.toggle('sel', mode === 'timed');
      q('#sgDemo') && (q('#sgDemo').textContent = demo ? '⏹ Stop' : '👂 Listen');
      q('#sgTimed') && (q('#sgTimed').textContent = timed ? '⏹ Stop' : '🎵 Play along');
    }

    function stopAll(){
      if(demo){
        // every demo note was scheduled up front — cancel them, don't let the
        // song play out under whatever comes next
        demo.stop = true; d.cancelNotes && d.cancelNotes(demo.tag);
        demo = null;
      }
      if(timed){
        timed.stop = true;
        d.cancelNotes && d.cancelNotes(timed.tag);
        try{ timed.bus.disconnect(); }catch(e){}     // silence a count-in still queued
        timed = null;
      }
      cancelAnimationFrame(raf); raf = 0;
      clearTimeout(finishT); finishT = 0;
      if(media){ try{ media.pause(); }catch(e){} }
      const kb = d.getKb(); kb && kb.setTarget(null);
    }

    function startMode(m){
      stopAll(); idx = 0; wrong = 0; judged.clear();
      if(m === 'timed'){ mode = 'timed'; startTimed(); }
      else { mode = 'wait'; target(); }
      setBtns(); progress(); animateTo();
    }

    function target(){
      const kb = d.getKb(); if(!kb) return;
      kb.setTarget(idx < notes.length ? notes[idx].m : null);
      if(together && notes[idx]) updateDad(notes[idx].t);
    }
    function progress(){ if(progEl) progEl.style.width = (notes.length ? idx / notes.length * 100 : 0) + '%'; }

    // ── Input from the keyboard ─────────────────────────────────────────
    function onKey(m){
      if(!take || demo) return;
      const kb = d.getKb();
      if(mode === 'wait'){
        if(idx >= notes.length) return;
        if(m === notes[idx].m){
          kb && kb.flash(m); judged.set(idx, 'ok');
          idx++; progress(); target(); animateTo();
          if(idx >= notes.length) later(finish, 450);
        } else { wrong++; kb && kb.wobble(m); }
        return;
      }
      if(mode === 'timed' && timed && timed.running){
        const beat = nowBeat(timed);
        let best = -1, bestDt = 1e9;
        notes.forEach((n, i) => {
          if(judged.has(i) || n.m !== m) return;
          const dt = Math.abs(n.t - beat);
          if(dt < bestDt){ bestDt = dt; best = i; }
        });
        const W = timed.W;
        if(best >= 0 && bestDt <= W[2]){
          judged.set(best, bestDt <= W[0] ? 'tight' : bestDt <= W[1] ? 'loose' : 'ok');
          kb && kb.flash(m);
        } else { kb && kb.wobble(m); }
      }
    }

    // ── Sing-along: her voice moves the song forward ────────────────────
    // Octave-agnostic and ±1 semitone: a 4-year-old rarely sings in the
    // written octave, and close counts. Hold ~200 ms to advance; a repeated
    // note (C C) needs a breath/dip in between so one long note can't skip two.
    async function toggleSing(){
      if(sing){ stopSing(); return; }
      if(mode !== 'wait') startMode('wait');
      try{ sing = await d.mic(onSung); }
      catch(e){ const b = host.querySelector('#sgSing'); b && (b.textContent = '🎤 ' + e.message.slice(0, 24)); return; }
      const b = host.querySelector('#sgSing'); b && (b.classList.add('sel'), b.textContent = '🎤 Singing…');
    }
    function stopSing(){
      if(sing){ try{ sing.stop(); }catch(e){} sing = null; }
      sungM = null; hold = 0;
      const b = host && host.querySelector('#sgSing'); b && (b.classList.remove('sel'), b.textContent = '🎤 Sing it');
    }
    function onSung(mf){
      sungM = mf;
      if(mode !== 'wait' || demo || idx >= notes.length){ return; }
      const now = performance.now();
      if(mf == null){ needGap = false; hold = 0; return; }
      if(needGap && now - gapT < 450) return;
      needGap = false;
      const diff = ((mf - notes[idx].m) % 12 + 18) % 12 - 6;
      if(Math.abs(diff) <= 1){
        hold += 30;
        if(hold >= 200){
          hold = 0; needGap = true; gapT = now;
          const kb = d.getKb(); kb && kb.flash(notes[idx].m);
          judged.set(idx, 'ok'); idx++; progress(); target(); animateTo();
          if(idx >= notes.length){ stopSing(); later(finish, 450); }
        }
      } else hold = Math.max(0, hold - 15);
      if(d.getLevel().see !== 'lane') return;
    }

    // ── Clock: Listen and Play along both scroll with the music ─────────
    // Notes move right→left at tempo; the dotted line is "now". Everything
    // is scheduled on the AudioContext clock, the screen just follows it.
    function nowBeat(run){
      run = run || timed || demo;
      if(!run) return 0;
      if(run.media) return MC.secToBeat(take, run.media.currentTime);   // the recording is the clock
      return (d.audio().currentTime - run.t0) / (60 / run.bpm);
    }
    // keep a loop going; returns true when it jumped
    function keepLoop(run, beat){
      if(!run.media || !loopAB || loopAB.to == null || beat < loopAB.to) return false;
      run.media.currentTime = Math.max(0, MC.beatToSec(take, loopAB.from - 0.5));
      notes.forEach((n, i) => { if(n.t >= loopAB.from - 0.5 && n.t < loopAB.to) judged.delete(i); });
      return true;
    }
    function playMedia(fromBeat){
      media.playbackRate = rate;
      media.currentTime = Math.max(0, MC.beatToSec(take, fromBeat));
      const p = media.play();
      // the browser can refuse (autoplay rules, interrupted audio session):
      // don't sit there saying "Stop" over silence — reset and say so
      if(p && p.catch) p.catch(() => {
        startMode('wait');
        const b = host.querySelector('#sgDemo'); if(b){ b.textContent = '▶ Tap again'; }
      });
    }

    function startDemo(){
      stopAll(); stopSing();               // the mic would hear the demo through the speaker
      const ac = d.audio(), spb = 60 / bpm, t0 = ac.currentTime + 0.4;
      demo = { t0, bpm, tag: 'demo' + (++runSeq), stop: false, last: -1, media };
      if(media) playMedia(loopAB ? loopAB.from - 0.5 : -1);                 // her original video/song
      else notes.forEach(n => d.playNote(ac, n.m, t0 + n.t * spb, n.d * spb, { vel: 85, tag: demo.tag }));
      const len = MC.takeLength({ notes });
      const run = demo;
      const tick = () => {
        if(run.stop) return;
        const beat = nowBeat(run);
        let i = -1; notes.forEach((n, k) => { if(n.t <= beat + 1e-3) i = k; });
        updateDad(beat);
        if(i !== run.last && i >= 0){
          run.last = i; idx = i; progress();
          const kb = d.getKb(); kb && (kb.setTarget(notes[i].m), kb.flash(notes[i].m));
        }
        if(keepLoop(run, beat)) run.last = -1;
        camX = xOf(Math.max(-1, beat)) - camLead();
        draw(beat);
        if(beat > len + 0.5 || (run.media && run.media.ended)){ stopAll(); startMode('wait'); return; }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      setBtns();
    }

    function startTimed(){
      stopSing();
      const ac = d.audio(), spb = 60 / bpm, lv = d.getLevel().id, W = WINDOWS[lv] || WINDOWS.bloom;
      const bar = (take.timeSig ? take.timeSig[0] * 4 / take.timeSig[1] : 4);
      const t0 = ac.currentTime + 0.3 + bar * spb;           // one-bar count-in
      const bus = ac.createGain(); bus.connect(ac.destination);
      timed = { t0, bpm, running: true, stop: false, bus, tag: 'play' + (++runSeq), W, media };
      if(media){
        // the original IS the music; its own intro is the count-in
        playMedia((loopAB ? loopAB.from : (notes[0] ? notes[0].t : 0)) - bar);
      } else {
        for(let b = 0; b < bar; b++) d.click(ac, t0 - (bar - b) * spb, b === 0, bus);
        // the "music": melody softly underneath so she hears what to play
        if(guideOn) notes.forEach(n => d.playNote(ac, n.m, t0 + n.t * spb, n.d * spb, { vel: 90, tag: timed.tag, soft: true }));
      }
      const len = MC.takeLength({ notes });
      const run = timed;
      const tick = () => {
        if(run.stop) return;
        const beat = nowBeat(run);
        keepLoop(run, beat);
        updateDad(beat);
        notes.forEach((n, i) => { if(!judged.has(i) && beat > n.t + W[2]) judged.set(i, 'miss'); });
        const next = notes.findIndex((n, i) => !judged.has(i));
        idx = next < 0 ? notes.length : next; progress();
        const kb = d.getKb();
        // Sprout always sees the next key; others only as it arrives
        const lead = lv === 'sprout' ? 99 : 1;
        if(kb) kb.setTarget(notes[idx] && notes[idx].t - beat < lead ? notes[idx].m : null);
        camX = xOf(Math.max(-bar, beat)) - camLead();
        draw(beat);
        if((beat > len + 0.6 || (run.media && run.media.ended)) && !(loopAB && loopAB.to != null)){ run.running = false; finish(); return; }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }

    // ── Finish + reward ─────────────────────────────────────────────────
    function finish(){
      if(!take) return;
      const level = d.getLevel();
      let stars = 3;
      if(level.id !== 'sprout'){
        if(mode === 'timed'){
          const pts = notes.reduce((s, n, i) => s + ({ tight:1, loose:.8, ok:.5 }[judged.get(i)] || 0), 0);
          const pct = notes.length ? pts / notes.length : 0;
          stars = pct >= .9 ? 3 : pct >= .65 ? 2 : 1;
        } else stars = wrong <= 1 ? 3 : wrong <= 4 ? 2 : 1;
      }
      const wasTimed = mode === 'timed';
      const onBeat = notes.reduce((c, _, i) => c + (/tight|loose|ok/.test(judged.get(i) || '') ? 1 : 0), 0);
      stopAll(); setBtns();
      const n = addSticker(take.id);
      const av = d.avatar && d.avatar();
      const ov = document.createElement('div'); ov.className = 'sg-done';
      ov.innerHTML = `<div class="emo">🦀</div>
        <div class="stars">${'⭐'.repeat(stars)}${'☆'.repeat(3 - stars)}</div>
        <div class="msg">You played ${esc(take.title)}!${wasTimed ? `<br><small style="color:#9fe8b0">🎯 ${onBeat} of ${notes.length} notes on the beat</small>` : ''}${n > 1 ? `<br><small style="color:#ffd54f">${n} times now 🏅</small>` : ''}</div>
        <div class="sg-ctrl"><button class="sg-btn go" data-a="again">↺ Again</button>
        <button class="sg-btn" data-a="shelf">🎵 Songs</button></div>`;
      // stored data goes in as a property, never as markup
      if(av && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(av)){
        const img = document.createElement('img'); img.alt = ''; img.src = av;
        ov.querySelector('.emo').replaceWith(img);
      }
      document.body.appendChild(ov);
      const conf = ['🎉','⭐','🎵','🌈','✨','🎈'];
      for(let i = 0; i < 26; i++){
        const c = document.createElement('span'); c.className = 'sg-conf';
        c.textContent = conf[i % conf.length];
        c.style.left = Math.random() * 100 + 'vw';
        c.style.animationDuration = (1.6 + Math.random() * 1.6) + 's';
        c.style.animationDelay = (Math.random() * .6) + 's';
        document.body.appendChild(c); setTimeout(() => c.remove(), 4000);
      }
      ov.addEventListener('click', e => {
        const a = e.target.dataset.a; if(!a) return;
        ov.remove();
        if(a === 'again') startMode(mode); else renderShelf();
      });
    }

    // ── Drawing ─────────────────────────────────────────────────────────
    function ppb(){ const w = canvas ? canvas.clientWidth : 360; return Math.max(46, Math.min(96, w / 7)); }
    function camLead(){ return (canvas ? canvas.clientWidth : 360) * 0.3; }
    function xOf(beat){ return 70 + beat * ppb(); }
    function animateTo(){
      if(timed || demo) return;                  // the clock drives the camera
      const want = xOf(notes[Math.min(idx, notes.length - 1)] ? notes[Math.min(idx, notes.length - 1)].t : 0) - camLead();
      cancelAnimationFrame(raf);
      draw();                                     // immediate frame even if rAF is throttled
      const step = () => {
        camX += (want - camX) * 0.18;
        draw();
        if(Math.abs(want - camX) > 0.5) raf = requestAnimationFrame(step); else { camX = want; draw(); }
      };
      raf = requestAnimationFrame(step);
    }

    function draw(beat){
      if(!canvas || !ctx2) return;
      const W = canvas.clientWidth, H = parseFloat(canvas.style.height) || 160, g = ctx2;
      g.clearRect(0, 0, W, H);
      const level = d.getLevel();
      if(level.see === 'lane') drawLane(g, W, H, beat); else drawStaff(g, W, H, level, beat);
      const chords = together ? dadChords : (take && take.parts && take.parts.chords);
      if(chords && chords.length){
        g.font = 'bold 12px sans-serif'; g.textAlign = 'left';
        chords.forEach(c => {
          const x = xOf(c.t) - camX; if(x < 44 || x > W) return;
          const now = together && c === dadAt;
          g.fillStyle = now ? '#7ec8ff' : 'rgba(255,213,79,.9)';
          g.fillText((now ? '👨 ' : '') + c.label, x, 13);
        });
      }
    }

    function shapePath(g, shape, x, y, r){
      g.beginPath();
      if(shape === 'circle') g.arc(x, y, r, 0, Math.PI * 2);
      else if(shape === 'square'){ const s = r * 0.9; g.roundRect ? g.roundRect(x - s, y - s, s * 2, s * 2, 4) : g.rect(x - s, y - s, s * 2, s * 2); }
      else { g.moveTo(x, y - r * 1.1); g.lineTo(x + r * 1.05, y + r * 0.8); g.lineTo(x - r * 1.05, y + r * 0.8); g.closePath(); }
    }

    // Sprout: big colour shapes on a contour lane — higher notes sit higher.
    function drawLane(g, W, H, beat){
      const hitX = camLead(), P = ppb(), mid = H / 2;
      g.strokeStyle = '#2a2a50'; g.setLineDash([4, 6]); g.lineWidth = 2;
      g.beginPath(); g.moveTo(hitX, 8); g.lineTo(hitX, H - 8); g.stroke(); g.setLineDash([]);
      const ms = notes.map(n => n.m), lo = Math.min(...ms), hi = Math.max(...ms);
      const span = Math.min(34, H / 2 - 26);
      const yOf = m => hi === lo ? mid : mid + span - (m - lo) / (hi - lo) * span * 2;
      const pulse = 1 + 0.08 * Math.sin(performance.now() / 160);
      notes.forEach((n, i) => {
        const x = xOf(n.t) - camX; if(x < -60 || x > W + 60) return;
        // Play along: done = judged (✓ on a hit; a miss just fades — no red ✗
        // for a pre-schooler). Listen/step: done = already played.
        const verdict = timed ? judged.get(i) : null;
        const done = timed ? judged.has(i) : demo ? i < idx : i < idx;
        const hit = done && verdict !== 'miss', cur = i === idx;
        const y = yOf(n.m), col = MC.colorOf(n.m);
        g.globalAlpha = done ? 0.22 : 0.35;
        g.fillStyle = col;
        g.beginPath(); (g.roundRect ? g.roundRect(x, y - 7, Math.max(0, n.d * P - 22), 14, 7) : g.rect(x, y - 7, Math.max(0, n.d * P - 22), 14)); g.fill();
        g.globalAlpha = done ? 0.25 : 1;
        const r = (cur ? 25 * pulse : 19) * Math.min(1, H / 140);
        if(cur){ g.shadowColor = col; g.shadowBlur = 24; }
        shapePath(g, MC.shapeOf(n.m), x, y, r); g.fill();
        g.shadowBlur = 0;
        if(done && hit){ g.globalAlpha = .8; g.fillStyle = '#fff'; g.font = 'bold 16px sans-serif'; g.textAlign = 'center'; g.fillText('✓', x, y + 6); }
      });
      g.globalAlpha = 1;
      if(sing && sungM != null && notes[idx]){
        const t = notes[idx].m, diff = ((sungM - t) % 12 + 18) % 12 - 6;
        const close = Math.abs(diff) <= 1, vy = yOf(t) - diff * 6;
        g.fillStyle = close ? '#7CFC9A' : '#ffffff';
        g.shadowColor = g.fillStyle; g.shadowBlur = 14;
        g.beginPath(); g.arc(hitX - 34, vy, 7 + Math.min(6, hold / 40), 0, Math.PI * 2); g.fill();
        g.shadowBlur = 0;
        g.font = '15px sans-serif'; g.textAlign = 'center'; g.fillText('🎤', hitX - 34, vy - 14);
      }
    }
    // Keep the Sprout lane's current-note pulse breathing (cheap redraw).
    let pulseT = 0;
    function pulse(on){
      clearInterval(pulseT); pulseT = 0;
      if(on && d.getLevel().see === 'lane') pulseT = setInterval(() => { if(take && !timed) draw(); }, 70);
    }

    // Bloom / Grow: treble staff, colour noteheads fading by level.
    function drawStaff(g, W, H, level, beat){
      const LS = 12, base = Math.round(H * 0.6) + 2, P = ppb(), amt = level.colorAmt;
      const yOf = step => base - step * LS / 2;
      const flats = FLAT_KEYS.has(take && take.key);
      const labels = d.getLabels ? d.getLabels() : level.labels;
      // bar lines
      const bpb = take && take.timeSig ? take.timeSig[0] * 4 / take.timeSig[1] : 4;
      const len = MC.takeLength({ notes });
      g.strokeStyle = '#2c2c52'; g.lineWidth = 1.4;
      for(let b = bpb; b < len + 0.01; b += bpb){
        const x = xOf(b) - camX - P * 0.32; if(x < 40 || x > W) continue;
        g.beginPath(); g.moveTo(x, yOf(8)); g.lineTo(x, yOf(0)); g.stroke();
      }
      // current-note glow column
      const cur = notes[idx];
      if(cur && (mode === 'wait' || demo)){
        const x = xOf(cur.t) - camX;
        g.fillStyle = mix(MC.colorOf(cur.m), '#06050f', 0.28);
        g.beginPath(); (g.roundRect ? g.roundRect(x - 20, 10, 40, H - 20, 10) : g.rect(x - 20, 10, 40, H - 20)); g.fill();
      }
      if(mode === 'timed' && timed){
        const x = xOf(beat) - camX;
        g.strokeStyle = '#ffd54f'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(x, 12); g.lineTo(x, H - 12); g.stroke();
      }
      notes.forEach((n, i) => {
        const x = xOf(n.t) - camX; if(x < 40 || x > W + 30) return;
        const [letter, acc] = (flats ? FLAT_SPELL : SHARP_SPELL)[MC.pc(n.m)];
        const oct = MC.octaveOf(n.m) + (flats && acc === '♭' && letter === 'C' ? 1 : 0);
        const step = (oct - 4) * 7 + DIATONIC[letter] - 2, y = yOf(step);
        const done = i < idx || judged.has(i);
        const verdict = judged.get(i);
        let col = mix(MC.colorOf(n.m), '#e6e6f0', amt);
        g.globalAlpha = done && mode === 'wait' ? 0.45 : 1;
        // ledger lines
        g.strokeStyle = '#4a4a78'; g.lineWidth = 1.4;
        for(let s = -2; s >= step; s -= 2){ g.beginPath(); g.moveTo(x - 12, yOf(s)); g.lineTo(x + 12, yOf(s)); g.stroke(); }
        for(let s = 10; s <= step; s += 2){ g.beginPath(); g.moveTo(x - 12, yOf(s)); g.lineTo(x + 12, yOf(s)); g.stroke(); }
        // head
        const hollow = n.d >= 2;
        g.save(); g.translate(x, y); g.rotate(-0.33);
        g.beginPath(); g.ellipse(0, 0, 7.6, 5.4, 0, 0, Math.PI * 2);
        if(hollow){ g.strokeStyle = col; g.lineWidth = 2.4; g.stroke(); }
        else { g.fillStyle = col; g.fill(); }
        g.restore();
        // stem + flags
        if(n.d < 4){
          const up = step < 4, sx = up ? x + 6.8 : x - 6.8, sy2 = up ? y - 32 : y + 32;
          g.strokeStyle = col; g.lineWidth = 1.8;
          g.beginPath(); g.moveTo(sx, y); g.lineTo(sx, sy2); g.stroke();
          const flags = n.d <= 0.25 ? 2 : n.d <= 0.5 ? 1 : 0;
          for(let f = 0; f < flags; f++){
            const fy = sy2 + (up ? f * 7 : -f * 7);
            g.beginPath(); g.moveTo(sx, fy); g.quadraticCurveTo(sx + 10, fy + (up ? 8 : -8), sx + 8, fy + (up ? 16 : -16)); g.stroke();
          }
        }
        if([0.75, 1.5, 3].includes(n.d)){ g.fillStyle = col; g.beginPath(); g.arc(x + 12, y - 2, 1.8, 0, Math.PI * 2); g.fill(); }
        if(acc){ g.fillStyle = col; g.font = '16px serif'; g.textAlign = 'center'; g.fillText(acc, x - 15, y + 5); }
        // label under the staff
        if(labels === 'solfege' || labels === 'letter' || labels === 'color'){
          const txt = labels === 'letter' ? letter + (acc || '') : labels === 'solfege' ? MC.label(n.m, 'solfege') : '';
          if(labels === 'color'){ g.fillStyle = MC.colorOf(n.m); shapePath(g, MC.shapeOf(n.m), x, H - 18, 6); g.fill(); }
          else { g.fillStyle = mix(MC.colorOf(n.m), '#9a9ac0', Math.max(amt, .5)); g.font = 'bold 11px sans-serif'; g.textAlign = 'center'; g.fillText(txt, x, H - 12); }
        }
        if(verdict && mode === 'timed'){
          g.fillStyle = { tight:'#22c55e', loose:'#e2b714', ok:'#e2b714', miss:'#ef4444' }[verdict];
          g.beginPath(); g.arc(x, yOf(-5), 4, 0, Math.PI * 2); g.fill();
        }
        g.globalAlpha = 1;
      });
      // staff lines + clef on top, clef panel masks notes scrolling under it
      g.fillStyle = '#06050f'; g.fillRect(0, 0, 42, H);
      g.strokeStyle = '#3a3a66'; g.lineWidth = 1.3;
      for(let s = 0; s <= 8; s += 2){ g.beginPath(); g.moveTo(4, yOf(s)); g.lineTo(W - 4, yOf(s)); g.stroke(); }
      g.fillStyle = '#6a6aa0'; g.font = '58px "Times New Roman",serif'; g.textAlign = 'left';
      g.fillText('𝄞', 2, base + 9);
    }

    window.addEventListener('resize', () => { if(take) sizeCanvas(); });

    return {
      show(){ host.style.display = 'flex'; if(!take) renderShelf(); else { sizeCanvas(); pulse(true); setBtns(); progress(); target(); } },
      hide(){
        stopAll(); pulse(false); stopSing(); host.style.display = 'none';
        if(window.Studio) Studio.pause();
        if(mode === 'timed'){ mode = 'wait'; idx = 0; judged.clear(); }   // timed can't resume mid-song
      },
      refresh(){ if(take) open(take); else renderShelf(); },
      onKey,
      get open(){ return !!take; },
      get media(){ return media; },
      get together(){ return together; },                 // the original recording (tests, Studio)
      openTake: open,
    };
  }

  window.Songs = { create, fitToRange };
})();
