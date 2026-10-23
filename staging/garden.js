/* garden.js — Music Garden, the kid-facing app (garden.html).
   Classic script → window.Garden. Depends on music-core.js, hear.js, midi.js, sound.js.

   Screens: home · book (her Yamaha book tunes) · song (Listen / Learn / Play!) ·
   quiz (read the staff) · free piano · done · grown-ups (press-and-hold gate).

   Song screen
     Listen  the app plays the tune; the playhead walks the staff.
     Learn   no beat: the next note shines (and its key glows if hints are on)
             and waits until she plays it.
     Play!   Taiko-style: count-in clicks, the playhead moves on the beat and
             every note gets a verdict from her timing + note name:
               great ≤ 110 ms · good ≤ 230 ms · ok (early/late, still in the
               window) · wrong (wrong key) · miss (nothing played).
             Her notes are recorded so "Hear me" replays them over the beat.
   Input: on-screen keys, computer keys (A S D F…), her MIDI keyboard
   (Chrome on the Mac), or the microphone listening to any piano (iPad).
   Only the note NAME is judged, not the octave.
*/
(function(){
  'use strict';
  const MC = window.MusicCore;
  const $ = (s) => document.querySelector(s);
  const now = () => performance.now() / 1000;

  /* ── Her book, in class order (fixed do: do = C). [midi, beats], null = rest ── */
  const SONGS = [
    { id: 'drd', title: 'Do Re Do', clef: 'G', time: 'C', notes: [[60,1],[62,1],[60,1],[null,1]] },
    { id: 'drm', title: 'Up to Mi', clef: 'G', time: 'C', notes: [[60,1],[62,1],[64,1],[null,1]] },
    { id: 'mrd', title: 'Down from Mi', clef: 'G', time: 'C', notes: [[64,1],[62,1],[60,1],[null,1]] },
    { id: 'hcb', title: 'Hot Cross Buns', clef: 'G', time: [2,4],
      notes: [[64,1],[62,1],[60,1],[null,1],[64,1],[62,1],[60,1],[null,1],[60,1],[60,1],[62,1],[62,1],[64,1],[62,1],[60,1],[null,1]] },
    { id: 'fa', title: 'Up to Fa and back', clef: 'G', time: 'C', notes: [[60,1],[62,1],[64,1],[65,1],[64,1],[62,1],[60,1],[null,1]] },
    { id: 'sol', title: 'Steps to Sol', clef: 'G', time: 'C',
      notes: [[60,1],[62,1],[64,1],[null,1],[64,1],[65,1],[67,1],[null,1],[67,1],[65,1],[64,1],[null,1],[64,1],[62,1],[60,1],[null,1]] },
    { id: 'hill', title: 'Five-finger hill', clef: 'G', time: 'C', notes: [[60,1],[62,1],[64,1],[65,1],[67,4],[67,1],[65,1],[64,1],[62,1],[60,4]] },
    { id: 'low', title: 'Low hill (left hand)', clef: 'F', time: 'C', notes: [[48,1],[50,1],[52,1],[53,1],[55,4],[55,1],[53,1],[52,1],[50,1],[48,4]] },
  ];
  const beatsPerBar = (song) => song.time === 'C' ? 4 : song.time[0];
  function targetsOf(song){
    let beat = 0; const out = [];
    song.notes.forEach(([m, b], i) => { if(m != null) out.push({ i, m, beat, b }); beat += b; });
    return out;
  }
  const songBeats = (song) => song.notes.reduce((a, n) => a + n[1], 0);

  /* ── Scoring (pure) ── */
  const WIN = { great: 110, good: 230 };
  const POINTS = { great: 100, good: 75, ok: 40, wrong: 0, miss: 0 };
  function verdictOf(dtMs, wrongTry){
    const a = Math.abs(dtMs);
    let v = a <= WIN.great ? 'great' : a <= WIN.good ? 'good' : 'ok';
    if(wrongTry) v = v === 'great' ? 'good' : 'ok';
    return v;
  }
  function scoreOf(judged){
    if(!judged.length) return 0;
    return Math.round(judged.reduce((a, j) => a + POINTS[j ? j.v : 'miss'], 0) / judged.length);
  }
  const berriesFor = (pct) => pct >= 85 ? 3 : pct >= 60 ? 2 : pct >= 30 ? 1 : 0;
  function timingSummary(judged){
    const dts = judged.filter(j => j && j.dt != null && j.v !== 'wrong').map(j => j.dt);
    if(dts.length < 2) return { bias: 0, sd: 0, n: dts.length, text: '' };
    const mean = dts.reduce((a, b) => a + b, 0) / dts.length;
    const sd = Math.sqrt(dts.reduce((a, b) => a + (b - mean) ** 2, 0) / dts.length);
    const text = Math.abs(mean) < 45 ? 'Right on the beat!'
      : mean < 0 ? 'A little early — wait for the click.' : 'A little late — get ready a bit sooner.';
    return { bias: Math.round(mean), sd: Math.round(sd), n: dts.length, text };
  }
  // two wrong answers for a note: nearest scale neighbours first, all different names
  function distractors(m, pool, rnd){
    rnd = rnd || Math.random;
    const same = pool.filter(x => (x < 60) === (m < 60) && MC.pc(x) !== MC.pc(m));
    const byDist = same.slice().sort((a, b) => (Math.abs(a - m) - Math.abs(b - m)) || (rnd() - 0.5));
    const near = byDist.slice(0, 3);
    const out = [];
    while(out.length < 2 && near.length){ out.push(near.splice(Math.floor(rnd() * near.length), 1)[0]); }
    return out;
  }

  /* ── State ── */
  const KEY = 'garden_v1';
  const DEFAULTS = { input: 'screen', names: 'solf', labels: true, hints: true, voice: true, bass: false,
    tempo: 76, click: true, guide: false, appSound: false };
  let state = load();
  function load(){
    let s = null;
    try{ s = JSON.parse(localStorage.getItem(KEY)); }catch(e){}
    s = s && typeof s === 'object' ? s : {};
    s.settings = Object.assign({}, DEFAULTS, s.settings || {});
    s.songs = s.songs || {}; s.quiz = s.quiz || {}; s.days = s.days || []; s.berries = s.berries || 0;
    return s;
  }
  function save(){ try{ localStorage.setItem(KEY, JSON.stringify(state)); }catch(e){} }
  const S = () => state.settings;
  function markDay(){ const d = MC.dayKey(new Date()); if(!state.days.includes(d)){ state.days.push(d); state.days = state.days.slice(-120); } }
  function addBerries(n){ state.berries += n; markDay(); save(); $('#berryCount').textContent = state.berries; }
  function latencySec(){
    let ms = null;
    try{ const v = localStorage.getItem('musicEco_latencyMs'); if(v != null && v !== '') ms = +v; }catch(e){}
    if(ms != null && isFinite(ms)) return ms / 1000;
    return ac ? (ac.outputLatency || 0) + (ac.baseLatency || 0) : 0;
  }

  /* ── Names + voice ── */
  const LETTER = ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
  const SAY = { Do: 'doh', Re: 'ray', Mi: 'mee', Fa: 'fah', Sol: 'soh', La: 'lah', Ti: 'tee' };
  const solf = (m) => MC.SOLFEGE[MC.pc(m)];
  function nameOf(m){ const n = S().names; return n === 'letter' ? LETTER[MC.pc(m)] : n === 'both' ? solf(m) + ' · ' + LETTER[MC.pc(m)] : solf(m); }
  const shortOf = (m) => S().names === 'letter' ? LETTER[MC.pc(m)] : solf(m);
  const sayOf = (m) => S().names === 'letter' ? LETTER[MC.pc(m)] : (SAY[solf(m)] || solf(m));
  const textCol = (m) => ({ 4: '#A87C00', 5: '#4E8A22', 3: '#A87C00' })[MC.pc(m)] || MC.colorOf(m);   // readable on pink
  const inkOn = (m) => [4, 5].includes(MC.pc(m)) ? '#3A2E4F' : '#fff';     // yellow / light green keys need dark text
  let muteUntil = 0;                                   // the mic ignores our own sounds
  function say(text){
    if(!S().voice || !window.speechSynthesis) return;
    try{
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.9; u.pitch = 1.15; u.lang = 'en-US';
      muteUntil = Infinity; u.onend = u.onerror = () => { muteUntil = now() + 0.25; };
      setTimeout(() => { if(muteUntil === Infinity) muteUntil = now() + 0.25; }, 4000);
      speechSynthesis.speak(u);
    }catch(e){}
  }
  let toastT = 0;
  function toast(msg){ const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2400); }

  /* ── Audio ── */
  let ac = null;
  function actx(){
    if(!ac){ const A = window.AudioContext || window.webkitAudioContext; if(!A) return null; ac = new A(); Sound.use(ac); }
    if(ac.state !== 'running') ac.resume().catch(() => {});
    return ac;
  }
  function blip(m, when, dur, vol){
    const c = actx(); if(!c) return;
    const t = when || c.currentTime, f = MC.midiToFreq(m), g = c.createGain(), o = c.createOscillator();
    o.type = 'triangle'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol || 0.2, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 0.4));
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + (dur || 0.4) + 0.05);
    muteUntil = Math.max(muteUntil === Infinity ? 0 : muteUntil, now() + (t - c.currentTime) + (dur || 0.4) + 0.1);
  }
  const chime = () => [72, 76, 79, 84].forEach((m, i) => blip(m, ac && ac.currentTime + i * 0.07, 0.45, 0.14));
  const boop = () => blip(50, 0, 0.28, 0.16);
  function click(when, accent){
    const c = actx(); if(!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'square'; o.frequency.value = accent ? 1760 : 1175;
    g.gain.setValueAtTime(0.0001, when); g.gain.exponentialRampToValueAtTime(accent ? 0.22 : 0.13, when + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
    o.connect(g); g.connect(c.destination); o.start(when); o.stop(when + 0.06);
  }
  const playTone = (m, dur) => { const c = actx(); if(c){ Sound.schedule(m, c.currentTime + 0.01, dur || 0.8, { vel: 90 }); muteUntil = now() + (dur || 0.8) + 0.2; } };

  /* ── Staff drawing (SVG string) ── */
  const CLEF_FONT = "'Apple Symbols','Noto Music','Segoe UI Symbol','Bravura',serif";
  const clefCache = {};
  function clefInk(ch){
    if(clefCache[ch]) return clefCache[ch];
    let r = null;
    try{
      const c = document.createElement('canvas').getContext('2d');
      c.font = '100px ' + CLEF_FONT;
      const m = c.measureText(ch);
      if(m.actualBoundingBoxAscent + m.actualBoundingBoxDescent > 10)
        r = { asc: m.actualBoundingBoxAscent, desc: m.actualBoundingBoxDescent, left: m.actualBoundingBoxLeft || 0 };
    }catch(e){}
    return (clefCache[ch] = r || { asc: 75, desc: 25, left: 0 });
  }
  function staffSvg(song, o){
    o = o || {};
    const s = o.s || 14, y0 = 3.6 * s, yB = y0 + 4 * s;
    const shift = MC.CLEF_SHIFT[song.clef] || 0;
    const stepOf = (m) => MC.staffStep(m).step - shift;
    const yOf = (st) => yB - st * s / 2;
    const beatW = o.beatW || 4.4 * s, num = song.time ? beatsPerBar(song) : 99;
    const P = [];
    let x = 0.5 * s;
    const clefX = x; x += 3.4 * s;
    const timeX = x; if(song.time && o.time !== false) x += 2.6 * s;
    const startX = x + 0.4 * s;
    const evs = []; const bars = []; let beat = 0;
    song.notes.forEach(([m, b], i) => {
      evs.push({ i, m, b, beat, x: startX + beat * beatW + 0.9 * s });
      beat += b;
      if(o.bars !== false && beat % num === 0 && i < song.notes.length - 1) bars.push(startX + beat * beatW);
    });
    const endX = startX + beat * beatW + (o.bars === false ? 0.4 * s : 0.2 * s);
    const W = endX + 0.6 * s, H = yB + (o.labels === false ? 2.6 * s : 5 * s);
    for(let k = 0; k < 5; k++) P.push(`<line x1="${0.3 * s}" x2="${endX}" y1="${y0 + k * s}" y2="${y0 + k * s}" stroke="#3A2E4F" stroke-width="${0.09 * s}"/>`);
    // clef, sized to its real ink box (glyph fonts differ a lot between devices)
    const G = song.clef !== 'F', ch = G ? '𝄞' : '𝄢', ink = clefInk(ch);
    const h = G ? 7.2 * s : 3.3 * s, top = G ? y0 - 1.5 * s : y0 - 0.05 * s, fs = 100 * h / (ink.asc + ink.desc);
    P.push(`<text x="${clefX + ink.left * fs / 100}" y="${top + ink.asc * fs / 100}" font-size="${fs.toFixed(1)}" font-family="${CLEF_FONT.replace(/"/g, '')}" fill="#3A2E4F">${ch}</text>`);
    if(song.time && o.time !== false){
      const cx = timeX + 1.1 * s, serif = 'Georgia,"Times New Roman",serif';
      if(song.time === 'C') P.push(`<text x="${cx}" y="${y0 + 2.95 * s}" font-size="${2.9 * s}" font-weight="700" font-family='${serif}' text-anchor="middle" fill="#3A2E4F">C</text>`);
      else song.time.forEach((d, k) => P.push(`<text x="${cx}" y="${y0 + (k ? 3.85 : 1.85) * s}" font-size="${2.55 * s}" font-weight="700" font-family='${serif}' text-anchor="middle" fill="#3A2E4F">${d}</text>`));
    }
    bars.forEach(bx => P.push(`<line x1="${bx}" x2="${bx}" y1="${y0}" y2="${yB}" stroke="#3A2E4F" stroke-width="${0.12 * s}"/>`));
    if(o.bars !== false){
      P.push(`<line x1="${endX - 0.55 * s}" x2="${endX - 0.55 * s}" y1="${y0}" y2="${yB}" stroke="#3A2E4F" stroke-width="${0.12 * s}"/>`);
      P.push(`<line x1="${endX - 0.15 * s}" x2="${endX - 0.15 * s}" y1="${y0}" y2="${yB}" stroke="#3A2E4F" stroke-width="${0.32 * s}"/>`);
    }
    evs.forEach(e => {
      const g = [];
      if(e.m == null){
        const cy = y0 + 2 * s, X = (v) => (e.x + v * s).toFixed(1), Y = (v) => (cy + v * s).toFixed(1);
        g.push(`<ellipse class="halo" cx="${e.x}" cy="${cy}" rx="${1.3 * s}" ry="${1.9 * s}" fill="#FFE1EE"/>`);
        g.push(`<path class="head" d="M${X(-0.35)} ${Y(-1.5)}L${X(0.4)} ${Y(-0.65)}L${X(-0.15)} ${Y(0.05)}L${X(0.45)} ${Y(0.85)}C${X(-0.15)} ${Y(0.55)} ${X(-0.45)} ${Y(1.0)} ${X(0)} ${Y(1.55)}" fill="none" stroke="#3A2E4F" stroke-width="${0.3 * s}" stroke-linejoin="round" stroke-linecap="round"/>`);
      } else {
        const st = stepOf(e.m), y = yOf(st), whole = e.b >= 4;
        g.push(`<ellipse class="halo" cx="${e.x}" cy="${y}" rx="${1.45 * s}" ry="${1.25 * s}" fill="#FFD3E6"/>`);
        for(let k = -2; k >= st; k -= 2) g.push(`<line x1="${e.x - 1.05 * s}" x2="${e.x + 1.05 * s}" y1="${yOf(k)}" y2="${yOf(k)}" stroke="#3A2E4F" stroke-width="${0.1 * s}"/>`);
        for(let k = 10; k <= st; k += 2) g.push(`<line x1="${e.x - 1.05 * s}" x2="${e.x + 1.05 * s}" y1="${yOf(k)}" y2="${yOf(k)}" stroke="#3A2E4F" stroke-width="${0.1 * s}"/>`);
        if(whole) g.push(`<ellipse class="head" cx="${e.x}" cy="${y}" rx="${0.78 * s}" ry="${0.5 * s}" fill="#fff" stroke="#3A2E4F" stroke-width="${0.22 * s}"/>`);
        else {
          g.push(`<ellipse class="head" cx="${e.x}" cy="${y}" rx="${0.64 * s}" ry="${0.45 * s}" transform="rotate(-20 ${e.x} ${y})" fill="#3A2E4F"/>`);
          const up = st < 4, sx = up ? e.x + 0.58 * s : e.x - 0.58 * s;
          g.push(`<line x1="${sx}" x2="${sx}" y1="${y + (up ? -0.12 : 0.12) * s}" y2="${y + (up ? -3.4 : 3.4) * s}" stroke="#3A2E4F" stroke-width="${0.11 * s}"/>`);
        }
        if(o.labels !== false){
          const ly = yB + 3.3 * s, c = MC.colorOf(e.m);
          g.push(`<g class="lbl"><circle cx="${e.x}" cy="${ly}" r="${1.15 * s}" fill="${c}"/><text x="${e.x}" y="${ly + 0.36 * s}" font-size="${0.95 * s}" font-weight="800" font-family="'Baloo 2',system-ui,sans-serif" text-anchor="middle" fill="${inkOn(e.m)}">${shortOf(e.m)}</text></g>`);
        }
      }
      g.push(`<text class="pop" x="${e.x}" y="${y0 - 1.25 * s}" font-size="${1.3 * s}"></text>`);
      P.push(`<g class="ev" data-i="${e.i}">${g.join('')}</g>`);
    });
    if(o.playhead) P.push(`<line class="playhead" x1="0" x2="0" y1="${y0 - 0.9 * s}" y2="${yB + 0.9 * s}" stroke="#E5384F" stroke-width="${0.22 * s}" stroke-linecap="round" opacity="0" />`);
    const k = o.scale || 1;
    const svg = `<svg class="staff${S().labels ? '' : ' nonames'}" viewBox="0 0 ${W.toFixed(1)} ${H.toFixed(1)}" width="${(W * k).toFixed(0)}" height="${(H * k).toFixed(0)}" role="img" aria-label="${o.aria || 'Music staff'}">${P.join('')}</svg>`;
    return { svg, evs, W, H, s, xOfBeat: (b) => startX + b * beatW + 0.9 * s };
  }

  /* ── Piano ── */
  const KB_WHITE = ['KeyA','KeyS','KeyD','KeyF','KeyG','KeyH','KeyJ','KeyK','KeyL','Semicolon'];
  const KB_BLACK = { KeyW: 0, KeyE: 1, KeyT: 3, KeyY: 4, KeyU: 5, KeyO: 7, KeyP: 8 };   // black key after white #n
  let piano = null;
  function buildPiano(el, lo, hi, opts){
    el.innerHTML = '';
    const whites = []; for(let m = lo; m <= hi; m++) if(!MC.isBlack(m)) whites.push(m);
    const W = 100 / whites.length, keys = new Map();
    const down = (m, b, e) => { e.preventDefault(); try{ b.setPointerCapture(e.pointerId); }catch(_){} pressed(m, 'screen'); };
    const up = (m) => { Sound.noteOff(m); unflash(m); };
    whites.forEach((m) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'wk'; b.setAttribute('aria-label', nameOf(m));
      if(opts.labels) b.innerHTML = `<span class="kl">${shortOf(m)}</span>`;
      b.addEventListener('pointerdown', (e) => down(m, b, e));
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => b.addEventListener(ev, () => up(m)));
      el.appendChild(b); keys.set(m, b);
    });
    for(let m = lo; m < hi; m++) if(MC.isBlack(m)){
      const wi = whites.indexOf(m - 1), b = document.createElement('button');
      b.type = 'button'; b.className = 'bk'; b.setAttribute('aria-label', 'black key');
      b.style.left = `calc(${(wi + 1) * W}% - ${W * 0.31}%)`; b.style.width = (W * 0.62) + '%';
      b.addEventListener('pointerdown', (e) => down(m, b, e));
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => b.addEventListener(ev, () => up(m)));
      el.appendChild(b); keys.set(m, b);
    }
    piano = { el, lo, hi, keys, whites, onNote: opts.onNote || null };
    return piano;
  }
  const fold = (m) => { if(!piano) return m; let x = m; while(x < piano.lo) x += 12; while(x > piano.hi) x -= 12; return x; };
  function flash(m){
    if(!piano) return; const b = piano.keys.get(fold(m)); if(!b) return;
    b.style.background = MC.colorOf(m); clearTimeout(b._t); b._t = setTimeout(() => unflash(m), 450);
  }
  function unflash(m){ if(!piano) return; const b = piano.keys.get(fold(m)); if(b) b.style.background = ''; }
  function hintKey(m){
    if(!piano) return;
    piano.keys.forEach(b => b.classList.remove('hint'));
    if(m == null) return;
    const b = piano.keys.get(fold(m)); if(b){ b.style.setProperty('--hc', MC.colorOf(m)); b.classList.add('hint'); }
  }

  /* ── Input hub: screen keys, computer keys, MIDI, mic → one stream ── */
  let sink = null;                       // fn(m, t, src)
  function pressed(m, src, t, vel){
    t = t == null ? now() : t;
    if(src === 'screen' || src === 'key' || (src === 'midi' && S().appSound)){ actx(); Sound.noteOn(m, vel || 90); }
    flash(m);
    if(src !== 'mic') muteUntil = Math.max(muteUntil === Infinity ? 0 : muteUntil, now() + 0.15);
    if(sink) sink(m, t, src);
    if(piano && piano.onNote) piano.onNote(m);
  }
  const keyHeld = new Map();            // code → midi
  document.addEventListener('keydown', (e) => {
    if(!piano || e.metaKey || e.ctrlKey || e.altKey || e.repeat || $('#grown').hidden === false) return;
    let m = null; const wi = KB_WHITE.indexOf(e.code);
    if(wi >= 0 && wi < piano.whites.length) m = piano.whites[wi];
    else if(e.code in KB_BLACK && KB_BLACK[e.code] < piano.whites.length - 1 && MC.isBlack(piano.whites[KB_BLACK[e.code]] + 1)) m = piano.whites[KB_BLACK[e.code]] + 1;
    if(m == null || keyHeld.has(e.code)) return;
    e.preventDefault(); keyHeld.set(e.code, m); pressed(m, 'key');
  });
  document.addEventListener('keyup', (e) => { const m = keyHeld.get(e.code); if(m != null){ keyHeld.delete(e.code); Sound.noteOff(m); unflash(m); } });
  let midiStatus = { state: 'off', names: [] };
  Midi.onNote((m, v, on) => { if(on){ if(S().input === 'midi') pressed(m, 'midi', now(), v); } else { Sound.noteOff(m); unflash(m); } });
  Midi.onStatus((st) => { midiStatus = st; if(!$('#grown').hidden) drawGrown(); updateChip(); });
  if(S().input === 'midi') Midi.autoConnect();

  // Microphone: a note starts on an energy jump (re-strikes of the same key)
  // or when the steady pitch changes; time is back-dated by the analysis delay.
  let mic = null;
  async function micStart(){
    if(mic || S().input !== 'mic') return;
    const c = actx(); if(!c || !navigator.mediaDevices) { toast('No microphone here'); return; }
    mic = { starting: true };
    try{
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      if(!mic){ stream.getTracks().forEach(t => t.stop()); return; }
      const src = c.createMediaStreamSource(stream), an = c.createAnalyser();
      an.fftSize = 2048; an.smoothingTimeConstant = 0; src.connect(an);
      const buf = new Float32Array(an.fftSize), tr = Hear.pitchTracker({ gap: 3, hold: 2 });
      let avg = 0, pend = null, last = null, lastEmit = 0;
      const iv = setInterval(() => {
        an.getFloatTimeDomainData(buf);
        let r = 0; for(let i = 0; i < buf.length; i++) r += buf[i] * buf[i]; r = Math.sqrt(r / buf.length);
        const t = now(), res = Hear.mpm(buf, c.sampleRate);
        const p = tr.push(res && res.clarity >= 0.8 ? res.freq : null);
        if(r > 0.01 && r > avg * 1.7 + 0.003 && t - lastEmit > 0.14 && !nearClick(t)) pend = t;
        avg = avg * 0.7 + r * 0.3;
        if(r < 0.005){ last = null; }
        if(pend && t - pend > 0.25) pend = null;
        if(!p) return;
        let at = null;
        if(pend){ at = pend - 0.03; pend = null; }
        else if(last == null || p.note !== last) at = t - 0.08;
        if(at == null) return;
        last = p.note; lastEmit = t;
        if(t < muteUntil) return;                     // our own voice / chime
        pressed(p.note, 'mic', at);
      }, 20);
      mic = { stream, src, iv };
      updateChip();
    }catch(e){ mic = null; toast('Microphone not allowed — check Settings'); }
  }
  function micStop(){
    if(!mic) return;
    if(mic.iv) clearInterval(mic.iv);
    try{ mic.stream && mic.stream.getTracks().forEach(t => t.stop()); }catch(e){}
    mic = null; updateChip();
  }
  let clickTimes = [];
  const nearClick = (t) => clickTimes.some(c => Math.abs(c - t) < 0.05);
  function updateChip(){
    const el = $('#inputChip'); if(!el) return;
    const i = S().input;
    el.textContent = i === 'mic' ? (mic && mic.iv ? 'Listening to your piano' : 'Microphone')
      : i === 'midi' ? (midiStatus.state === 'connected' ? 'Keyboard connected' : 'Plug in your keyboard')
      : 'Tap the keys';
  }

  /* ── Screens ── */
  const SCREENS = ['home', 'book', 'song', 'quiz', 'done', 'free', 'grown'];
  function show(id){
    if(id !== 'song') { stopRun(); micStop(); }
    SCREENS.forEach(s => $('#' + s).hidden = s !== id);
    if(id === 'home') { $('#berryCount').textContent = state.berries; today = null; }
    if(id !== 'song' && id !== 'free') piano = null;
  }
  document.querySelectorAll('.home').forEach(b => b.addEventListener('click', () => { try{ speechSynthesis.cancel(); }catch(e){} show('home'); }));

  /* ── Book ── */
  function berryIcons(n, size){ let h = ''; for(let i = 0; i < 3; i++) h += `<svg style="width:${size}px;height:${size}px" aria-hidden="true"><use href="#i-berry${i < n ? '' : '-off'}"/></svg>`; return h; }
  function openBook(){
    show('book');
    const box = $('#bookList'); box.innerHTML = '';
    SONGS.forEach(song => {
      const rec = state.songs[song.id] || {};
      const b = document.createElement('button'); b.type = 'button'; b.className = 'song';
      b.innerHTML = `<b>${song.title}</b><span class="seq">${song.notes.filter(n => n[0] != null).map(n => `<i style="background:${MC.colorOf(n[0])}"></i>`).join('')}</span>` +
        `<span class="clef">${song.clef === 'F' ? 'Bass clef · left hand' : 'Treble clef'}</span><span class="berries">${berryIcons(rec.best || 0, 24)}</span>`;
      b.setAttribute('aria-label', `${song.title}, ${rec.best || 0} of 3 strawberries`);
      b.addEventListener('click', () => { actx(); openSong(song); });
      box.appendChild(b);
    });
  }

  /* ── Song screen ── */
  let cur = null, view = null, run = null;
  function openSong(song, opts){
    opts = opts || {};
    cur = song; show('song');
    $('#songTitle').textContent = song.title;
    drawSongBerries();
    $('#songMsg').textContent = opts.msg || '';
    const lo = song.clef === 'F' ? 48 : 60;
    buildPiano($('#songPiano'), lo, lo + 12, { labels: S().labels });
    drawStaff();
    $('#result').hidden = true;
    const only = opts.only;
    ['mListen', 'mLearn', 'mPlay'].forEach(id => $('#' + id).hidden = !!only && id !== only);
    drawDots();
    updateChip();
    if(S().input === 'mic') micStart();
    if(S().input === 'midi' && !Midi.connected) Midi.connect();
  }
  function drawSongBerries(){ $('#songBerries').innerHTML = berryIcons((state.songs[cur.id] || {}).best || 0, 30); }
  function drawStaff(){
    const wrap = $('#songStaff');
    const perS = staffSvg(cur, { s: 10 }).W / 10;      // width per unit of line spacing
    const s = Math.max(9, Math.min(18, ((wrap.clientWidth || 700) - 20) / perS));
    view = staffSvg(cur, { s, playhead: true, aria: cur.title + ' music' });
    wrap.innerHTML = view.svg;
    view.el = wrap.querySelector('svg');
    view.head = view.el.querySelector('.playhead');
    view.ev = (i) => view.el.querySelector(`.ev[data-i="${i}"]`);
  }
  function setNow(i){
    view.el.querySelectorAll('.ev.now').forEach(g => g.classList.remove('now'));
    if(i == null) return;
    const g = view.ev(i); if(g) g.classList.add('now');
    const e = view.evs[i], wrap = $('#songStaff');
    if(e && (e.x * (view.el.clientWidth / view.W) > wrap.scrollLeft + wrap.clientWidth * 0.75 || e.x * (view.el.clientWidth / view.W) < wrap.scrollLeft))
      wrap.scrollLeft = e.x * (view.el.clientWidth / view.W) - wrap.clientWidth * 0.3;
  }
  const VERDICT = {
    great: { t: 'Great!', c: '#D99A00' }, good: { t: 'Good', c: '#2C8044' },
    early: { t: 'Early', c: '#E07A00' }, late: { t: 'Late', c: '#E07A00' },
    wrong: { t: 'Oops', c: '#8A7F99' }, miss: { t: 'Missed', c: '#8A7F99' }, yes: { t: 'Yes!', c: '#2C8044' }
  };
  function popOn(i, key){
    const g = view.ev(i); if(!g) return;
    const p = g.querySelector('.pop'), v = VERDICT[key];
    p.textContent = v.t; p.setAttribute('fill', v.c); p.classList.remove('on'); void p.getBoundingClientRect(); p.classList.add('on');
  }
  function paintHead(i, m, ok){
    const g = view.ev(i); if(!g) return;
    const h = g.querySelector('.head');
    if(h.tagName === 'ellipse' && h.getAttribute('fill') !== '#fff') h.setAttribute('fill', ok ? MC.colorOf(m) : '#B9B0C6');
    else if(h.tagName === 'ellipse') h.setAttribute('stroke', ok ? MC.colorOf(m) : '#B9B0C6');
  }
  function wobble(i){ const g = view.ev(i); if(!g) return; g.classList.remove('wob'); void g.getBoundingClientRect(); g.classList.add('wob'); }
  function resetPaint(){ drawStaff(); }

  function stopRun(){
    if(!run) return;
    run.alive = false;
    cancelAnimationFrame(run.raf);
    (run.timers || []).forEach(clearTimeout);
    try{ Sound.cancel('guide'); Sound.cancel('listen'); Sound.cancel('replay'); }catch(e){}
    sink = null; clickTimes = [];
    $('#countin').hidden = true; $('#combo').hidden = true;
    hintKey(null);
    if(view && view.head) view.head.setAttribute('opacity', '0');
    run = null;
  }

  // Listen: the app plays the tune with the playhead
  $('#mListen').addEventListener('click', () => {
    const c = actx(); stopRun(); resetPaint(); $('#result').hidden = true;
    const spb = 60 / S().tempo, t0 = c.currentTime + 0.5, off = now() - c.currentTime, lat = latencySec();
    const r = run = { mode: 'listen', alive: true, timers: [], spb, beat0: t0 + off + lat };
    targetsOf(cur).forEach(t => {
      Sound.schedule(t.m, t0 + t.beat * spb, t.b * spb * 0.92, { vel: 90, tag: 'listen' });
      r.timers.push(setTimeout(() => { if(r.alive){ flash(t.m); setNow(t.i); } }, (t0 - c.currentTime + t.beat * spb + lat) * 1000));
    });
    muteUntil = now() + 0.5 + songBeats(cur) * spb + 0.5;
    animate(r, () => songBeats(cur));
    $('#songMsg').textContent = 'Listen…';
    r.timers.push(setTimeout(() => { if(r.alive){ stopRun(); setNow(null); $('#songMsg').textContent = 'Your turn! Tap Learn or Play!'; } }, (0.6 + songBeats(cur) * spb + lat) * 1000));
  });

  function animate(r, total){
    const loop = () => {
      if(!r.alive) return;
      const b = (now() - r.beat0) / r.spb;
      if(view.head){
        const x = view.xOfBeat(Math.max(-0.2, Math.min(total(), b)));
        view.head.setAttribute('x1', x); view.head.setAttribute('x2', x);
        view.head.setAttribute('opacity', b > -0.3 ? '0.75' : '0');
      }
      if(r.tick) r.tick(b);
      r.raf = requestAnimationFrame(loop);
    };
    r.raf = requestAnimationFrame(loop);
  }

  // Learn: wait for each note
  $('#mLearn').addEventListener('click', () => {
    actx(); stopRun(); resetPaint(); $('#result').hidden = true;
    const tg = targetsOf(cur);
    const r = run = { mode: 'learn', alive: true, k: 0, tries: tg.map(() => 0), events: [], t0: now() };
    const step = () => {
      const t = tg[r.k]; setNow(t.i);
      if(S().hints) hintKey(t.m);
      $('#songMsg').textContent = r.k === 0 ? `Start on ${nameOf(t.m)}` : '';
    };
    sink = (m, t) => {
      if(!r.alive) return;
      r.events.push({ m, t: t - r.t0 });
      const want = tg[r.k];
      if(MC.pc(m) === MC.pc(want.m)){
        paintHead(want.i, want.m, true); popOn(want.i, 'yes');
        r.k++;
        if(r.k >= tg.length){ sink = null; hintKey(null); setNow(null); setTimeout(() => finishLearn(r, tg), 450); return; }
        step();
      } else {
        r.tries[r.k]++; wobble(want.i);
        if(S().input !== 'mic') boop();
        $('#songMsg').textContent = `That's ${nameOf(m)}. Find ${nameOf(want.m)}!`;
      }
    };
    say(`Let's learn it. Start on ${sayOf(tg[0].m)}.`);
    step();
  });
  function finishLearn(r, tg){
    const first = r.tries.filter(x => x === 0).length, pct = Math.round(first / tg.length * 100), berries = berriesFor(pct);
    record({ mode: 'learn', score: pct, berries, tally: { first, n: tg.length } });
    if(S().input !== 'mic') chime();
    say(berries >= 2 ? 'You played it all! Now try it with the beat.' : 'You did it! Let\'s practise once more.');
    showResult({ title: berries >= 2 ? 'You played it all!' : 'You did it!', berries,
      lines: [`${first} of ${tg.length} notes right the first time.`], next: 'play' });
  }

  // Play! — the beat game
  $('#mPlay').addEventListener('click', () => startPlay());
  function startPlay(){
    const c = actx(); stopRun(); resetPaint(); $('#result').hidden = true;
    const spb = 60 / S().tempo, num = beatsPerBar(cur), count = num === 2 ? 4 : num;
    const lead = 0.6, acBeat0 = c.currentTime + lead + count * spb;
    const off = now() - c.currentTime, lat = latencySec();
    const tg = targetsOf(cur), total = songBeats(cur);
    const win = Math.min(0.5, 0.45 / spb);
    const r = run = { mode: 'play', alive: true, timers: [], spb, beat0: acBeat0 + off + lat, tg, judged: tg.map(() => null),
      wrong: tg.map(() => false), events: [], combo: 0, maxCombo: 0, shownCount: null };
    clickTimes = [];
    for(let k = -count; k < total; k++){
      const t = acBeat0 + k * spb;
      if(S().click || k < 0) click(t, k < 0 ? (k + count) % num === 0 : k % num === 0);
      clickTimes.push(t + off + lat);
    }
    if(S().guide && S().input !== 'mic') tg.forEach(t => Sound.schedule(t.m, acBeat0 + t.beat * spb, t.b * spb * 0.9, { tag: 'guide', soft: true, vel: 60 }));
    $('#songMsg').textContent = 'Get ready…';
    const judge = (k, v, dt, m) => {
      r.judged[k] = { v, dt, m };
      const t = tg[k];
      const label = v === 'ok' ? (dt < 0 ? 'early' : 'late') : v;
      popOn(t.i, label); paintHead(t.i, t.m, v !== 'wrong' && v !== 'miss');
      if(v === 'great' || v === 'good'){ r.combo++; r.maxCombo = Math.max(r.maxCombo, r.combo); } else r.combo = 0;
      const cb = $('#combo'); cb.hidden = r.combo < 3; cb.textContent = `Combo ${r.combo}!`;
    };
    sink = (m, t) => {
      if(!r.alive) return;
      const bp = (t - r.beat0) / spb;
      r.events.push({ m, t: +(t - r.beat0).toFixed(3) });
      let best = -1, bd = 9;
      tg.forEach((x, k) => { if(!r.judged[k]){ const d = Math.abs(bp - x.beat); if(d <= win && d < bd){ bd = d; best = k; } } });
      if(best < 0) return;                               // between notes: not counted
      const x = tg[best];
      if(MC.pc(m) === MC.pc(x.m)) judge(best, verdictOf((bp - x.beat) * spb * 1000, r.wrong[best]), Math.round((bp - x.beat) * spb * 1000), m);
      else if(!r.wrong[best]){ r.wrong[best] = true; wobble(x.i); }
    };
    r.tick = (b) => {
      if(b < 0){
        const n = ((count + Math.floor(b)) % num) + 1;
        if(n !== r.shownCount){ r.shownCount = n; const ci = $('#countin'); ci.hidden = false; ci.innerHTML = `<span>${n}</span>`; }
      } else if(r.shownCount != null){ r.shownCount = null; $('#countin').hidden = true; $('#songMsg').textContent = ''; }
      let nowI = null;
      tg.forEach((x, k) => {
        if(x.beat <= b + 0.35) nowI = x.i;
        if(!r.judged[k] && b > x.beat + win) judge(k, r.wrong[k] ? 'wrong' : 'miss', null, null);
      });
      if(nowI !== r.lastNow){ r.lastNow = nowI; setNow(b > total - 0.2 ? null : nowI); }
      if(b > total + 0.3){ r.alive = false; cancelAnimationFrame(r.raf); finishPlay(r); }
    };
    animate(r, () => total);
  }
  function finishPlay(r){
    sink = null; clickTimes = []; $('#combo').hidden = true; setNow(null);
    const pct = scoreOf(r.judged), berries = berriesFor(pct), tim = timingSummary(r.judged);
    const tally = { great: 0, good: 0, ok: 0, wrong: 0, miss: 0 };
    r.judged.forEach(j => tally[j ? j.v : 'miss']++);
    const wrongNotes = r.judged.map((j, k) => j && j.v === 'wrong' ? r.tg[k].m : null).filter(x => x != null);
    record({ mode: 'play', score: pct, berries, tally, bias: tim.bias, sd: tim.sd, combo: r.maxCombo, bpm: S().tempo, events: r.events,
      wrong: wrongNotes });
    run = { mode: 'played', last: r };
    if(S().input !== 'mic') chime();
    const title = pct >= 85 ? 'Wonderful!' : pct >= 60 ? 'Great job!' : pct >= 30 ? 'Good try!' : "Let's try again!";
    say(title.replace('!', '') + (berries ? `! ${berries} strawberr${berries > 1 ? 'ies' : 'y'}!` : ''));
    const lines = [];
    if(tim.text) lines.push(tim.text);
    if(wrongNotes.length) lines.push(`Tricky: ${[...new Set(wrongNotes.map(m => nameOf(m)))].join(', ')}`);
    showResult({ title, berries, score: pct, tally, chart: r, lines, next: 'next' });
  }

  function record(a){
    const rec = state.songs[cur.id] = state.songs[cur.id] || { best: 0, attempts: [] };
    const prevBest = rec.best || 0;
    a.at = Date.now(); a.input = S().input;
    rec.attempts.push(a);
    rec.attempts.forEach((x, k) => { if(k < rec.attempts.length - 3) delete x.events; });
    rec.attempts = rec.attempts.slice(-15);
    if(a.mode === 'play') rec.best = Math.max(prevBest, a.berries);
    else rec.best = Math.max(prevBest, Math.min(1, a.berries));       // Learn alone earns at most 1 on the book
    const gained = Math.max(0, rec.best - prevBest) + (a.berries > 0 ? 1 : 0);
    addBerries(gained);
    if(today) today.berries += gained;
    drawSongBerries();
  }

  function timingChart(r){
    const W = 600, H = 150, mid = 70, sc = 55 / 400, n = r.tg.length, pad = 40;
    const xs = (k) => pad + (n === 1 ? (W - pad * 2) / 2 : k * (W - pad * 2) / (n - 1));
    let g = `<rect x="${pad - 14}" y="${mid - WIN.good * sc}" width="${W - pad * 2 + 28}" height="${WIN.good * sc * 2}" fill="#EAF7E6" rx="8"/>` +
      `<rect x="${pad - 14}" y="${mid - WIN.great * sc}" width="${W - pad * 2 + 28}" height="${WIN.great * sc * 2}" fill="#D3F0CC" rx="6"/>` +
      `<line x1="${pad - 14}" x2="${W - pad + 14}" y1="${mid}" y2="${mid}" stroke="#7BBF72" stroke-width="2"/>` +
      `<text x="4" y="22" font-size="14" fill="#6E6283" font-family="system-ui">early</text><text x="4" y="${H - 34}" font-size="14" fill="#6E6283" font-family="system-ui">late</text>`;
    r.tg.forEach((t, k) => {
      const j = r.judged[k], x = xs(k);
      if(j && j.dt != null && j.v !== 'wrong'){
        const y = mid + Math.max(-400, Math.min(400, j.dt)) * sc;
        g += `<circle cx="${x}" cy="${y}" r="9" fill="${MC.colorOf(t.m)}" stroke="#3A2E4F" stroke-width="2"/>`;
      } else {
        g += `<g stroke="#A99FB8" stroke-width="3" stroke-linecap="round"><path d="M${x - 6} ${H - 18}l12 12M${x + 6} ${H - 18}l-12 12"/></g>`;
      }
    });
    g += `<text x="${W - 4}" y="${H - 6}" font-size="13" fill="#6E6283" text-anchor="end" font-family="system-ui">× = missed or wrong key</text>`;
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Timing of each note">${g}</svg>`;
  }

  function showResult(o){
    const p = $('#resultPanel');
    const big = [0, 1, 2].map(i => `<svg viewBox="0 0 100 110" aria-hidden="true"><use href="#i-berry${i < o.berries ? '' : '-off'}"/></svg>`).join('');
    let h = `<div class="bigberries" aria-label="${o.berries} of 3 strawberries">${big}</div><h2>${o.title}</h2>`;
    if(o.score != null) h += `<div class="sub" style="font-size:22px">Score ${o.score}</div>`;
    if(o.tally){
      const t = o.tally;
      h += `<div class="tally"><div><b style="color:#D99A00">${t.great}</b><span>Great</span></div><div><b style="color:#2C8044">${t.good}</b><span>Good</span></div>` +
        `<div><b style="color:#E07A00">${t.ok}</b><span>Early/Late</span></div><div><b style="color:#8A7F99">${t.miss + t.wrong}</b><span>Missed</span></div></div>`;
    }
    if(o.chart) h += `<div class="timing">${timingChart(o.chart)}</div>`;
    (o.lines || []).forEach(l => h += `<div class="sub">${l}</div>`);
    h += `<div class="btnrow">`;
    if(today){
      h += `<button class="go" type="button" data-a="today">Next</button><button class="ghostbtn" type="button" data-a="again">Again</button>`;
    } else {
      if(o.next === 'play') h += `<button class="go" type="button" data-a="play">Play with the beat!</button>`;
      h += `<button class="ghostbtn" type="button" data-a="again">Again</button>`;
      if(o.chart) h += `<button class="ghostbtn" type="button" data-a="hear">Hear me</button>`;
      if(o.next === 'next') h += `<button class="ghostbtn" type="button" data-a="book">My book</button>`;
    }
    h += `</div>`;
    p.innerHTML = h;
    $('#result').hidden = false;
    p.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      const a = b.dataset.a;
      if(a === 'today') { $('#result').hidden = true; todayNext(); }
      else if(a === 'again') { $('#result').hidden = true; (o.chart ? startPlay : () => $('#mLearn').click())(); }
      else if(a === 'play') { $('#result').hidden = true; startPlay(); }
      else if(a === 'hear') replay(o.chart);
      else if(a === 'book') openBook();
    }));
  }

  // "Hear me": her recorded notes over the same beat
  function replay(r){
    const c = actx(); try{ Sound.cancel('replay'); }catch(e){}
    const minT = Math.min(0, ...r.events.map(e => e.t));
    const base = c.currentTime + 0.5 - minT;
    for(let k = 0; k < songBeats(cur); k++) click(base + k * r.spb, k % beatsPerBar(cur) === 0);
    r.events.forEach(e => Sound.schedule(e.m, base + e.t, r.spb * 0.8, { vel: 90, tag: 'replay' }));
    muteUntil = now() + 0.5 - minT + songBeats(cur) * r.spb + 0.5;
  }

  /* ── Quiz: read the staff ── */
  function quizPool(){ const g = [60, 62, 64, 65, 67]; return S().bass ? g.concat([48, 50, 52, 53, 55]) : g; }
  function pickNote(pool, avoid){
    const w = pool.map(m => {
      const st = state.quiz[m] || { r: 0, n: 0 };
      const miss = st.n ? 1 - st.r / st.n : 0.5;
      return (m === avoid ? 0.15 : 1) * (1 + 2.5 * miss + (st.n < 3 ? 1 : 0));
    });
    let x = Math.random() * w.reduce((a, b) => a + b, 0);
    for(let i = 0; i < pool.length; i++){ x -= w[i]; if(x <= 0) return pool[i]; }
    return pool[pool.length - 1];
  }
  const shuffle = (a) => { for(let i = a.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  let quiz = null;
  function openQuiz(n){
    actx(); show('quiz');
    const kinds = ['name', 'name', 'find', 'song', 'name', 'find', 'name', 'song', 'name', 'name'];
    quiz = { n: n || 8, k: 0, berries: 0, kinds: shuffle(kinds.slice(0, n || 8)), last: null };
    quizStep();
  }
  function quizDots(){ $('#quizDots').innerHTML = Array.from({ length: quiz.n }, (_, i) => `<i class="${i < quiz.k ? 'done' : i === quiz.k ? 'now' : ''}"></i>`).join(''); }
  function miniStaff(m, s, aria){ return staffSvg({ clef: m < 60 ? 'F' : 'G', time: null, notes: [[m, 1]] }, { s, beatW: 7 * s, labels: false, bars: false, time: false, aria }).svg; }
  function quizStep(){
    quizDots();
    const pool = quizPool(), m = pickNote(pool, quiz.last); quiz.last = m;
    let kind = quiz.kinds[quiz.k] || 'name';
    const songsWith = SONGS.filter(sg => sg.notes.some(n => n[0] === m));
    if(kind === 'song' && !songsWith.length) kind = 'name';
    const body = $('#quizBody'), fb = $('#quizFb'); body.innerHTML = ''; fb.textContent = '';
    let firstTry = true, done = false;
    const answer = (picked, el, all) => {
      if(done || el.classList.contains('faded')) return;
      if(MC.pc(picked) === MC.pc(m)){
        done = true; el.classList.add('right'); chime(); setTimeout(() => playTone(m, 0.7), 350);
        const st = state.quiz[m] = state.quiz[m] || { r: 0, n: 0 }; st.n++; if(firstTry) st.r++;
        if(firstTry){ quiz.berries++; addBerries(1); if(today) today.berries++; }
        fb.innerHTML = `Yes! That's <span style="color:${textCol(m)}">&nbsp;${nameOf(m)}</span>`;
        say(`Yes! ${sayOf(m)}!`);
        setTimeout(() => { quiz.k++; quiz.k >= quiz.n ? quizDone() : quizStep(); }, 1700);
      } else {
        if(firstTry){ const st = state.quiz[m] = state.quiz[m] || { r: 0, n: 0 }; st.n++; save(); }
        firstTry = false; el.classList.add('faded'); boop();
        fb.textContent = 'Nearly! Try another one.'; say('Nearly! Try again.');
      }
    };
    const opts = shuffle([m, ...distractors(m, pool)]);
    const nameButtons = () => {
      const row = document.createElement('div'); row.className = 'answers';
      opts.forEach(o => {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'ans';
        b.textContent = nameOf(o); b.style.background = MC.colorOf(o); b.style.color = inkOn(o);
        b.addEventListener('click', () => answer(o, b)); row.appendChild(b);
      });
      body.appendChild(row);
    };
    if(kind === 'name'){
      $('#quizQ').textContent = 'What is this note?';
      body.insertAdjacentHTML('beforeend', `<div class="qstaff card">${miniStaff(m, 22, 'One note on the staff')}</div>`);
      body.querySelector('.qstaff svg').style.width = '100%'; body.querySelector('.qstaff svg').removeAttribute('height');
      nameButtons();
      quiz.again = () => say('What is this note?');
    } else if(kind === 'find'){
      $('#quizQ').innerHTML = `Which one is <span style="color:${textCol(m)}">${nameOf(m)}</span>?`;
      const row = document.createElement('div'); row.className = 'choices3';
      opts.forEach(o => {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'choice';
        b.setAttribute('aria-label', 'Staff choice'); b.innerHTML = miniStaff(o, 16, 'Staff choice');
        const sv = b.querySelector('svg'); sv.removeAttribute('height'); sv.style.width = '100%';
        b.addEventListener('click', () => answer(o, b)); row.appendChild(b);
      });
      body.appendChild(row);
      quiz.again = () => say(`Which one is ${sayOf(m)}?`);
    } else {
      const sg = songsWith[Math.floor(Math.random() * songsWith.length)];
      const idxs = sg.notes.map((n, i) => n[0] === m ? i : -1).filter(i => i >= 0);
      const hi = idxs[Math.floor(Math.random() * idxs.length)];
      $('#quizQ').textContent = 'What is the shining note?';
      const v = staffSvg(sg, { s: 13, labels: false, aria: sg.title });
      body.insertAdjacentHTML('beforeend', `<div class="sub">${sg.title}</div><div class="staffwrap card">${v.svg}</div>`);
      const g = body.querySelector(`.ev[data-i="${hi}"]`); if(g) g.classList.add('now');
      nameButtons();
      quiz.again = () => say('What is the shining note?');
    }
    quiz.again();
  }
  $('#quizAgain').addEventListener('click', () => quiz && quiz.again && quiz.again());
  function quizDone(){
    save();
    if(today){ todayNext(); return; }
    showDone(quiz.berries, `You read ${quiz.berries} of ${quiz.n} notes on the first try!`);
  }

  /* ── Today: quiz warm-up → learn the song → play it with the beat ── */
  let today = null;
  function currentSong(){
    return SONGS.find(sg => ((state.songs[sg.id] || {}).best || 0) < 2) || SONGS[SONGS.length - 1];
  }
  function startToday(){
    actx();
    const song = currentSong();
    today = { steps: [{ t: 'quiz' }, { t: 'learn', song }, { t: 'play', song }], i: -1, berries: 0 };
    todayNext();
  }
  function drawDots(){
    const d = $('#songDots');
    if(!today){ d.hidden = true; return; }
    d.hidden = false;
    d.innerHTML = today.steps.map((_, i) => `<i class="${i < today.i ? 'done' : i === today.i ? 'now' : ''}"></i>`).join('');
  }
  function todayNext(){
    if(!today) return;
    today.i++;
    const st = today.steps[today.i];
    if(!st){ const b = today.berries; showDone(Math.min(3, b), `You picked ${b} strawberr${b === 1 ? 'y' : 'ies'} today. See you tomorrow!`); today = null; return; }
    if(st.t === 'quiz') openQuiz(4);
    else if(st.t === 'learn') { openSong(st.song, { only: 'mLearn', msg: `Let's learn ${st.song.title}. Tap Learn!` }); say(`Let's learn ${st.song.title}.`); }
    else { openSong(st.song, { only: 'mPlay', msg: 'Now with the beat. Tap Play!' }); say('Now play it with the beat!'); }
  }
  function showDone(berries, msg){
    show('done');
    $('#doneBerries').innerHTML = [0, 1, 2].map(i => `<svg viewBox="0 0 100 110" aria-hidden="true"><use href="#i-berry${i < berries ? '' : '-off'}"/></svg>`).join('');
    $('#doneMsg').textContent = msg;
    chime(); say('All done! ' + msg);
  }
  $('#doneHome').addEventListener('click', () => show('home'));

  /* ── Free piano ── */
  function openFree(){
    actx(); show('free');
    const big = $('#bigName'); big.textContent = 'Tap a key'; big.style.color = 'var(--muted)';
    buildPiano($('#freePiano'), 60, 72, { labels: S().labels, onNote: (m) => { big.textContent = nameOf(m); big.style.color = textCol(m); } });
    if(S().input === 'mic') toast('Free piano uses the on-screen keys');
    if(S().input === 'midi' && !Midi.connected) Midi.connect();
  }

  /* ── Home wiring + grown-ups gate ── */
  $('#play').addEventListener('click', startToday);
  $('#tBook').addEventListener('click', () => { actx(); openBook(); });
  $('#tQuiz').addEventListener('click', () => openQuiz(8));
  $('#tPiano').addEventListener('click', openFree);
  (() => {
    const g = $('#gate'); let t = 0, opened = false;
    const cancel = () => { clearTimeout(t); g.classList.remove('holding'); };
    g.addEventListener('pointerdown', (e) => { e.preventDefault(); opened = false; g.classList.add('holding'); t = setTimeout(() => { opened = true; cancel(); openGrown(); }, 1500); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => g.addEventListener(ev, cancel));
    g.addEventListener('click', (e) => { if(e.detail === 0) openGrown(); else if(!opened) toast('Grown-ups: press and hold'); });
    g.addEventListener('contextmenu', (e) => e.preventDefault());
  })();

  /* ── Grown-ups ── */
  function seg(el, items, val, set){
    el.innerHTML = '';
    items.forEach(([v, label]) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
      b.setAttribute('aria-pressed', String(String(val) === String(v)));
      b.addEventListener('click', () => { set(v); save(); drawGrown(); });
      el.appendChild(b);
    });
  }
  function openGrown(){ show('grown'); drawGrown(); }
  function drawGrown(){
    const st = S();
    seg($('#gInput'), [['screen', 'On-screen keys'], ['midi', 'Keyboard cable'], ['mic', 'Microphone']], st.input, (v) => {
      st.input = v; if(v === 'midi') Midi.connect();
    });
    $('#gInputHelp').textContent = st.input === 'midi'
      ? (Midi.supported ? (midiStatus.state === 'connected' ? 'Connected: ' + midiStatus.names.join(', ') : 'Plug her keyboard into the Mac (Chrome). Waiting for it…') : 'This browser has no MIDI (iPad/iPhone Safari). Use Microphone here, or Chrome on the Mac.')
      : st.input === 'mic' ? 'Listens to any piano or keyboard speaker. Best in a quiet room, device close to the piano. Beta: re-striking the same key fast can be missed.'
      : 'She taps the keys on screen. Computer keys A S D F G H J K also play (Mac).';
    $('#gAppSound').checked = st.appSound;
    seg($('#gNames'), [['solf', 'Do Re Mi'], ['both', 'Do · C'], ['letter', 'C D E']], st.names, (v) => st.names = v);
    $('#gLabels').checked = st.labels; $('#gHints').checked = st.hints; $('#gVoice').checked = st.voice; $('#gBass').checked = st.bass;
    seg($('#gTempo'), [[60, 'Slow 60'], [76, 'Medium 76'], [92, 'Quick 92']], st.tempo, (v) => st.tempo = v);
    $('#gClick').checked = st.click; $('#gGuide').checked = st.guide;
    let lat = ''; try{ lat = localStorage.getItem('musicEco_latencyMs') || ''; }catch(e){}
    $('#gLat').value = lat;
    // songs table
    let rows = '<tr><th>Song</th><th>Best</th><th>Last Play!</th><th>Timing</th><th>Tries</th></tr>';
    SONGS.forEach(sg => {
      const rec = state.songs[sg.id]; if(!rec) { rows += `<tr><td>${sg.title}</td><td colspan="4" style="color:#9a90a8">not yet</td></tr>`; return; }
      const plays = rec.attempts.filter(a => a.mode === 'play'), last = plays[plays.length - 1];
      const timing = last && last.tally ? (Math.abs(last.bias) < 45 ? 'on the beat' : last.bias < 0 ? `${-last.bias} ms early` : `${last.bias} ms late`) + (last.sd ? ` · spread ${last.sd} ms` : '') : '—';
      rows += `<tr><td>${sg.title}</td><td>${'●'.repeat(rec.best || 0)}${'○'.repeat(3 - (rec.best || 0))}</td><td>${last ? last.score + (last.tally ? ` — ${last.tally.great} great, ${last.tally.good} good, ${last.tally.ok} early/late, ${last.tally.miss + last.tally.wrong} missed` : '') : '—'}</td><td>${timing}</td><td>${rec.attempts.length}</td></tr>`;
    });
    $('#gHist').innerHTML = rows;
    $('#gQuiz').innerHTML = [60, 62, 64, 65, 67, 48, 50, 52, 53, 55].map(m => {
      const q = state.quiz[m];
      const lab = (m < 60 ? 'low ' : '') + solf(m) + (q ? ` ${q.r}/${q.n}` : '');
      return `<span class="chip" style="background:${MC.colorOf(m)};color:${inkOn(m)};opacity:${q ? 1 : 0.35}">${lab}</span>`;
    }).join('');
    $('#gSummary').textContent = summaryText();
    $('#gStatus').textContent = `${state.days.length} practice day${state.days.length === 1 ? '' : 's'} · ${state.berries} strawberries`;
  }
  function summaryText(){
    const week = state.days.filter(d => d >= MC.addDays(MC.dayKey(new Date()), -6)).length;
    const parts = [`Practised on ${week} day${week === 1 ? '' : 's'} this week.`];
    const played = SONGS.map(sg => {
      const rec = state.songs[sg.id]; if(!rec) return null;
      const plays = rec.attempts.filter(a => a.mode === 'play');
      if(!plays.length) return `${sg.title}: learning`;
      const best = Math.max(...plays.map(a => a.score)), last = plays[plays.length - 1];
      const tm = Math.abs(last.bias) < 45 ? 'steady beat' : last.bias < 0 ? 'a bit early' : 'a bit late';
      return `${sg.title}: best ${best}/100, ${tm}`;
    }).filter(Boolean);
    if(played.length) parts.push(played.join('; ') + '.');
    const q = [60, 62, 64, 65, 67, 48, 50, 52, 53, 55].filter(m => state.quiz[m]).map(m => `${m < 60 ? 'low ' : ''}${solf(m)} ${state.quiz[m].r}/${state.quiz[m].n}`);
    if(q.length) parts.push(`Note reading: ${q.join(', ')}.`);
    return parts.join(' ');
  }
  const bindCheck = (id, key, after) => $(id).addEventListener('change', (e) => { S()[key] = e.target.checked; save(); if(after) after(); });
  bindCheck('#gAppSound', 'appSound'); bindCheck('#gLabels', 'labels'); bindCheck('#gHints', 'hints');
  bindCheck('#gVoice', 'voice'); bindCheck('#gBass', 'bass'); bindCheck('#gClick', 'click'); bindCheck('#gGuide', 'guide');
  $('#gLat').addEventListener('change', (e) => { const v = e.target.value.trim(); try{ if(v === '') localStorage.removeItem('musicEco_latencyMs'); else localStorage.setItem('musicEco_latencyMs', String(Math.max(0, Math.min(400, +v || 0)))); }catch(err){} });
  $('#gBack').addEventListener('click', () => show('home'));
  $('#gCopy').addEventListener('click', () => {
    const text = summaryText();
    const fallback = () => { const r = document.createRange(); r.selectNodeContents($('#gSummary')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast('Selected — tap Copy'); };
    try{ navigator.clipboard.writeText(text).then(() => toast('Copied'), fallback); }catch(e){ fallback(); }
  });
  (() => {
    const b = $('#gReset'); let armed = 0;
    b.addEventListener('click', () => {
      if(Date.now() - armed < 3000){ const keep = state.settings; state = load(); state.songs = {}; state.quiz = {}; state.days = []; state.berries = 0; state.settings = keep; save(); b.textContent = 'Reset all progress…'; drawGrown(); toast('Progress cleared'); armed = 0; return; }
      armed = Date.now(); b.textContent = 'Tap again to clear everything';
      setTimeout(() => { if(Date.now() - armed >= 2900) b.textContent = 'Reset all progress…'; }, 3100);
    });
  })();

  window.addEventListener('resize', () => { if(!$('#song').hidden && cur && !run) drawStaff(); });
  document.addEventListener('visibilitychange', () => { if(document.hidden){ stopRun(); micStop(); } });

  show('home');
  window.Garden = { SONGS, targetsOf, songBeats, verdictOf, scoreOf, berriesFor, timingSummary, distractors, staffSvg, WIN, POINTS,
    _state: () => state, _press: (m, src) => pressed(m, src || 'screen'), _run: () => run };
})();
