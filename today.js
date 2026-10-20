/* today.js — 🌟 Today: a short daily lesson that decides what to practise.
   Classic script → window.Today. Depends on music-core.js (MC.log, srsNext,
   streak), songs.js (songs.play) and echo.js.

   One session, sized by level (🌱 ~5 min · 🌸 ~10 · 🌳 ~15):
     1. 🎤 Echo warm-up      sing-then-play rounds at her current stage
     2. 🎹 Learn             the learning song, one phrase further:
                             👆 Step by step, then 🎵 Play along on that phrase
                             (all phrases done → the whole song, 3★ twice = mastered)
     3. 🔁 Review            songs that are due again (spaced repetition)
     4. 🎁 Reward            sticker + streak

   Learning order: her class songs first, then her own, then the starters.
   Song state lives in MC.log items 'song:<id>':
     { phrase, phrases, wins, mastered, srs:{…MC.srsNext} }

   Pure (tested): Today.plan({ songs, items, level, today }) → { steps, minutes }
                  Today.phrases(song, level) → [{ from, to }]  (beats)
                  Today.afterSong(state, step, result, today) → new song state
*/
(function(){
  'use strict';
  const MC = window.MusicCore;
  const MINUTES = { sprout: 5, bloom: 10, grow: 15 };
  const ECHO_ROUNDS = { sprout: 3, bloom: 4, grow: 5 };
  const REVIEWS = { sprout: 1, bloom: 2, grow: 3 };
  const DONE_KEY = 'musicEco_today';          // { day, done:[step index…] } — resume where she stopped

  const bpbOf = t => t.timeSig ? t.timeSig[0] * 4 / t.timeSig[1] : 4;

  // Bite-size phrases: 2 bars (4 at 🌳), only ones that contain notes. A
  // practice part set in ✏️ Fix limits it to that part.
  function phrases(song, level){
    const notes = song.notes || [];
    if(!notes.length) return [];
    const bars = level === 'grow' ? 4 : 2, len = bars * bpbOf(song);
    const lo = song.section && song.section.to != null ? song.section.from : 0;
    const hi = song.section && song.section.to != null ? song.section.to : Math.max(...notes.map(n => n.t + n.d));
    const out = [];
    for(let f = lo; f < hi - 1e-6; f += len){
      const to = Math.min(hi, f + len);
      if(notes.some(n => n.t >= f - 1e-6 && n.t < to)) out.push({ from: f, to });
    }
    return out;
  }

  function order(songs){
    const rank = t => t.tag === 'class' ? 0 : t.source === 'builtin' ? 2 : 1;
    return songs.slice().sort((a, b) => rank(a) - rank(b) || (a.createdAt || 0) - (b.createdAt || 0));
  }

  function plan(o){
    const level = o.level || 'sprout', today = o.today || MC.dayKey(new Date()), items = o.items || {};
    const songs = order((o.songs || []).filter(s => s.notes && s.notes.length >= 3));
    const steps = [{ kind: 'echo', rounds: ECHO_ROUNDS[level] || 4 }];
    const learning = songs.find(s => !(items['song:' + s.id] || {}).mastered);
    if(learning){
      const st = items['song:' + learning.id] || {}, ph = phrases(learning, level);
      const k = st.phrase || 0;
      if(k < ph.length) steps.push({ kind: 'learn', songId: learning.id, phrase: k, phrases: ph.length, section: ph[k] });
      else steps.push({ kind: 'learn', songId: learning.id, phrase: ph.length, phrases: ph.length, section: null, whole: true });
    }
    const due = songs.filter(s => { const st = items['song:' + s.id]; return st && st.mastered && st.srs && st.srs.due <= today; })
                     .sort((a, b) => items['song:' + a.id].srs.due.localeCompare(items['song:' + b.id].srs.due))
                     .slice(0, REVIEWS[level] || 1);
    due.forEach(s => steps.push({ kind: 'review', songId: s.id }));
    steps.push({ kind: 'reward' });
    return { steps, minutes: MINUTES[level] || 10, today };
  }

  // song state after a step's Play-along (or Step-by-step) result
  function afterSong(st, step, res, today){
    st = { phrase: 0, wins: 0, mastered: false, ...(st || {}) };
    if(step.kind === 'learn'){
      if(res.mode !== 'timed') return st;                         // step-by-step is the warm-up
      if(step.whole){
        st.wins = res.stars >= 3 ? (st.wins || 0) + 1 : st.wins;
        if(st.wins >= 2){ st.mastered = true; st.srs = MC.srsNext(null, 3, today); }
      } else if(res.stars >= 2) st.phrase = Math.max(st.phrase || 0, step.phrase + 1);
      st.phrases = step.phrases;
    } else if(step.kind === 'review'){
      st.srs = MC.srsNext(st.srs, res.stars, today);
      if(res.stars <= 1){ st.wins = 0; }                          // shaky: it comes back tomorrow
    }
    return st;
  }

  // ── UI ────────────────────────────────────────────────────────────────
  const CSS = `
  .td{display:flex;flex-direction:column;align-items:center;gap:14px;padding:10px 4px;}
  .td-chips{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;}
  .td-chip{background:#1e1e3a;border:2px solid #34346a;border-radius:20px;padding:6px 12px;font-weight:800;color:#9a9ac8;font-size:.85rem;}
  .td-chip.done{background:#1f4a2e;border-color:#43a047;color:#c8f5d0;} .td-chip.now{border-color:#ffd54f;color:#fff;}
  .td-big{font-size:1.3rem;font-weight:800;color:#fff;text-align:center;}
  .td-sub{font-size:.82rem;color:#9a9ac8;text-align:center;}
  .td-fire{font-size:1rem;color:#ffb74d;font-weight:800;}
  .sg-today .chips{font-size:.95rem;letter-spacing:.1em;} .sg-today .st{color:#ffb74d;}
  `;
  function injectCSS(){ if(document.getElementById('todayCSS')) return; const s = document.createElement('style'); s.id = 'todayCSS'; s.textContent = CSS; document.head.appendChild(s); }
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const ICON = { echo: '🎤', learn: '🎹', review: '🔁', reward: '🎁' };
  const NAME = { echo: 'Echo', learn: 'Learn', review: 'Review', reward: 'Prize' };

  function readDone(today){ try{ const v = JSON.parse(localStorage.getItem(DONE_KEY)); return v && v.day === today ? v.done : []; }catch(e){ return []; } }
  function writeDone(today, done){ try{ localStorage.setItem(DONE_KEY, JSON.stringify({ day: today, done })); }catch(e){} }

  function create(d){
    // d: { host, songs, echo, getLevel, listSongs: async → takes, onExit, sticker(id) }
    let busy = false, cur = null, t0 = 0;
    const host = d.host;

    async function streakNow(today){
      try{ const s = await MC.log.range(MC.addDays(today, -60), today); return MC.streak([...new Set(s.filter(x => x.kind === 'today').map(x => x.day))], today); }
      catch(e){ return 0; }
    }

    async function build(){
      const today = MC.dayKey(new Date()), level = d.getLevel().id;
      let songs = [], items = {};
      try{ songs = await d.listSongs(); }catch(e){}
      try{ items = await MC.log.items(); }catch(e){}
      const p = plan({ songs, items, level, today });
      p.songs = new Map(songs.map(s => [s.id, s])); p.items = items;
      return p;
    }

    // the shelf card: placeholder now, filled in when the plan is known
    function card(){
      setTimeout(fillCard, 0);
      return `<div class="sg-card sg-today" id="sgToday"><span class="ic">🌟</span><span>Today</span>
        <span class="chips">🎤 🎹 🔁 🎁</span><span class="st">&nbsp;</span></div>`;
    }
    async function fillCard(){
      const el = document.getElementById('sgToday'); if(!el) return;
      const p = await build(), done = readDone(p.today), n = await streakNow(p.today);
      const all = done.length >= p.steps.length;
      el.querySelector('.chips').textContent = p.steps.map((s, i) => done.includes(i) ? '✅' : ICON[s.kind]).join(' ');
      el.querySelector('.st').textContent = (all ? 'Done today ✓ ' : `~${p.minutes} min `) + (n ? `🔥 ${n}` : '');
    }

    async function start(){
      injectCSS();
      busy = true; t0 = performance.now();
      cur = await build();
      cur.done = readDone(cur.today);
      next(true);
    }

    function screen(big, sub, btn, fn){
      busy = true;
      const done = cur.done;
      const i = cur.steps.findIndex((_, k) => !done.includes(k));
      host.innerHTML = `<div class="td">
        <div class="td-chips">${cur.steps.map((s, k) => `<span class="td-chip ${done.includes(k) ? 'done' : k === i ? 'now' : ''}">${ICON[s.kind]} ${NAME[s.kind]}</span>`).join('')}</div>
        <div class="td-big">${big}</div><div class="td-sub">${sub || ''}</div>
        <div class="sg-ctrl"><button class="sg-btn go" id="tdGo">${btn}</button><button class="sg-btn" id="tdOut">🎵 Songs</button></div></div>`;
      // the Go tap is the user gesture the next step needs (audio, mic on iOS)
      host.querySelector('#tdGo').onclick = fn;
      host.querySelector('#tdOut').onclick = () => { busy = false; d.onExit && d.onExit(); };
    }

    function next(first, cheer){
      const i = cur.steps.findIndex((_, k) => !cur.done.includes(k));
      if(i < 0) return reward(true);
      if(cheer && cur.steps[i].kind === 'reward') return reward(false, i, cheer);
      const s = cur.steps[i];
      if(s.kind === 'reward') return reward(false, i);
      const song = s.songId && cur.songs.get(s.songId);
      const what = s.kind === 'echo' ? `🎤 Echo — sing it, then play it`
        : s.kind === 'learn' ? `🎹 ${esc(song ? song.title : '')}${s.whole ? ' — the whole song!' : ` — part ${s.phrase + 1} of ${s.phrases}`}`
        : `🔁 ${esc(song ? song.title : '')} again`;
      const sub = s.kind === 'echo' ? `${s.rounds} little tunes` : s.kind === 'learn' ? (s.whole ? 'Play along — 3 stars twice and it’s yours ⭐' : 'First step by step, then play along') : 'Play along';
      screen((cheer ? cheer + '<br><small style="font-size:.8em;color:#c8c8f0">Next: ' : '') + (first ? `🌟 Today: ${what}` : what) + (cheer ? '</small>' : ''),
             sub, first ? '▶ Start' : 'Next ▶', () => run(i));
    }

    function mark(i){ if(!cur.done.includes(i)) cur.done.push(i); writeDone(cur.today, cur.done); }

    function run(i){
      const s = cur.steps[i];
      busy = false;
      if(s.kind === 'echo'){
        busy = true;                                   // Echo draws in the same view
        d.echo.start({ rounds: s.rounds, onDone: r => { mark(i); next(false, `🎤 ${r.good} of ${r.rounds} echoes!`); } });
        return;
      }
      const song = cur.songs.get(s.songId);
      if(!song){ mark(i); return next(); }
      const t = s.section ? { ...song, section: s.section } : (s.kind === 'review' ? { ...song, section: null } : song);
      const save = async res => {
        try{
          const key = 'song:' + song.id;
          const st = afterSong(cur.items[key], s, res, cur.today);
          cur.items[key] = st; await MC.log.setItem(key, st);
        }catch(e){}
      };
      if(s.kind === 'learn' && !s.whole){
        d.songs.play(t, { mode: 'wait', onDone: async r1 => {
          await save(r1);
          screen('👏 Now play along!', 'The music plays — tap each note as it reaches the line', '🎵 Play along', () => {
            busy = false;
            d.songs.play(t, { mode: 'timed', onDone: async r2 => { await save(r2); mark(i); after(r2); } });
          });
        } });
      } else {
        d.songs.play(t, { mode: 'timed', onDone: async r => { await save(r); mark(i); after(r); } });
      }
    }
    function after(r){
      d.songs.release();
      const say = r.stars >= 3 ? '⭐⭐⭐ Wonderful!' : r.stars === 2 ? '⭐⭐ Great playing!' : '⭐ Good practice!';
      next(false, say);
    }

    async function reward(already, i, cheer){
      if(i != null) mark(i);
      if(!already){
        try{ await MC.log.add({ kind: 'today', level: d.getLevel().id, durMs: Math.round(performance.now() - t0), steps: cur.steps.map(s => s.kind) }); }catch(e){}
        d.sticker && d.sticker('today');
      }
      const n2 = await streakNow(cur.today);
      busy = true;
      host.innerHTML = `<div class="td">
        <div class="td-chips">${cur.steps.map(s => `<span class="td-chip done">${ICON[s.kind]} ${NAME[s.kind]}</span>`).join('')}</div>
        ${cheer ? `<div class="td-sub" style="font-size:1rem;color:#ffd54f">${cheer}</div>` : ''}
        <div class="td-big">🎁 All done for today!</div>
        <div class="td-fire">${n2 ? `🔥 ${n2} day${n2 > 1 ? 's' : ''} in a row` : ''}</div>
        <div class="td-sub">See you tomorrow 🌙 — or play anything you like!</div>
        <div class="sg-ctrl"><button class="sg-btn go" id="tdOut">🎵 Songs</button></div></div>`;
      host.querySelector('#tdOut').onclick = () => { busy = false; d.onExit && d.onExit(); };
    }

    return { start, card, get busy(){ return busy; }, stop(){ busy = false; }, get _plan(){ return cur; } };
  }

  window.Today = { plan, phrases, afterSong, create, MINUTES };
})();
