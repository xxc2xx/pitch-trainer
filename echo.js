/* echo.js — 🎤→🎹 Echo: hear a little tune, sing it back, then find it on
   the keyboard. Classic script → window.Echo. Depends on music-core.js.

   This is audiation, the core of the Kodály approach her class uses: hear it
   in your head before you play it. The curriculum follows the Kodály order
   (sol–mi first, then la, then mi–re–do, pentatonic, then fa/ti).

   Pure (tested in tools/core-test.mjs):
     Echo.STAGES                         [{ id, name, deg:[semitones from do] }]
     Echo.patterns(stage, len, rnd)      → [semitone offsets]  (a little tune)
     Echo.matchSung(pattern, sung)       → { ok, notes:[bool] }  (by intervals)
     Echo.liveSeg()                      → { push(mf|null, tMs) → note|null, count }
     Echo.adapt(state, good)             → next stage state

   UI:
     const echo = Echo.create({ host, audio, playNote, cancelNotes, mic, getKb, getLevel, onExit });
     echo.start({ rounds, onDone(result) })   echo.onKey(m)   echo.stop()   echo.active
*/
(function(){
  'use strict';
  const MC = window.MusicCore;

  // movable do: offsets in semitones from do
  const SYL = { '-5':'so', '-3':'la', 0:'do', 2:'re', 4:'mi', 5:'fa', 7:'sol', 9:'la', 11:'ti', 12:'do' };
  const STAGES = [
    { id:'sm',   name:'sol–mi',          deg:[7, 4] },
    { id:'sml',  name:'sol–mi–la',       deg:[4, 7, 9] },
    { id:'mrd',  name:'mi–re–do',        deg:[0, 2, 4] },
    { id:'drms', name:'do–re–mi–sol',    deg:[0, 2, 4, 7] },
    { id:'pent', name:'do re mi sol la', deg:[0, 2, 4, 7, 9] },
    { id:'low',  name:'+ low la, low sol', deg:[-5, -3, 0, 2, 4, 7, 9] },
    { id:'dia',  name:'all seven + high do', deg:[0, 2, 4, 5, 7, 9, 11, 12] },
  ];
  const LEN = [[2, 3], [3, 3], [3, 4], [3, 4], [4, 4], [4, 5], [4, 5]];

  // A little tune: mostly steps between neighbouring notes of the stage, the
  // odd skip, never one note repeated throughout. rnd() → [0,1) (seedable).
  function patterns(stage, len, rnd){
    rnd = rnd || Math.random;
    const deg = STAGES[Math.max(0, Math.min(STAGES.length - 1, stage))].deg;
    let i = Math.floor(rnd() * deg.length);
    const out = [deg[i]];
    for(let k = 1; k < len; k++){
      const r = rnd();
      let step = r < 0.42 ? -1 : r < 0.84 ? 1 : r < 0.92 ? 2 : -2;
      if(deg.length === 2) step = r < 0.75 ? (i === 0 ? 1 : -1) : 0;     // sol–mi: mostly swap, sometimes repeat
      i = Math.max(0, Math.min(deg.length - 1, i + step));
      out.push(deg[i]);
    }
    if(out.every(x => x === out[0])) out[out.length - 1] = deg[(deg.indexOf(out[0]) + 1) % deg.length];
    return out;
  }
  const syllable = o => SYL[o] || '';

  // Judge her singing by the SHAPE of the tune (intervals ±1 semitone): a
  // child rarely sings in the written key or octave, and close counts.
  function matchSung(pattern, sung){
    const notes = pattern.map((_, i) => {
      if(i >= sung.length) return false;
      if(i === 0) return true;
      let d = (sung[i] - sung[i - 1]) - (pattern[i] - pattern[i - 1]);
      if(Math.abs(d) > 6) d -= 12 * Math.round(d / 12);          // an octave slip isn't a wrong note
      return Math.abs(d) <= 1;
    });
    return { ok: notes.every(Boolean), notes };
  }

  // Live note segmentation for a sung answer. push() once per mic frame with
  // the pitch (midi float, null = silence) and a time in ms; returns the
  // finished note (median pitch) when one ends, else null.
  function liveSeg(o){
    o = o || {};
    const MIN_ON = o.minOn || 110, MIN_OFF = o.minOff || 90;
    let cur = null, gapSince = null, count = 0;
    const med = a => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
    function close(){ const n = { m: Math.round(med(cur.f)), on: cur.t0, off: cur.t1 }; cur = null; gapSince = null; count++; return n.off - n.on >= MIN_ON ? n : (count--, null); }
    return {
      push(mf, t){
        if(cur){
          const ref = med(cur.f);
          if(mf != null && Math.abs(mf - ref) < 0.8){ cur.f.push(mf); cur.t1 = t; gapSince = null; return null; }
          if(gapSince == null) gapSince = t;
          // a new pitch right away = a new note; silence must last MIN_OFF
          if(mf != null || t - gapSince >= MIN_OFF){
            const done = close();
            if(mf != null) cur = { f: [mf], t0: t, t1: t };
            return done;
          }
          return null;
        }
        if(mf != null) cur = { f: [mf], t0: t, t1: t };
        return null;
      },
      flush(){ return cur ? close() : null; },
      get count(){ return count; },
      get busy(){ return !!cur; },
    };
  }

  // 4 good rounds in a row → next stage; 2 misses in a row → shorter tunes
  function adapt(st, good){
    st = { stage: 0, streak: 0, misses: 0, short: 0, rounds: 0, good: 0, ...(st || {}) };
    st.rounds++;
    if(good){
      st.good++; st.streak++; st.misses = 0;
      if(st.streak >= 4 && st.stage < STAGES.length - 1){ st.stage++; st.streak = 0; st.short = 0; }
      else if(st.short > 0 && st.streak >= 2) st.short--;
    } else {
      st.streak = 0; st.misses++;
      if(st.misses >= 2){ st.short = Math.min(2, st.short + 1); st.misses = 0; }
    }
    return st;
  }
  function lenFor(st){ const [a, b] = LEN[st.stage] || [3, 4]; return Math.max(2, (st.rounds % 2 ? b : a) - (st.short || 0)); }

  // ── UI ────────────────────────────────────────────────────────────────
  const CSS = `
  .ec{display:flex;flex-direction:column;align-items:center;gap:12px;padding:6px 4px;}
  .ec-top{display:flex;align-items:center;gap:8px;width:100%;}
  .ec-top .t{flex:1;text-align:center;font-weight:800;color:#e6e6f5;}
  .ec-top small{color:#8a8ab8;font-weight:600;}
  .ec-bub{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;min-height:76px;align-items:flex-end;}
  .ec-b{width:58px;border-radius:16px;display:flex;flex-direction:column;align-items:center;justify-content:center;
    font-weight:800;color:#111;font-size:.95rem;opacity:.45;transition:transform .12s,opacity .12s;padding:8px 0;}
  .ec-b.on{opacity:1;transform:translateY(-6px) scale(1.08);}
  .ec-b i{font-style:normal;font-size:.62rem;font-weight:700;opacity:.75;}
  .ec-b.ok{outline:3px solid #9fe8b0;opacity:1;} .ec-b.no{outline:3px dashed #ffb74d;opacity:1;}
  .ec-step{font-size:1.15rem;font-weight:800;color:#fff;text-align:center;min-height:1.4em;}
  .ec-sub{font-size:.78rem;color:#9a9ac8;text-align:center;min-height:1.1em;}
  .ec-row{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;}
  .ec-dots{font-size:1.2rem;letter-spacing:.15em;min-height:1.4em;}
  `;
  function injectCSS(){ if(document.getElementById('echoCSS')) return; const s = document.createElement('style'); s.id = 'echoCSS'; s.textContent = CSS; document.head.appendChild(s); }
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

  function create(d){
    let active = false, state = null, round = null, onDone = null, roundsLeft = 0, results = [], micH = null;
    let micP = null, micErr = null, frameFn = null;     // one mic for the whole session
    let timers = [], seq = 0, t0 = 0;
    const later = (fn, ms) => { const id = setTimeout(fn, ms); timers.push(id); return id; };
    const host = d.host;

    function doFor(level, rnd){
      if(level.id === 'sprout') return 60;               // sol = G4, mi = E4: a child's singing range
      const keys = [60, 62, 65, 57];                     // C D F A — sol sits D4…D5
      return keys[Math.floor((rnd || Math.random)() * keys.length)];
    }

    async function start(o){
      o = o || {};
      injectCSS();
      stop(true);
      active = true; onDone = o.onDone || null; roundsLeft = o.rounds || 4; results = []; t0 = performance.now();
      // Open the mic NOW, synchronously inside the tap that started Echo: iOS
      // only unlocks audio in the gesture itself, and later rounds start from
      // timers. Frames are ignored except while she's singing, so the tune
      // coming out of the speaker is never judged.
      micErr = null;
      if(d.mic){
        try{ micP = Promise.resolve(d.mic(mf => { if(frameFn) frameFn(mf); })); }
        catch(e){ micP = Promise.reject(e); }
        const mine = micP;                                // a late answer from an older session is closed
        micP.then(h => { if(active && micP === mine) micH = h; else { try{ h.stop(); }catch(_){} } }, e => { if(micP === mine) micErr = e; });
      } else micErr = new Error('no microphone');
      try{ state = (MC.log && await MC.log.item('echo')) || null; }catch(e){ state = null; }
      state = { stage: 0, streak: 0, misses: 0, short: 0, rounds: 0, good: 0, ...(state || {}) };
      if(!active) return;
      nextRound();
    }

    function render(step, sub){
      const lv = d.getLevel();
      const st = STAGES[state.stage];
      host.innerHTML = `<div class="ec">
        <div class="ec-top"><button class="sg-btn" id="ecBack">←</button>
          <span class="t">🎤 Echo <small>· ${esc(st.name)} · ${results.length + 1}/${results.length + roundsLeft + 1}</small></span>
          <button class="sg-btn" id="ecAgain" title="Hear it again">🔊</button></div>
        <div class="ec-bub">${round.ms.map((m, i) => `<div class="ec-b" data-i="${i}" style="background:${MC.colorOf(m)}">${esc(syllable(round.pat[i]))}${lv.id !== 'sprout' ? `<i>${MC.midiName(m)}</i>` : ''}</div>`).join('')}</div>
        <div class="ec-step" id="ecStep">${step}</div>
        <div class="ec-dots" id="ecDots"></div>
        <div class="ec-sub" id="ecSub">${sub || ''}</div>
        <div class="ec-row"><button class="sg-btn" id="ecSkip">⏭ Skip singing</button></div>
      </div>`;
      host.querySelector('#ecBack').onclick = () => { stop(); d.onExit && d.onExit(); };
      host.querySelector('#ecAgain').onclick = () => { if(round.phase === 'sing' || round.phase === 'listen') playTune(true); };
      host.querySelector('#ecSkip').onclick = () => { if(round.phase === 'sing' || round.phase === 'listen') endSing(true); };
    }
    const $ = id => host.querySelector(id);
    function lit(i){ host.querySelectorAll('.ec-b').forEach(b => b.classList.toggle('on', +b.dataset.i === i)); }

    function nextRound(){
      if(roundsLeft <= 0) return finish();
      roundsLeft--;
      const lv = d.getLevel(), pat = patterns(state.stage, lenFor(state));
      const doM = doFor(lv);
      round = { id: ++seq, pat, ms: pat.map(o => doM + o), phase: 'listen', sung: [], judged: null, idx: 0, wrong: 0 };
      render('👂 Listen…', '');
      later(() => playTune(false), 500);
    }

    // play the tune; the mic stays OFF meanwhile (it would hear the speaker)
    function playTune(again){
      if(!active || !round) return;
      stopMic();
      const r = round; r.phase = 'listen';
      const ac = d.audio(), spb = 0.62, start = ac.currentTime + 0.15, tag = 'echo' + r.id;
      d.cancelNotes && d.cancelNotes(tag);
      r.ms.forEach((m, i) => {
        d.playNote(ac, m, start + i * spb, spb * 0.9, { vel: 90, tag });
        later(() => { if(round === r) lit(i); }, (0.15 + i * spb) * 1000);
      });
      later(() => {
        if(round !== r) return;
        lit(-1);
        if(again && r.judged) return;                   // replay during "play it": no new singing
        startSing();
      }, (0.15 + r.ms.length * spb + 0.25) * 1000);
      $('#ecStep') && ($('#ecStep').textContent = '👂 Listen…');
    }

    async function startSing(){
      const r = round; if(!active || !r) return;
      r.phase = 'sing'; r.sung = [];
      $('#ecStep').textContent = '🎤 Your turn — sing it!';
      $('#ecSub').textContent = '';
      if(micP) await micP.catch(() => {});
      if(round !== r || r.phase !== 'sing') return;
      if(micErr || !micH){
        $('#ecSub').textContent = '🎤 ' + ((micErr && micErr.message) || 'no microphone') + ' — just play it!';
        return endSing(true);
      }
      const seg = liveSeg(), began = performance.now();
      let lastNoteAt = 0;
      frameFn = mf => {
        if(round !== r || r.phase !== 'sing') return;
        const now = performance.now();
        const n = seg.push(mf, now);
        if(n){ r.sung.push(n.m); lastNoteAt = now; showSung(); }
        const quiet = !seg.busy && lastNoteAt && now - lastNoteAt > 1200;
        if(r.sung.length >= r.pat.length && !seg.busy) endSing();
        else if(quiet || now - began > 8000){ const f = seg.flush(); if(f) r.sung.push(f.m); endSing(); }
      };
    }
    function showSung(){ const el = $('#ecDots'); if(el) el.textContent = round.sung.map(() => '🟣').join(''); }
    function stopMic(){ frameFn = null; }                       // stop listening (mic stays open)
    function closeMic(){ frameFn = null; if(micH){ try{ micH.stop(); }catch(e){} micH = null; } micP = null; }

    function endSing(skipped){
      const r = round; if(!r || r.phase === 'play') return;
      stopMic();
      r.phase = 'play';
      r.skipped = !!skipped;
      r.judged = skipped ? null : matchSung(r.pat, r.sung);
      if(r.judged) host.querySelectorAll('.ec-b').forEach((b, i) => b.classList.add(r.judged.notes[i] ? 'ok' : 'no'));
      $('#ecDots').textContent = r.judged ? (r.judged.ok ? '🌟 Lovely singing!' : '🎵 Nice try!') : '';
      $('#ecStep').textContent = '🎹 Now find it on your keyboard';
      $('#ecSub').textContent = d.getLevel().id === 'sprout' ? 'The first key is glowing' : '';
      const sk = $('#ecSkip'); sk && sk.remove();
      target();
    }
    function target(){
      const kb = d.getKb(); if(!kb || !round) return;
      const lv = d.getLevel();
      // 🌱 gets the first key; anyone gets a hint after two wrong tries
      const show = round.idx < round.ms.length && ((lv.id === 'sprout' && round.idx === 0) || round.wrong >= 2);
      kb.setTarget(show ? round.ms[round.idx] : null);
    }

    function onKey(m){
      const r = round;
      if(!active || !r || r.phase !== 'play') return;
      const kb = d.getKb();
      if(m === r.ms[r.idx]){
        kb && kb.flash(m); lit(r.idx); r.idx++; r.wrong = 0;
        if(r.idx >= r.ms.length){ r.phase = 'done'; kb && kb.setTarget(null); later(() => endRound(r), 500); }
        else target();
      } else { r.wrong++; r.wrongTotal = (r.wrongTotal || 0) + 1; kb && kb.wobble(m); if(r.wrong === 2) target(); }
    }

    async function endRound(r){
      if(round !== r) return;
      // sang the shape (or had no mic) AND played it with at most one slip
      const sangOk = r.judged ? r.judged.ok : null;
      const good = (sangOk !== false) && (r.wrongTotal || 0) <= 1;
      const before = state.stage;
      state = adapt(state, good);
      results.push({ stage: before, pat: r.pat, sang: sangOk, wrong: r.wrongTotal || 0, good });
      try{ MC.log && await MC.log.setItem('echo', state); }catch(e){}
      lit(-1);
      $('#ecStep').textContent = good ? '⭐ Yes!' : '👍 You found it!';
      $('#ecSub').textContent = state.stage > before ? `🎉 New notes unlocked: ${STAGES[state.stage].name}` : '';
      later(nextRound, state.stage > before ? 1800 : 1000);
    }

    async function finish(){
      const res = { kind: 'echo', level: d.getLevel().id, durMs: Math.round(performance.now() - t0),
                    rounds: results.length, good: results.filter(x => x.good).length,
                    stars: results.length ? Math.max(1, Math.round(3 * results.filter(x => x.good).length / results.length)) : 1,
                    echo: { stage: state.stage, stageName: STAGES[state.stage].name, results } };
      try{ MC.log && await MC.log.add(res); }catch(e){}
      active = false; round = null; closeMic();
      const f = onDone; onDone = null;
      if(f) f(res);
      else {
        host.innerHTML = `<div class="ec"><div class="ec-step">🎤 ${res.good} of ${res.rounds} echoes! ${'⭐'.repeat(res.stars)}</div>
          <div class="ec-row"><button class="sg-btn go" id="ecMore">↺ More</button><button class="sg-btn" id="ecOut">🎵 Songs</button></div></div>`;
        host.querySelector('#ecMore').onclick = () => start({ rounds: 4 });
        host.querySelector('#ecOut').onclick = () => d.onExit && d.onExit();
      }
    }

    function stop(quiet){
      timers.forEach(clearTimeout); timers = [];
      closeMic();
      if(round) d.cancelNotes && d.cancelNotes('echo' + round.id);
      const kb = d.getKb(); kb && kb.setTarget(null);
      active = false; round = null;
      if(!quiet) onDone = null;
    }

    return { start, stop, onKey, get active(){ return active; }, get phase(){ return round && round.phase; },
             get _round(){ return round; }, get _state(){ return state; } };
  }

  window.Echo = { STAGES, patterns, matchSung, liveSeg, adapt, syllable, create };
})();
