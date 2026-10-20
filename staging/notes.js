/* notes.js — 🧠 Notes: reading and writing notes, the Yamaha way (fixed do).
   Classic script → window.Notes. Depends on music-core.js.

   Games
     🃏 keys    a key lights up on the piano → pick its name out of 3
     🔢 oct     one of three Do (or Mi/Sol) keys lights → low / middle / high
     🎼 g / f   a note on the G clef (F clef unlocks later) → pick its name,
                or press it on her keyboard
     ✏️ write   put / trace / write a note on the staff with a finger → score

   Retrieval practice + spaced repetition: she answers BEFORE seeing the
   answer; each card has a Leitner box (1–5) and comes back when due; a missed
   card returns later in the same round. A new note joins a deck once the
   last answers are ≥ 85 % right.

   Pure (tested in tools/core-test.mjs):
     Notes.nameOf(m, levelId)             'Do' | 'Do · C' | 'C'
     Notes.choices(answer, pool, rnd)     3 distinct answers, one right
     Notes.box(card, ok, today)           Leitner step
     Notes.deckAfter(meta, ok)            unlock bookkeeping
     Notes.pickRound(kind, n, ctx)        which cards this round
     Notes.traceScore(guide, user, r)     0–100
     Notes.analyzeWrite(strokes, geo)     { head, step, closed, stem }
     Notes.scoreWrite(strokes, geo, target, levelId)  { score, … }

   UI: const notes = Notes.create({ host, getKb, getLevel, audio, playNote, cancelNotes, onPiano(show) });
       notes.show() / hide() / onKey(m) / start({ game, n, onDone })   notes.active
*/
(function(){
  'use strict';
  const MC = window.MusicCore;
  const SYL = ['Do','Di','Re','Ri','Mi','Fa','Fi','Sol','Si','La','Li','Ti'];
  const LET = ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
  const OCT_NAME = { 3: 'low', 4: 'middle', 5: 'high' };
  const SHAPE_ICON = { square: '🟦', circle: '⚪', triangle: '🔺' };

  // Order new notes join each deck — do-re-mi first, like her class
  const ORDER = {
    keys: [60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 59, 57, 55, 53, 52, 50, 48],
    oct:  [48, 60, 72, 52, 64, 76, 55, 67, 79],          // Do ×3, then Mi ×3, then Sol ×3
    g:    [60, 67, 62, 64, 65, 69, 71, 72, 74, 76, 77, 79],   // landmarks Middle C + Treble G first
    f:    [53, 60, 55, 52, 57, 50, 59, 48, 47, 45, 43],        // Bass F + Middle C first
    write:[60, 62, 64, 65, 67, 69, 71, 72],
  };
  const START = { keys: 3, oct: 3, g: 3, f: 3, write: 3 };
  const BOX_DAYS = [0, 0, 1, 2, 4, 8];                    // box 1 = today again … box 5 = in 8 days

  // ── Names ─────────────────────────────────────────────────────────────
  function nameOf(m, level){
    const p = MC.pc(m);
    if(level === 'grow') return LET[p];
    if(level === 'bloom') return SYL[p] + ' · ' + LET[p];
    return SYL[p];
  }
  function octName(m){ return OCT_NAME[MC.octaveOf(m)] || (MC.octaveOf(m) < 3 ? 'low' : 'high'); }

  // 3 answers: the right one, a neighbour, and one further away — all with
  // different names (pitch classes), shuffled
  function choices(answer, pool, rnd){
    rnd = rnd || Math.random;
    const pcs = new Set([MC.pc(answer)]), out = [answer];
    const cand = [...new Set(pool.concat([answer - 2, answer - 1, answer + 1, answer + 2, answer + 4, answer - 4, answer + 5, answer - 5]))]
      .filter(m => !MC.isBlack(m) || MC.isBlack(answer));
    const near = cand.filter(m => Math.abs(m - answer) <= 2 && !pcs.has(MC.pc(m)));
    const far = cand.filter(m => Math.abs(m - answer) > 2 && !pcs.has(MC.pc(m)));
    const take = a => { const m = a[Math.floor(rnd() * a.length)]; if(m != null && !pcs.has(MC.pc(m))){ pcs.add(MC.pc(m)); out.push(m); } };
    if(near.length) take(near);
    for(let k = 0; k < 6 && out.length < 3; k++) take(far.filter(m => !pcs.has(MC.pc(m))));
    for(let k = 0; k < 6 && out.length < 3; k++) take(cand.filter(m => !pcs.has(MC.pc(m))));
    for(let i = out.length - 1; i > 0; i--){ const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
    return out;
  }

  // ── Spaced repetition ─────────────────────────────────────────────────
  function box(card, ok, today){
    card = { box: 1, n: 0, ok: 0, ...(card || {}) };
    card.n++; if(ok) card.ok++;
    // up one box per DAY at most (spacing needs time); a miss always resets
    if(!ok) card.box = 1;
    else if(card.last !== today || card.n === 1) card.box = Math.min(5, card.box + 1);
    card.due = MC.addDays(today, BOX_DAYS[card.box]);
    card.last = today;
    return card;
  }
  // unlock the next note once the recent answers are ≥ 85 % right
  function deckAfter(meta, ok, kind){
    meta = { unlocked: START[kind] || 3, recent: [], since: 0, ...(meta || {}) };
    meta.recent = meta.recent.concat(ok ? 1 : 0).slice(-20);
    meta.since++;
    const acc = meta.recent.reduce((a, b) => a + b, 0) / meta.recent.length;
    const max = (ORDER[kind] || []).length;
    if(meta.recent.length >= 10 && meta.since >= 10 && acc >= 0.85 && meta.unlocked < max){ meta.unlocked++; meta.since = 0; meta.newest = ORDER[kind][meta.unlocked - 1]; }
    return meta;
  }
  // F clef unlocks when the G clef is confident: 5+ notes and both landmarks in box ≥ 3
  function fUnlocked(items){
    const g = items['deck:g'] || {};
    return (g.unlocked || 0) >= 5 && ((items['card:g:60'] || {}).box || 0) >= 3 && ((items['card:g:67'] || {}).box || 0) >= 3;
  }
  // cards for a round: due/new ones first (lowest box first), then the rest
  function pickRound(kind, n, ctx){
    const rnd = ctx.rnd || Math.random, items = ctx.items || {}, today = ctx.today;
    const meta = items['deck:' + kind] || { unlocked: START[kind] || 3 };
    let pool = (ORDER[kind] || []).slice(0, meta.unlocked);
    if(ctx.range) pool = pool.filter(m => m >= ctx.range[0] && m <= ctx.range[1]);
    if(!pool.length) return [];
    const card = m => items['card:' + kind + ':' + m];
    // a card she missed (box 1) comes before a brand-new one, then higher boxes
    const rank = m => card(m) ? card(m).box : 1.5;
    // shuffle first so equally-due cards don't always come in the same order (low → middle → high)
    const mixed = pool.slice(); for(let k = mixed.length - 1; k > 0; k--){ const j = Math.floor(rnd() * (k + 1)); [mixed[k], mixed[j]] = [mixed[j], mixed[k]]; }
    const due = mixed.filter(m => !card(m) || card(m).due <= today).sort((a, b) => rank(a) - rank(b));
    const out = due.slice(0, n);
    while(out.length < n){
      let m = pool[Math.floor(rnd() * pool.length)];
      if(pool.length > 1 && m === out[out.length - 1]) m = pool[(pool.indexOf(m) + 1) % pool.length];
      out.push(m);
    }
    // never the same card twice in a row
    for(let i = 1; i < out.length; i++) if(out[i] === out[i - 1] && pool.length > 1){ const j = out.findIndex((x, k) => k > i && x !== out[i]); if(j > 0) [out[i], out[j]] = [out[j], out[i]]; }
    return out;
  }

  // ── Writing: scoring ──────────────────────────────────────────────────
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  // how well her stroke follows a guide: 70 % coverage of the guide (all of
  // it — head AND stem), 30 % her ink staying near it (r = tolerance in px)
  function traceScore(guide, user, r){
    if(!guide.length || !user.length) return 0;
    const near = (p, set) => { for(const q of set) if(dist(p, q) <= r) return true; return false; };
    const cov = guide.filter(p => near(p, user)).length / guide.length;
    const prec = user.filter(p => near(p, guide)).length / user.length;
    return Math.round(100 * (0.7 * cov + 0.3 * prec));
  }
  function bbox(pts){
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    pts.forEach(p => { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); });
    return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  }
  const pathLen = pts => pts.reduce((s, p, i) => i ? s + dist(p, pts[i - 1]) : 0, 0);
  // geo: { LS (line spacing px), base (y of the bottom line, step 0) }
  // A child's note: a head (a loop, or a coloured-in blob) and maybe a stem;
  // sometimes both in one stroke (like a "d"). Find the head's staff step.
  function analyzeWrite(strokes, geo){
    const LS = geo.LS;
    strokes = strokes.filter(s => s.length >= 2);
    if(!strokes.length) return { head: null };
    const info = strokes.map(s => { const b = bbox(s), len = pathLen(s); return { s, b, len, closure: dist(s[0], s[s.length - 1]) / Math.max(len, 1) }; });
    let head = null, stem = null;
    // separate strokes first
    const heads = info.filter(i => i.b.w >= 0.4 * LS && i.b.h >= 0.35 * LS && i.b.w <= 3.2 * LS && i.b.h <= 2.6 * LS
                                  && Math.max(i.b.w, i.b.h) / Math.max(1, Math.min(i.b.w, i.b.h)) <= 2.8);
    const stems = info.filter(i => i.b.h >= 1.8 * LS && i.b.w <= 1.1 * LS);
    if(heads.length){
      const h = heads.reduce((a, b) => a.b.w * a.b.h >= b.b.w * b.b.h ? a : b);
      head = { cx: h.b.cx, cy: h.b.cy, w: h.b.w, h: h.b.h, closed: h.closure <= 0.3 || h.len >= 2.4 * (h.b.w + h.b.h) };
    }
    if(stems.length) stem = stems.reduce((a, b) => a.b.h >= b.b.h ? a : b);
    // one tall stroke = head + stem: the head is the wider end
    if(!head){
      const tall = info.filter(i => i.b.h >= 1.8 * LS).sort((a, b) => b.b.h - a.b.h)[0];
      if(tall){
        const third = tall.b.h / 3;
        const top = tall.s.filter(p => p.y <= tall.b.y0 + third), bot = tall.s.filter(p => p.y >= tall.b.y1 - third);
        const bt = bbox(top), bb = bbox(bot);
        const end = bb.w >= bt.w ? bot : top, be = bbox(end);
        head = { cx: be.cx, cy: be.cy, w: be.w, h: be.h, closed: be.w >= 0.45 * LS, combined: true };
        stem = tall;
      }
    }
    // anything small at all counts as a head, just not a closed one
    if(!head){
      const sm = info.reduce((a, b) => a.b.w * a.b.h >= b.b.w * b.b.h ? a : b);
      head = { cx: sm.b.cx, cy: sm.b.cy, w: sm.b.w, h: sm.b.h, closed: false };
    }
    const step = Math.round((geo.base - head.cy) / (LS / 2));
    let stemInfo = null;
    if(stem){
      const sb = stem.b, sx = sb.cx;
      const side = sx >= head.cx ? 'right' : 'left';
      const up = Math.abs(sb.y1 - head.cy) < Math.abs(sb.y0 - head.cy);       // the stem's far end is above
      const attached = head.combined || (Math.abs(sx - head.cx) <= head.w / 2 + 0.9 * LS && (Math.abs(sb.y1 - head.cy) <= 1.1 * LS || Math.abs(sb.y0 - head.cy) <= 1.1 * LS));
      stemInfo = { side, up, attached, len: sb.h / LS };
    }
    return { head, step, closed: head.closed, stem: stemInfo };
  }
  // 🌱: only where the head sits counts. 🌸/🌳: head 70 + closed 15 + stem 15
  function scoreWrite(strokes, geo, targetStep, level){
    const a = analyzeWrite(strokes, geo);
    if(!a.head) return { score: 0, a };
    const off = Math.abs(a.step - targetStep);
    if(level === 'sprout') return { score: off === 0 ? 100 : off === 1 ? 50 : 0, off, a };
    let score = off === 0 ? 70 : off === 1 ? 35 : 0;
    if(a.closed) score += 15;
    if(a.stem && a.stem.attached && a.stem.len >= 2){
      // stem rule: below the middle line → up on the right; from it up → down on the left
      const wantUp = targetStep < 4;
      const right = a.stem.up === wantUp && (a.stem.side === (wantUp ? 'right' : 'left'));
      score += level === 'grow' && !right ? 8 : 15;
    }
    return { score, off, a };
  }
  const starsOf = s => s >= 85 ? 3 : s >= 60 ? 2 : 1;

  // ── Staff drawing (shared by the staff cards and the writing pad) ───────
  // geo { W, LS, base, x0 }  ·  clef 'G' | 'F'  ·  notes [{ m, x, color, ghost, hollow }]
  function drawStaff(g, geo, o){
    const { W, LS, base } = geo, clef = o.clef || 'G', shift = MC.CLEF_SHIFT[clef] || 0;
    const yOf = st => base - st * LS / 2;
    g.strokeStyle = o.lineColor || '#8a8ac0'; g.lineWidth = Math.max(1.5, LS / 16);
    for(let st = 0; st <= 8; st += 2){ g.beginPath(); g.moveTo(geo.x0 || 8, yOf(st)); g.lineTo(W - 8, yOf(st)); g.stroke(); }
    // clef glyph: 𝄞 curls round the G line (step 2), 𝄢's dots hug the F line (step 6)
    // fonts draw these glyphs at different sizes: measure, then fit the glyph
    // to where engravers put it (𝄞 from 1.4 spaces above the staff to 1.6
    // below; 𝄢 from the top line down to just under the middle line)
    g.fillStyle = o.clefColor || '#e6e6f5'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    const glyph = clef === 'G' ? '𝄞' : '𝄢';
    const top = clef === 'G' ? yOf(8) - LS * 1.4 : yOf(8) - LS * 0.05, bot = clef === 'G' ? yOf(0) + LS * 1.6 : yOf(3) + LS * 0.2;
    const FONT = '"Apple Symbols","Noto Music","Bravura Text","Segoe UI Symbol",serif';
    g.font = `100px ${FONT}`;
    const mt = g.measureText(glyph), asc = mt.actualBoundingBoxAscent || 70, desc = mt.actualBoundingBoxDescent || 30;
    const px = 100 * (bot - top) / Math.max(1, asc + desc);
    g.font = `${px}px ${FONT}`;
    g.fillText(glyph, (geo.x0 || 8) + LS * 0.25, top + asc * px / 100);
    (o.notes || []).forEach(n => {
      const st = MC.staffStep(n.m).step - shift, y = yOf(st), x = n.x, col = n.color || '#ffd54f';
      g.globalAlpha = n.ghost ? 0.4 : 1;
      g.strokeStyle = n.ghost ? col : (o.lineColor || '#8a8ac0'); g.lineWidth = Math.max(1.5, LS / 16);
      for(let s = -2; s >= st; s -= 2){ g.beginPath(); g.moveTo(x - LS * 0.95, yOf(s)); g.lineTo(x + LS * 0.95, yOf(s)); g.stroke(); }
      for(let s = 10; s <= st; s += 2){ g.beginPath(); g.moveTo(x - LS * 0.95, yOf(s)); g.lineTo(x + LS * 0.95, yOf(s)); g.stroke(); }
      g.save(); g.translate(x, y); g.rotate(-0.33);
      g.beginPath(); g.ellipse(0, 0, LS * 0.62, LS * 0.44, 0, 0, Math.PI * 2);
      if(n.hollow){ g.strokeStyle = col; g.lineWidth = LS / 7; g.stroke(); } else { g.fillStyle = col; g.fill(); }
      g.restore();
      if(n.stem !== false){
        const up = st < 4, sx = up ? x + LS * 0.56 : x - LS * 0.56;
        g.strokeStyle = col; g.lineWidth = Math.max(2, LS / 10);
        g.beginPath(); g.moveTo(sx, y); g.lineTo(sx, up ? y - LS * 3.2 : y + LS * 3.2); g.stroke();
      }
      g.globalAlpha = 1;
    });
  }
  // guide points for tracing a note (head ellipse + stem), in canvas px
  function noteGuide(geo, step, x){
    const { LS, base } = geo, y = base - step * LS / 2, pts = [];
    for(let a = 0; a < Math.PI * 2; a += Math.PI / 14){
      const ex = Math.cos(a) * LS * 0.62, ey = Math.sin(a) * LS * 0.44, r = -0.33;
      pts.push({ x: x + ex * Math.cos(r) - ey * Math.sin(r), y: y + ex * Math.sin(r) + ey * Math.cos(r) });
    }
    const up = step < 4, sx = up ? x + LS * 0.56 : x - LS * 0.56;
    // sample the stem as densely as the head, so both count by their length
    const gap = dist(pts[0], pts[1]), n = Math.max(4, Math.round(LS * 3.2 / gap));
    for(let k = 0; k <= n; k++) pts.push({ x: sx, y: y + (up ? -1 : 1) * LS * 3.2 * k / n });
    return pts;
  }

  // ── UI ────────────────────────────────────────────────────────────────
  const CSS = `
  #notesView{width:100%;max-width:820px;display:none;flex-direction:column;gap:10px;}
  .nt-menu{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;}
  .nt-card{background:#16213e;border:2px solid #242448;border-radius:16px;padding:14px 8px;cursor:pointer;display:flex;flex-direction:column;
    align-items:center;gap:4px;color:#e6e6f5;font-weight:800;font-size:.9rem;text-align:center;}
  .nt-card .ic{font-size:2.2rem;line-height:1;} .nt-card small{color:#9a9ac8;font-weight:600;font-size:.7rem;}
  .nt-card.lock{opacity:.45;}
  .nt-top{display:flex;align-items:center;gap:8px;} .nt-top .t{flex:1;text-align:center;font-weight:800;color:#e6e6f5;}
  .nt-dots{display:flex;gap:4px;justify-content:center;} .nt-dots i{width:10px;height:10px;border-radius:50%;background:#2a2a50;}
  .nt-dots i.ok{background:#43a047;} .nt-dots i.no{background:#fb8c00;} .nt-dots i.now{outline:2px solid #ffd54f;}
  .nt-q{font-size:1.25rem;font-weight:800;color:#fff;text-align:center;min-height:1.6em;}
  .nt-ans{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;}
  .nt-a{background:#1e1e3a;border:3px solid #34346a;border-radius:16px;padding:16px 4px;font-size:1.25rem;font-weight:800;color:#fff;cursor:pointer;}
  .nt-a.right{background:#1f4a2e;border-color:#43a047;} .nt-a.wrong{border-color:#fb8c00;opacity:.6;}
  .nt-canvas{width:100%;display:block;border-radius:14px;background:#0b0a1a;border:1px solid #1e1e3a;touch-action:none;}
  .nt-say{text-align:center;font-weight:800;color:#ffd54f;min-height:1.4em;font-size:1.05rem;}
  .nt-row{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;}
  `;
  function injectCSS(){ if(document.getElementById('notesCSS')) return; const s = document.createElement('style'); s.id = 'notesCSS'; s.textContent = CSS; document.head.appendChild(s); }
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const GAMES = {
    keys:  { icon: '🃏', name: 'Which key?',          sub: 'a key lights up — name it' },
    oct:   { icon: '🔢', name: 'Low · middle · high', sub: 'which Do is it?' },
    g:     { icon: '🎼', name: 'Read the staff',      sub: 'G clef' },
    f:     { icon: '🎼', name: 'F clef',               sub: 'unlocks after the G clef' },
    write: { icon: '✏️', name: 'Write a note',        sub: 'put · trace · write' },
  };

  function create(d){
    let active = false, game = null, cards = [], i = 0, results = [], onDone = null, items = {}, today = '';
    let waiting = false, canvas = null, g2 = null, geo = null, strokes = [], cur = null, placed = null, t0 = 0, seq = 0;
    const host = d.host;
    const level = () => d.getLevel().id;

    async function load(){ try{ items = await MC.log.items(); }catch(e){ items = {}; } today = MC.dayKey(new Date()); }

    async function show(){
      injectCSS(); host.style.display = 'flex';
      if(active) return;
      await load();
      const fOk = fUnlocked(items);
      const lv = (k) => { const m = items['deck:' + k]; return m ? `${m.unlocked} notes` : `${START[k]} notes`; };
      host.innerHTML = `<div class="nt-menu">${Object.entries(GAMES).map(([k, gm]) => {
        const lock = k === 'f' && !fOk;
        return `<div class="nt-card${lock ? ' lock' : ''}" data-g="${k}"><span class="ic">${gm.icon}</span>${esc(gm.name)}
          <small>${lock ? '🔒 ' + esc(gm.sub) : esc(k === 'g' || k === 'f' ? gm.sub + ' · ' + lv(k) : gm.sub)}</small></div>`; }).join('')}</div>`;
      host.querySelectorAll('.nt-card').forEach(el => el.onclick = () => { if(!el.classList.contains('lock')) start({ game: el.dataset.g }); });
      d.onPiano && d.onPiano(true);
    }
    function hide(){ stop(); host.style.display = 'none'; }

    async function start(o){
      injectCSS(); host.style.display = 'flex';
      await load();
      game = o.game; onDone = o.onDone || null; results = []; i = 0; active = true; t0 = performance.now();
      const lvl = d.getLevel();
      const n = o.n || (game === 'write' ? 5 : 8);
      cards = pickRound(game, n, { items, today, range: game === 'keys' || game === 'write' ? lvl.range : null });
      if(!cards.length) cards = [60];
      d.onPiano && d.onPiano(game !== 'write');
      ask();
    }

    function frame(q, body, extra){
      host.innerHTML = `<div class="nt-top"><button class="sg-btn" id="ntBack">←</button>
          <span class="t">${GAMES[game].icon} ${esc(GAMES[game].name)}</span><button class="sg-btn" id="ntHear" title="Hear it">🔊</button></div>
        <div class="nt-dots">${cards.map((_, k) => `<i class="${k < results.length ? (results[k].ok ? 'ok' : 'no') : k === i ? 'now' : ''}"></i>`).join('')}</div>
        <div class="nt-q">${q}</div>${body}<div class="nt-say" id="ntSay"></div>${extra || ''}`;
      host.querySelector('#ntBack').onclick = () => { stop(); onDone ? finish(true) : show(); };
      host.querySelector('#ntHear').onclick = () => hear();
    }
    function hear(){ const m = cards[i]; if(m == null) return; const ac = d.audio(); d.playNote(ac, m, ac.currentTime + 0.05, 0.9, { vel: 90, tag: 'notes' }); }

    function ask(){
      if(i >= cards.length) return finish();
      waiting = true;
      const m = cards[i], lv = level(), kb = d.getKb();
      kb && kb.setTarget(null);
      if(game === 'keys' || game === 'oct'){
        const opts = game === 'oct' ? octOptions(m) : choices(m, ORDER.keys.slice(0, 8), Math.random);
        frame(game === 'oct' ? `Which ${esc(nameOf(m, lv).split(' ')[0])} is glowing?` : 'Which note is glowing?',
          `<div class="nt-ans">${opts.map(x => `<button class="nt-a" data-m="${x}">${game === 'oct' ? SHAPE_ICON[MC.shapeOf(x)] + '<br>' + octName(x) : esc(nameOf(x, lv))}</button>`).join('')}</div>`);
        if(kb){ kb.setTarget(m); kb.flash(m); }
        hear();
        bindAnswers(m);
      } else if(game === 'g' || game === 'f'){
        const opts = choices(m, ORDER[game].slice(0, 8), Math.random);
        frame('What note is this?', `<canvas class="nt-canvas" id="ntCv"></canvas>
          <div class="nt-ans">${opts.map(x => `<button class="nt-a" data-m="${x}">${esc(nameOf(x, lv))}</button>`).join('')}</div>`,
          `<div class="nt-say" style="color:#8a8ab8;font-size:.78rem">…or play it on your keyboard 🎹</div>`);
        setupCanvas(8, 2.3);      // room for ledger notes: middle C below, high G above
        draw([{ m, x: geo.W * 0.6, color: '#ffd54f' }]);
        bindAnswers(m);
      } else writeAsk(m);
    }
    function octOptions(m){ const o = [m - 12, m, m + 12]; return MC.octaveOf(m) === 3 ? [m, m + 12, m + 24] : MC.octaveOf(m) === 5 ? [m - 24, m - 12, m] : o; }

    function bindAnswers(m){
      host.querySelectorAll('.nt-a').forEach(b => b.onclick = () => answer(+b.dataset.m, b));
    }
    // her keyboard can answer the staff cards too (🌱: any octave counts)
    function onKey(k){
      if(!active || !waiting) return;
      if(game !== 'g' && game !== 'f') return;
      const m = cards[i], ok = k === m || (level() === 'sprout' && MC.pc(k) === MC.pc(m));
      const b = host.querySelector(`.nt-a[data-m="${ok ? m : -1}"]`);
      answer(ok ? m : k, b);
    }

    async function answer(x, btn){
      if(!waiting) return;
      waiting = false;
      const m = cards[i], ok = game === 'oct' ? MC.octaveOf(x) === MC.octaveOf(m) : MC.pc(x) === MC.pc(m);
      const right = host.querySelector(`.nt-a[data-m="${m}"]`);
      right && right.classList.add('right');
      if(!ok && btn) btn.classList.add('wrong');
      const kb = d.getKb(); kb && kb.flash(m);
      host.querySelector('#ntSay').textContent = ok ? ['⭐ Yes!', '🎉 Right!', '🌟 Super!'][results.length % 3] : `It's ${game === 'oct' ? octName(m) + ' ' + nameOf(m, level()).split(' ')[0] : nameOf(m, level())} 👍`;
      if(!ok) hear();
      await record(m, ok);
      // a missed card comes back once, later in this round
      if(!ok && !cards.slice(i + 1).includes(m) && cards.length < 14) cards.splice(Math.min(cards.length, i + 3), 0, m);
      setTimeout(() => { if(active){ i++; ask(); } }, ok ? 800 : 1600);
    }
    async function record(m, ok, score){
      results.push({ m, ok, score });
      const key = 'card:' + game + ':' + m;
      items[key] = box(items[key], ok, today);
      items['deck:' + game] = deckAfter(items['deck:' + game], ok, game);
      try{ await MC.log.setItem(key, items[key]); await MC.log.setItem('deck:' + game, items['deck:' + game]); }catch(e){}
    }

    // ── canvas + writing ────────────────────────────────────────────────
    function setupCanvas(rows, below){
      canvas = host.querySelector('#ntCv');
      const W = Math.max(280, canvas.clientWidth || host.clientWidth || 360);
      const LS = Math.max(26, Math.min(44, W / 13));
      const H = Math.round(LS * rows), dpr = window.devicePixelRatio || 1;
      canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.height = H + 'px';
      g2 = canvas.getContext('2d'); g2.setTransform(dpr, 0, 0, dpr, 0, 0);
      geo = { W, H, LS, base: H - LS * (below || 2.4), x0: 8 };
    }
    function draw(notes, extra){
      g2.clearRect(0, 0, geo.W, geo.H);
      drawStaff(g2, geo, { clef: game === 'f' ? 'F' : 'G', notes });
      extra && extra();
    }

    // ✏️ three steps up per note: box 1 → put it, box 2 → trace it, box ≥ 3 → write it (🌱 stops at trace)
    function writeAsk(m){
      const card = items['card:write:' + m] || {}, lv = level();
      const modeW = (card.box || 1) <= 1 ? 'place' : (card.box === 2 || lv === 'sprout') ? 'trace' : 'write';
      const nm = nameOf(m, lv);
      const q = modeW === 'place' ? `Put <b>${esc(nm)}</b> on the staff` : modeW === 'trace' ? `Trace <b>${esc(nm)}</b>` : `Write <b>${esc(nm)}</b>`;
      frame(q, `<canvas class="nt-canvas" id="ntCv"></canvas>`,
        `<div class="nt-row"><button class="sg-btn" id="ntClear">↺ Again</button>${modeW !== 'place' ? '<button class="sg-btn go" id="ntDone">✓ Done</button>' : ''}</div>`);
      setupCanvas(9, 2.6);
      strokes = []; cur = null; placed = null;
      const target = MC.staffStep(m).step, x = geo.W * 0.58;
      const guide = modeW === 'trace' ? noteGuide(geo, target, x) : null;
      const paint = () => draw([], () => {
        if(guide){ g2.fillStyle = 'rgba(255,213,79,.55)'; guide.forEach(p => { g2.beginPath(); g2.arc(p.x, p.y, 2.4, 0, Math.PI * 2); g2.fill(); }); ledgerFor(target, x); }
        if(modeW === 'place'){
          const hx = placed ? placed.x : geo.W - geo.LS * 1.4, hy = placed ? placed.y : geo.LS * 1.2;
          if(placed) ledgerFor(Math.round((geo.base - hy) / (geo.LS / 2)), hx);
          g2.save(); g2.translate(hx, hy); g2.rotate(-0.33); g2.beginPath(); g2.ellipse(0, 0, geo.LS * 0.62, geo.LS * 0.44, 0, 0, Math.PI * 2);
          g2.fillStyle = MC.colorOf(m); g2.fill(); g2.restore();
        }
        g2.strokeStyle = '#7fd6ff'; g2.lineWidth = Math.max(4, geo.LS / 6); g2.lineCap = 'round'; g2.lineJoin = 'round';
        strokes.concat(cur ? [cur] : []).forEach(s => { g2.beginPath(); s.forEach((p, k) => k ? g2.lineTo(p.x, p.y) : g2.moveTo(p.x, p.y)); g2.stroke(); });
      });
      paint();
      const pos = e => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * geo.W / r.width, y: (e.clientY - r.top) * geo.H / r.height }; };
      canvas.onpointerdown = e => {
        if(!waiting) return;
        canvas.setPointerCapture(e.pointerId);
        if(modeW === 'place'){ placed = pos(e); paint(); return; }
        cur = [pos(e)]; paint();
      };
      canvas.onpointermove = e => {
        if(!waiting) return;
        if(modeW === 'place'){ if(placed && e.buttons){ placed = pos(e); paint(); } return; }
        if(cur){ cur.push(pos(e)); paint(); }
      };
      canvas.onpointerup = canvas.onpointercancel = e => {
        if(!waiting) return;
        if(modeW === 'place'){
          if(!placed) return;
          const st = Math.round((geo.base - placed.y) / (geo.LS / 2));
          placed.y = geo.base - st * geo.LS / 2; paint();
          const off = Math.abs(st - target);
          return writeDone(m, off === 0 ? 100 : off === 1 ? 50 : 0, x, target);
        }
        if(cur && cur.length > 1) strokes.push(cur); cur = null; paint();
      };
      host.querySelector('#ntClear').onclick = () => { if(!waiting) return; strokes = []; placed = null; paint(); };
      const done = host.querySelector('#ntDone');
      if(done) done.onclick = () => {
        if(!waiting || !strokes.length) return;
        const r = lv === 'sprout' ? 0.85 * geo.LS : 0.6 * geo.LS;
        const s = modeW === 'trace' ? traceScore(guide, strokes.flat(), r) : scoreWrite(strokes, geo, target, lv).score;
        writeDone(m, s, x, target);
      };
      hear();
    }
    function ledgerFor(st, x){
      g2.strokeStyle = '#8a8ac0'; g2.lineWidth = Math.max(1.5, geo.LS / 16);
      const yOf = s => geo.base - s * geo.LS / 2;
      for(let s = -2; s >= st; s -= 2){ g2.beginPath(); g2.moveTo(x - geo.LS, yOf(s)); g2.lineTo(x + geo.LS, yOf(s)); g2.stroke(); }
      for(let s = 10; s <= st; s += 2){ g2.beginPath(); g2.moveTo(x - geo.LS, yOf(s)); g2.lineTo(x + geo.LS, yOf(s)); g2.stroke(); }
    }
    async function writeDone(m, score, x, target){
      waiting = false;
      // her writing stays; the right note is ghosted on top — never a red ✗
      drawStaff(g2, geo, { clef: 'G', notes: [{ m, x: placedX(x), color: '#9fe8b0', ghost: true }] });
      const st = starsOf(score), lv = level();
      host.querySelector('#ntSay').innerHTML = `${'⭐'.repeat(st)}${lv !== 'sprout' ? ` <small style="color:#c8c8f0">${score}/100</small>` : ''} ${score >= 85 ? 'Beautiful!' : score >= 50 ? 'Nearly — see the green note' : 'Look — here it is!'}`;
      await record(m, score >= 85, score);
      setTimeout(() => { if(active){ i++; ask(); } }, 1900);
    }
    function placedX(x){ return placed ? placed.x : x; }

    async function finish(left){
      const n = results.length, ok = results.filter(r => r.ok).length;
      const scores = results.filter(r => r.score != null).map(r => r.score);
      const res = { kind: game === 'write' ? 'write' : game === 'g' || game === 'f' ? 'staff' : 'cards', game, level: level(),
                    durMs: Math.round(performance.now() - t0), n, ok, stars: n ? starsOf(scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 100 * ok / n) : 1,
                    score: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : (n ? Math.round(100 * ok / n) : 0),
                    items: results.map(r => ({ m: r.m, ok: r.ok, score: r.score })) };
      if(n) try{ await MC.log.add(res); }catch(e){}
      active = false; waiting = false;
      const kb = d.getKb(); kb && kb.setTarget(null);
      const f = onDone; onDone = null;
      if(f) return f(res, left);
      const unlocked = items['deck:' + game] && items['deck:' + game].newest;
      host.innerHTML = `<div class="nt-q" style="margin-top:20px">${'⭐'.repeat(res.stars)}<br>${ok} of ${n} ${game === 'write' ? 'written well' : 'right'}!</div>
        ${unlocked ? `<div class="nt-say">🎉 New note: ${esc(nameOf(unlocked, level()))}</div>` : ''}
        <div class="nt-row"><button class="sg-btn go" id="ntMore">↺ Again</button><button class="sg-btn" id="ntMenu">🧠 Notes</button></div>`;
      if(unlocked) delete items['deck:' + game].newest;
      host.querySelector('#ntMore').onclick = () => start({ game });
      host.querySelector('#ntMenu').onclick = () => show();
    }
    function stop(){ active = false; waiting = false; const kb = d.getKb(); kb && kb.setTarget(null); d.cancelNotes && d.cancelNotes('notes'); }

    return { show, hide, start, onKey, stop, get active(){ return active; }, get waiting(){ return waiting; },
             get _cards(){ return cards; }, get _i(){ return i; }, get _geo(){ return geo; }, get _game(){ return game; } };
  }

  window.Notes = { ORDER, START, nameOf, octName, choices, box, deckAfter, fUnlocked, pickRound, traceScore, analyzeWrite, scoreWrite,
                   noteGuide, drawStaff, starsOf, create };
})();
