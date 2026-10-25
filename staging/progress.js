/* progress.js — 📈 Progress: the parent's page (opened by holding ⚙︎).
   Classic script → window.Progress. Depends on music-core.js (MC.log) and,
   for names, notes.js / echo.js when present.

   She never sees numbers; this page is where they live:
     streak calendar · songs (learning / due / mastered) · Echo stage ·
     card accuracy per note (weak ones flagged) · writing scores ·
     timing trend from her keyboard · latency calibration · 📋 weekly summary

   Pure (tested): Progress.weekly({ sessions, items, titles, today }) → text
                  Progress.byDay(sessions) → { day: { min, n, timing:[…] } }
   UI: const pg = Progress.create({ host, titles: async → Map(id → title), audio, click(ac, when, accent) });
       pg.render()
*/
(function(){
  'use strict';
  const MC = window.MusicCore;
  const SYL = ['Do','Di','Re','Ri','Mi','Fa','Fi','Sol','Si','La','Li','Ti'];
  const GAME = { keys: '🃏 Keys', oct: '🔢 Octaves', g: '🎼 G clef', f: '🎼 F clef', write: '✏️ Writing' };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const noteName = m => SYL[MC.pc(m)] + (MC.octaveOf(m) !== 4 ? MC.octaveOf(m) : '');

  function byDay(sessions){
    const out = {};
    sessions.forEach(s => {
      const d = out[s.day] || (out[s.day] = { min: 0, n: 0, timing: [], write: [] });
      if(s.kind !== 'today' && s.kind !== 'g-today') d.min += mins(s);  // 'today' wraps the others
      d.n++;
      if(s.stats && s.stats.hit >= 3) d.timing.push(s.stats);
      if(s.kind === 'write' && s.score != null) d.write.push(s.score);
    });
    return out;
  }
  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  // Pitch Trainer sessions carry durMs; Music Garden sessions carry activeMs
  // (time actually playing, pauses excluded) — same store, same calendar.
  const mins = s => (s.durMs != null ? s.durMs : s.activeMs || 0) / 60000;

  function cardStats(items, game){
    return Object.entries(items).filter(([k]) => k.startsWith('card:' + game + ':'))
      .map(([k, v]) => ({ m: +k.split(':')[2], box: v.box || 1, n: v.n || 0, ok: v.ok || 0, acc: v.n ? v.ok / v.n : 0 }))
      .sort((a, b) => a.m - b.m);
  }

  // the text for her teacher — plain, short, no jargon
  function weekly(o){
    const today = o.today, from = MC.addDays(today, -6), items = o.items || {}, titles = o.titles || new Map();
    const week = (o.sessions || []).filter(s => s.day >= from && s.day <= today);
    const prev = (o.sessions || []).filter(s => s.day >= MC.addDays(today, -13) && s.day < from);
    const days = new Set(week.map(s => s.day)).size;
    const total = Math.round(week.filter(s => s.kind !== 'today' && s.kind !== 'g-today').reduce((a, s) => a + mins(s), 0));
    const lines = [`Week of ${from}: practised ${days}/7 days, ${total} min.`];
    const songs = Object.entries(items).filter(([k]) => k.startsWith('song:'));
    const learning = songs.filter(([, v]) => !v.mastered && (v.phrase || v.phrases));
    const mastered = songs.filter(([, v]) => v.mastered);
    const nm = k => titles.get(k.slice(5)) || k.slice(5);
    if(learning.length) lines.push('Learning: ' + learning.map(([k, v]) => `${nm(k)} (part ${Math.min((v.phrase || 0) + 1, v.phrases || 1)}/${v.phrases || '?'})`).join(', ') + '.');
    if(mastered.length) lines.push('Can play: ' + mastered.map(([k]) => nm(k)).join(', ') + '.');
    const ec = items.echo;
    if(ec && window.Echo) lines.push(`Sing-back (Echo): ${Echo.STAGES[ec.stage] ? Echo.STAGES[ec.stage].name : 'stage ' + (ec.stage + 1)}, ${ec.rounds ? Math.round(100 * ec.good / ec.rounds) : 0}% good.`);
    const read = ['keys', 'oct', 'g', 'f'].map(g => {
      const c = cardStats(items, g).filter(x => x.n);
      if(!c.length) return null;
      const acc = Math.round(100 * c.reduce((a, x) => a + x.ok, 0) / c.reduce((a, x) => a + x.n, 0));
      const weak = c.filter(x => x.n >= 3 && x.acc < 0.7).map(x => noteName(x.m));
      return `${GAME[g].replace(/^\S+ /, '')} ${acc}%` + (weak.length ? ` (practise ${weak.join(', ')})` : '');
    }).filter(Boolean);
    if(read.length) lines.push('Reading: ' + read.join('; ') + '.');
    const ws = week.filter(s => s.kind === 'write' && s.score != null).map(s => s.score);
    if(ws.length) lines.push(`Writing notes: ${Math.round(avg(ws))}/100.`);
    const tw = week.filter(s => s.stats && s.stats.hit >= 3).map(s => s.stats), tp = prev.filter(s => s.stats && s.stats.hit >= 3).map(s => s.stats);
    if(tw.length){
      const m = Math.round(avg(tw.map(t => t.meanAbsMs))), b = Math.round(avg(tw.map(t => t.biasMs)));
      const was = tp.length ? Math.round(avg(tp.map(t => t.meanAbsMs))) : null;
      lines.push(`Timing (her keyboard): avg ${m} ms from the beat${Math.abs(b) > 30 ? (b < 0 ? ', slightly rushing' : ', slightly late') : ''}${was != null ? ` (was ${was} ms)` : ''}.`);
    }
    // Music Garden (the kid app): Play! scores and staff-reading quiz
    const gPlay = week.filter(s => s.kind === 'g-song' && s.mode === 'play' && s.status === 'completed' && s.summary && s.summary.score != null);
    if(gPlay.length){
      const best = {};
      gPlay.forEach(s => { const k = s.title || s.contentId; best[k] = Math.max(best[k] || 0, s.summary.score); });
      lines.push('Garden songs (best Play! score): ' + Object.entries(best).map(([k, v]) => `${k} ${v}`).join(', ') + '.');
    }
    const gq = week.filter(s => s.kind === 'g-quiz' && s.summary && s.summary.n);
    if(gq.length){
      const r = gq.reduce((a, s) => a + (s.summary.right || 0), 0), n = gq.reduce((a, s) => a + s.summary.n, 0);
      lines.push(`Garden note quiz: ${r}/${n} right first time.`);
    }
    return lines.join('\n');
  }

  const CSS = `
  .pg{display:flex;flex-direction:column;gap:12px;width:100%;}
  .pg h4{margin:4px 2px;font-size:.78rem;letter-spacing:.06em;text-transform:uppercase;color:#8a8ab8;}
  .pg-box{background:#0e0d1a;border:1px solid #1e1e38;border-radius:12px;padding:10px;color:#c8c8f0;font-size:.8rem;}
  .pg-cal{display:grid;grid-template-columns:repeat(8,1fr);gap:3px;max-width:240px;}
  .pg-cal i{aspect-ratio:1;border-radius:3px;background:#17172e;display:block;}
  .pg-row{display:flex;justify-content:space-between;gap:8px;padding:3px 0;border-bottom:1px solid #16162c;}
  .pg-row:last-child{border-bottom:none;}
  .pg-chips{display:flex;flex-wrap:wrap;gap:4px;} .pg-chips span{padding:2px 7px;border-radius:10px;background:#1e1e3a;font-weight:700;}
  .pg-chips span.weak{background:#4a2a10;color:#ffcc80;} .pg-chips span.good{background:#1f4a2e;color:#c8f5d0;}
  .pg-big{font-size:1.3rem;font-weight:800;color:#fff;}
  .pg canvas{width:100%;height:110px;display:block;}
  .pg textarea{width:100%;min-height:120px;background:#0a0a18;color:#c8c8f0;border:1px solid #1e1e38;border-radius:8px;font:inherit;font-size:.78rem;padding:8px;}
  `;
  function injectCSS(){ if(document.getElementById('pgCSS')) return; const s = document.createElement('style'); s.id = 'pgCSS'; s.textContent = CSS; document.head.appendChild(s); }

  function create(d){
    const host = d.host;
    async function render(){
      injectCSS();
      const today = MC.dayKey(new Date());
      let sessions = [], items = {}, titles = new Map();
      try{ sessions = await MC.log.range(MC.addDays(today, -55), today); }catch(e){}
      try{ items = await MC.log.items(); }catch(e){}
      try{ titles = await d.titles(); }catch(e){}
      const days = byDay(sessions);
      const streak = MC.streak(sessions.filter(s => s.kind === 'today').map(s => s.day), today);
      const week = Object.entries(days).filter(([k]) => k >= MC.addDays(today, -6));
      const weekMin = Math.round(week.reduce((a, [, v]) => a + v.min, 0));
      // calendar: 8 columns (weeks) × 7 rows, today bottom-right
      const cells = [];
      for(let r = 0; r < 7; r++) for(let c = 0; c < 8; c++){
        const back = (7 - c) * 7 + (6 - r), day = MC.addDays(today, -back), v = days[day];
        const a = v ? Math.min(1, 0.25 + v.min / 15) : 0;
        cells.push(`<i title="${day}${v ? ' · ' + Math.round(v.min) + ' min' : ''}" style="${v ? `background:rgba(67,160,71,${a.toFixed(2)})` : ''}"></i>`);
      }
      const songs = Object.entries(items).filter(([k]) => k.startsWith('song:')).map(([k, v]) => ({ id: k.slice(5), ...v }));
      const songRows = songs.map(s => `<div class="pg-row"><span>${esc(titles.get(s.id) || s.id)}</span><span>${s.mastered
        ? `✅ can play · next ${s.srs && s.srs.due <= today ? '<b>due now</b>' : 'review ' + (s.srs ? s.srs.due : '')}`
        : `🎹 part ${Math.min((s.phrase || 0) + 1, s.phrases || 1)}/${s.phrases || '?'}${s.wins ? ' · ' + s.wins + '× 3★' : ''}`}</span></div>`).join('') || '<div>No songs started yet — 🌟 Today picks one.</div>';
      const ec = items.echo;
      const echoTxt = ec && window.Echo ? `${esc(Echo.STAGES[ec.stage] ? Echo.STAGES[ec.stage].name : '')} · ${ec.rounds ? Math.round(100 * ec.good / ec.rounds) : 0}% good of ${ec.rounds || 0}` : 'Not started';
      const cardsHtml = ['keys', 'oct', 'g', 'f', 'write'].map(g => {
        const c = cardStats(items, g); if(!c.length) return '';
        return `<div style="margin:4px 0"><b>${GAME[g]}</b> <div class="pg-chips">${c.map(x => `<span class="${x.n >= 3 && x.acc < 0.7 ? 'weak' : x.box >= 4 ? 'good' : ''}" title="box ${x.box} · ${x.ok}/${x.n}">${noteName(x.m)} ${x.n ? Math.round(100 * x.acc) + '%' : ''}</span>`).join('')}</div></div>`;
      }).join('') || 'No cards yet — try 🧠 Notes.';
      const lat = (() => { try{ return localStorage.getItem(MC.adoptKey('musicEco_latencyMs')); }catch(e){ return null; } })();
      host.innerHTML = `<div class="pg">
        <div class="pg-box"><span class="pg-big">🔥 ${streak}</span> day streak · ${weekMin} min this week</div>
        <h4>Last 8 weeks</h4><div class="pg-box"><div class="pg-cal">${cells.join('')}</div></div>
        <h4>Songs</h4><div class="pg-box">${songRows}</div>
        <h4>🎤 Echo (sing it, then play it)</h4><div class="pg-box">${echoTxt}</div>
        <h4>🧠 Reading &amp; writing</h4><div class="pg-box">${cardsHtml}<div style="margin-top:6px;color:#8a8ab8">orange = needs practice (under 70 %), green = solid</div></div>
        <h4>🎯 Timing on her keyboard</h4><div class="pg-box"><canvas id="pgTiming"></canvas>
          <div id="pgTimingTxt" style="color:#8a8ab8"></div></div>
        <h4>🎧 Speaker delay</h4><div class="pg-box">Bluetooth speakers play late, which makes her look late. Calibrate once per speaker:
          <div style="display:flex;gap:8px;align-items:center;margin-top:6px"><button class="sg-btn" id="pgCal">🎧 Tap with the clicks</button>
          <span id="pgLat">${lat != null ? 'now ' + lat + ' ms' : 'not set (using the browser’s guess)'}</span></div>
          <button class="sg-btn go" id="pgTap" style="display:none;width:100%;margin-top:8px;padding:22px;font-size:1.2rem">TAP</button></div>
        <h4>📋 For her teacher</h4><div class="pg-box"><textarea id="pgWeek" readonly></textarea>
          <button class="sg-btn" id="pgCopy" style="margin-top:6px">📋 Copy weekly summary</button> <span id="pgCopied" style="color:#9fe8b0"></span></div>
      </div>`;
      drawTiming(days, today);
      const txt = weekly({ sessions, items, titles, today });
      host.querySelector('#pgWeek').value = txt;
      host.querySelector('#pgCopy').onclick = async () => {
        let ok = false;
        try{ await navigator.clipboard.writeText(txt); ok = true; }catch(e){ const ta = host.querySelector('#pgWeek'); ta.select(); try{ ok = document.execCommand('copy'); }catch(_){} }
        host.querySelector('#pgCopied').textContent = ok ? 'Copied ✓' : 'Select the text and copy it';
      };
      host.querySelector('#pgCal').onclick = calibrate;
    }

    function drawTiming(days, today){
      const cv = host.querySelector('#pgTiming'), txt = host.querySelector('#pgTimingTxt');
      const pts = [];
      for(let k = 27; k >= 0; k--){ const day = MC.addDays(today, -k), v = days[day]; if(v && v.timing.length) pts.push({ k: 27 - k, ms: avg(v.timing.map(t => t.meanAbsMs)), bias: avg(v.timing.map(t => t.biasMs)) }); }
      const W = cv.clientWidth || 300, H = 110, dpr = window.devicePixelRatio || 1;
      cv.width = W * dpr; cv.height = H * dpr; const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      if(!pts.length){ txt.textContent = 'No Play-along runs on her keyboard yet (last 4 weeks).'; return; }
      const max = Math.max(150, ...pts.map(p => p.ms)), x = k => 8 + k / 27 * (W - 16), y = ms => H - 8 - ms / max * (H - 16);
      g.strokeStyle = '#2a2a50'; g.beginPath(); g.moveTo(8, y(50)); g.lineTo(W - 8, y(50)); g.stroke();
      g.fillStyle = '#6a6a9a'; g.font = '10px sans-serif'; g.fillText('50 ms', 10, y(50) - 3);
      g.strokeStyle = '#7fd6ff'; g.lineWidth = 2; g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(x(p.k), y(p.ms)) : g.moveTo(x(p.k), y(p.ms))); g.stroke();
      g.fillStyle = '#7fd6ff'; pts.forEach(p => { g.beginPath(); g.arc(x(p.k), y(p.ms), 3, 0, Math.PI * 2); g.fill(); });
      const last = pts[pts.length - 1];
      txt.textContent = `Latest: ${Math.round(last.ms)} ms from the beat${Math.abs(last.bias) > 30 ? (last.bias < 0 ? ' (rushing)' : ' (late)') : ' (centred)'} · lower is steadier · 4 weeks`;
    }

    // 8 clicks; she (or you) taps each one. median(tap − click) = what the
    // speaker adds. Stored for Play along's judging.
    function calibrate(){
      const ac = d.audio(), tapBtn = host.querySelector('#pgTap'), lab = host.querySelector('#pgLat');
      const spb = 0.6, t0 = ac.currentTime + 0.8, clicks = [];
      for(let k = 0; k < 12; k++){ clicks.push(t0 + k * spb); d.click(ac, t0 + k * spb, k % 4 === 0); }
      const offs = [];
      tapBtn.style.display = 'block'; lab.textContent = 'Tap on every click (skip the first 4)…';
      tapBtn.onpointerdown = () => {
        const t = ac.currentTime, near = clicks.reduce((a, c) => Math.abs(c - t) < Math.abs(a - t) ? c : a);
        if(clicks.indexOf(near) >= 4 && Math.abs(t - near) < spb / 2) offs.push((t - near) * 1000);
      };
      setTimeout(() => {
        tapBtn.style.display = 'none'; tapBtn.onpointerdown = null;
        if(offs.length < 4){ lab.textContent = 'Not enough taps — try again'; return; }
        const s = offs.slice().sort((a, b) => a - b), med = Math.max(0, Math.round(s[s.length >> 1]));
        try{ localStorage.setItem(MC.adoptKey('musicEco_latencyMs'), String(med)); }catch(e){}
        lab.textContent = `now ${med} ms ✓`;
      }, (0.8 + 12 * spb + 0.5) * 1000);
    }

    return { render };
  }

  window.Progress = { weekly, byDay, cardStats, create };
})();
