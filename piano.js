/* piano.js — Piano v2: a data-driven, scrollable, colour-coded keyboard.
   Classic script → window.PianoV2. Depends on music-core.js (window.MusicCore).
   Injects its own CSS so beat-hive can drop it in unchanged.

   const kb = PianoV2.create(hostEl, {
     range:[21,108],  // playable MIDI range (snapped out to white keys)
     view:15,         // white keys visible per row
     start:60,        // left-most visible key (MIDI)
     labels:'solfege',// 'color' | 'solfege' | 'letter' | 'none'
     colorAmt:1,      // 0..1 how strongly keys are tinted with the note colour
     minimap:true,    // draggable overview strip = the range slider
     twoRow:false,    // second row above showing the next span (portrait phones)
     labelFn:null,    // optional m => string override (drum kit names)
     onDown:m=>{}, onUp:m=>{},
   });
   kb.update({...})  kb.scrollTo(m)  kb.zoom(±1)  kb.keys(m) → [el]
   kb.setTarget(m|null)  kb.flash(m)  kb.clearMarks()  kb.destroy()
*/
(function(){
  'use strict';
  const MC = window.MusicCore;

  const CSS = `
  .pv2{width:100%;display:flex;flex-direction:column;gap:6px;user-select:none;-webkit-user-select:none;}
  .pv2-mini{position:relative;height:22px;border-radius:6px;background:#0b0a18;overflow:hidden;
    touch-action:none;cursor:pointer;border:1px solid #1e1e38;}
  .pv2-mini i{position:absolute;top:0;bottom:0;}
  .pv2-mini i.w{background:#3a3a55;border-right:1px solid #0b0a18;}
  .pv2-mini i.c{background:var(--c);opacity:.85;}
  .pv2-mini i.b{background:#0b0a18;height:55%;}
  .pv2-win{position:absolute;top:0;bottom:0;border:2px solid #ffd54f;border-radius:5px;
    background:rgba(255,213,79,.14);box-shadow:0 0 10px rgba(255,213,79,.35);pointer-events:none;
    transition:left .12s ease,width .12s ease;}
  .pv2-rows{display:flex;flex-direction:column;gap:6px;touch-action:none;height:var(--pv2-h,150px);}
  .pv2-row{position:relative;flex:1;overflow:hidden;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.55);}
  .pv2-track{position:absolute;top:0;bottom:0;left:0;transition:transform .18s ease;}
  .pv2-k{position:absolute;top:0;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;
    gap:3px;cursor:pointer;transition:background .06s,transform .06s,box-shadow .1s;}
  .pv2-w{bottom:0;padding-bottom:7px;border-radius:0 0 8px 8px;border-right:1px solid rgba(0,0,0,.14);
    border-bottom:5px solid rgba(0,0,0,.14);
    background:color-mix(in srgb,var(--c) calc(var(--amt) * 30%),#f6f2e8);}
  .pv2-w::after{content:'';position:absolute;left:0;right:0;bottom:-5px;height:5px;
    background:var(--c);opacity:var(--amt);border-radius:0 0 8px 8px;}
  .pv2-b{height:60%;z-index:2;padding-bottom:5px;border-radius:0 0 6px 6px;background:#1c1b33;
    box-shadow:0 4px 8px rgba(0,0,0,.6);border-bottom:4px solid color-mix(in srgb,var(--c) calc(var(--amt) * 100%),#1c1b33);}
  .pv2-k.down{transform:translateY(2px);filter:brightness(.92);}
  .pv2-w.down{background:color-mix(in srgb,var(--c) 70%,#fff);}
  .pv2-b.down{background:color-mix(in srgb,var(--c) 60%,#1c1b33);}
  .pv2-k.target{animation:pv2pulse .9s ease-in-out infinite;z-index:3;}
  .pv2-w.target{background:color-mix(in srgb,var(--c) 55%,#fff);}
  .pv2-b.target{background:color-mix(in srgb,var(--c) 75%,#1c1b33);}
  @keyframes pv2pulse{0%,100%{box-shadow:inset 0 0 0 3px var(--c),0 0 8px var(--c);}
    50%{box-shadow:inset 0 0 0 5px var(--c),0 0 26px var(--c);}}
  .pv2-k.dad{outline:3px dashed #7ec8ff;outline-offset:-5px;}
  .pv2-w.dad{background:color-mix(in srgb,#7ec8ff 28%,#f6f2e8);}
  .pv2-k.flash{animation:pv2flash .45s ease-out;}
  @keyframes pv2flash{0%{box-shadow:0 0 0 0 var(--c),0 0 30px #fff;}100%{box-shadow:0 0 0 0 transparent;}}
  .pv2-k.wobble{animation:pv2wob .3s ease;}
  @keyframes pv2wob{25%{transform:translateX(-3px);}75%{transform:translateX(3px);}}
  .pv2-lbl{font-size:clamp(.5rem,1.6vw,.78rem);font-weight:800;color:rgba(0,0,0,.45);pointer-events:none;line-height:1;}
  .pv2-b .pv2-lbl{color:rgba(255,255,255,.55);font-size:clamp(.42rem,1.3vw,.62rem);}
  .pv2-shape{width:min(62%,30px);aspect-ratio:1;background:var(--c);pointer-events:none;
    box-shadow:0 1px 3px rgba(0,0,0,.3);}
  .pv2-b .pv2-shape{width:min(70%,18px);}
  .pv2-shape.circle{border-radius:50%;}
  .pv2-shape.square{border-radius:3px;}
  .pv2-shape.triangle{clip-path:polygon(50% 4%,100% 96%,0 96%);box-shadow:none;}
  .pv2.sprout .pv2-shape{width:min(70%,44px);}
  `;
  function injectCSS(){
    if(document.getElementById('pv2-css')) return;
    const s = document.createElement('style');
    s.id = 'pv2-css'; s.textContent = CSS;
    document.head.appendChild(s);
  }

  // White-key index helpers over a [lo,hi] range
  function snapWhite(m, dir){ while(MC.isBlack(m)) m += dir; return m; }

  function create(host, opts){
    injectCSS();
    const o = Object.assign({ range:[48,84], view:15, start:60, labels:'letter', colorAmt:1,
      minimap:true, twoRow:false, labelFn:null, levelClass:'', onDown(){}, onUp(){} }, opts || {});
    const root = document.createElement('div');
    root.className = 'pv2';
    host.innerHTML = ''; host.appendChild(root);

    let lo, hi, whites = [], wIndex = new Map(), startW = 0, rows = [], mini = null, win = null;
    const keyEls = new Map();       // m → [el per row]
    const active = new Map();       // pointerId → m
    const downCount = new Map();    // m → number of pointers holding it
    let target = null, dad = [];
    const touched = new Set();      // keys whose inline style a caller set via keys()

    function build(){
      lo = snapWhite(o.range[0], +1); hi = snapWhite(o.range[1], -1);
      whites = []; wIndex.clear(); keyEls.clear(); touched.clear();
      for(let m = lo; m <= hi; m++) if(!MC.isBlack(m)){ wIndex.set(m, whites.length); whites.push(m); }
      o.view = Math.max(5, Math.min(o.view, whites.length));
      root.className = 'pv2 ' + (o.levelClass || '');
      root.innerHTML = '';

      if(o.minimap && whites.length > o.view){
        mini = document.createElement('div'); mini.className = 'pv2-mini';
        const ww = 100 / whites.length;
        let html = '';
        whites.forEach((m, i) => {
          html += `<i class="w${m % 12 === 0 ? ' c' : ''}" style="left:${i*ww}%;width:${ww}%;--c:${MC.colorOf(m)}"></i>`;
        });
        for(let m = lo; m <= hi; m++) if(MC.isBlack(m)){
          const i = wIndex.get(m - 1); if(i == null) continue;
          html += `<i class="b" style="left:${(i+1)*ww - ww*0.3}%;width:${ww*0.6}%"></i>`;
        }
        mini.innerHTML = html;
        win = document.createElement('div'); win.className = 'pv2-win';
        mini.appendChild(win);
        root.appendChild(mini);
        wireMini();
      } else { mini = win = null; }

      const rowsEl = document.createElement('div'); rowsEl.className = 'pv2-rows';
      root.appendChild(rowsEl);
      rows = [];
      const nRows = o.twoRow ? 2 : 1;
      for(let r = 0; r < nRows; r++){
        const row = document.createElement('div'); row.className = 'pv2-row';
        const track = document.createElement('div'); track.className = 'pv2-track';
        row.appendChild(track); rowsEl.appendChild(row);
        rows.push({ row, track });
        renderKeys(track);
      }
      wirePointers(rowsEl);
      setStart(whites[Math.max(0, (wIndex.get(snapWhite(o.start, +1)) ?? 0))] ?? lo, false);
      if(target != null) setTarget(target);
      dad.forEach(m => (keyEls.get(m) || []).forEach(el => el.classList.add('dad')));
    }

    function renderKeys(track){
      const total = whites.length, ww = 100 / total;
      track.style.width = (total / o.view * 100) + '%';
      const frag = document.createDocumentFragment();
      for(let m = lo; m <= hi; m++){
        const black = MC.isBlack(m);
        const el = document.createElement('div');
        el.className = 'pv2-k ' + (black ? 'pv2-b' : 'pv2-w');
        el.dataset.m = m;
        el.style.setProperty('--c', MC.colorOf(m));
        el.style.setProperty('--amt', o.colorAmt);
        if(black){
          const i = wIndex.get(m - 1);
          el.style.left = ((i + 1) * ww - ww * 0.31) + '%';
          el.style.width = (ww * 0.62) + '%';
        } else {
          el.style.left = (wIndex.get(m) * ww) + '%';
          el.style.width = ww + '%';
        }
        const custom = o.labelFn && o.labelFn(m);
        if(custom != null){
          el.innerHTML = `<span class="pv2-lbl">${custom}</span>`;
        } else {
          let html = '';
          if(o.labels === 'color' || o.labels === 'solfege')
            html += `<span class="pv2-shape ${MC.shapeOf(m)}"></span>`;
          const txt = o.labels === 'letter' ? (m % 12 === 0 ? MC.midiName(m) : (black ? '' : MC.label(m,'letter')))
                    : o.labels === 'solfege' ? MC.label(m, 'solfege') : '';
          if(txt) html += `<span class="pv2-lbl">${txt}</span>`;
          el.innerHTML = html;
        }
        frag.appendChild(el);
        if(!keyEls.has(m)) keyEls.set(m, []);
        keyEls.get(m).push(el);
      }
      track.appendChild(frag);
    }

    function spanWhites(){ return o.view * rows.length; }
    function setStart(m, animate){
      const maxStart = Math.max(0, whites.length - spanWhites());
      startW = Math.max(0, Math.min(maxStart, wIndex.get(snapWhite(m, +1)) ?? 0));
      const total = whites.length;
      rows.forEach((r, idx) => {
        // rows[] is in DOM order (top→bottom); the bottom row starts at
        // startW and the row above it shows the next span up
        const off = Math.min(startW + (rows.length - 1 - idx) * o.view, Math.max(0, total - o.view));
        r.track.style.transition = animate === false ? 'none' : '';
        r.track.style.transform = `translateX(${-off / total * 100}%)`;
      });
      if(win){
        win.style.left = (startW / total * 100) + '%';
        win.style.width = (Math.min(spanWhites(), total) / total * 100) + '%';
      }
    }

    function wireMini(){
      let dragging = false;
      const go = e => {
        const r = mini.getBoundingClientRect();
        const frac = (e.clientX - r.left) / r.width;
        const centre = Math.round(frac * whites.length - spanWhites() / 2);
        setStart(whites[Math.max(0, Math.min(whites.length - 1, centre))], !dragging);
      };
      mini.addEventListener('pointerdown', e => { dragging = false; mini.setPointerCapture(e.pointerId); go(e); dragging = true; });
      mini.addEventListener('pointermove', e => { if(dragging) go(e); });
      const end = () => { dragging = false; };
      mini.addEventListener('pointerup', end); mini.addEventListener('pointercancel', end);
    }

    function keyAt(x, y){
      const el = document.elementFromPoint(x, y);
      const k = el && el.closest && el.closest('.pv2-k');
      return k && root.contains(k) ? +k.dataset.m : null;
    }
    function press(m){
      const n = (downCount.get(m) || 0) + 1; downCount.set(m, n);
      (keyEls.get(m) || []).forEach(el => el.classList.add('down'));
      if(n === 1) o.onDown(m);
    }
    function release(m){
      const n = (downCount.get(m) || 1) - 1;
      if(n > 0){ downCount.set(m, n); return; }
      downCount.delete(m);
      (keyEls.get(m) || []).forEach(el => el.classList.remove('down'));
      o.onUp(m);
    }
    function wirePointers(rowsEl){
      rowsEl.addEventListener('pointerdown', e => {
        const m = keyAt(e.clientX, e.clientY); if(m == null) return;
        e.preventDefault();
        try{ rowsEl.setPointerCapture(e.pointerId); }catch(_){}
        active.set(e.pointerId, m); press(m);
      });
      rowsEl.addEventListener('pointermove', e => {
        if(!active.has(e.pointerId)) return;
        const m = keyAt(e.clientX, e.clientY), prev = active.get(e.pointerId);
        if(m === prev) return;
        if(prev != null) release(prev);
        active.set(e.pointerId, m);
        if(m != null) press(m);                     // glissando
      });
      const end = e => {
        if(!active.has(e.pointerId)) return;
        const m = active.get(e.pointerId); active.delete(e.pointerId);
        if(m != null) release(m);
      };
      rowsEl.addEventListener('pointerup', end);
      rowsEl.addEventListener('pointercancel', end);
      rowsEl.addEventListener('lostpointercapture', end);
      rowsEl.addEventListener('contextmenu', e => e.preventDefault());
    }

    function isVisible(m){
      const i = wIndex.get(snapWhite(m, -1)); if(i == null) return false;
      return i >= startW && i < startW + spanWhites();
    }
    function scrollTo(m, force){
      if(m < lo || m > hi) return;
      if(!force && isVisible(m)) return;
      const i = wIndex.get(snapWhite(m, -1));
      setStart(whites[Math.max(0, i - Math.floor(spanWhites() / 2) + 1)]);
    }
    function setTarget(m){
      if(target != null) (keyEls.get(target) || []).forEach(el => el.classList.remove('target'));
      target = m;
      if(m == null) return;
      (keyEls.get(m) || []).forEach(el => el.classList.add('target'));
      scrollTo(m);
    }
    function mark(m, cls, ms){
      (keyEls.get(m) || []).forEach(el => {
        el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
        setTimeout(() => el.classList.remove(cls), ms);
      });
    }

    build();
    return {
      get range(){ return [lo, hi]; },
      get start(){ return whites[startW]; },
      update(next){
        const keepStart = whites[startW];
        Object.assign(o, next || {});
        if(!next || next.start == null) o.start = keepStart;
        build();
      },
      scrollTo, setTarget,
      startAt: m => setStart(m),
      zoom(dir){
        const c = whites[startW + Math.floor(spanWhites() / 2)];
        o.view = Math.max(7, Math.min(36, o.view + dir * 7));
        o.start = c; build(); scrollTo(c, true);
        return o.view;
      },
      // keys(m) hands out elements for caller styling (Listen glow); remember
      // them so clearMarks() resets only those, not every key, each frame
      keys: m => { const els = keyEls.get(m) || []; if(els.length) touched.add(m); return els; },
      press, release,
      flash: m => mark(m, 'flash', 450),
      // 👨‍👧 Dad's keys: dashed outlines on the chord tones for his part
      setDad(ms){
        dad.forEach(m => (keyEls.get(m) || []).forEach(el => el.classList.remove('dad')));
        dad = ms || [];
        dad.forEach(m => (keyEls.get(m) || []).forEach(el => el.classList.add('dad')));
      },
      wobble: m => mark(m, 'wobble', 300),
      clearMarks(){
        touched.forEach(m => (keyEls.get(m) || []).forEach(el => { el.style.background = ''; el.style.boxShadow = ''; }));
        touched.clear();
      },
      destroy(){ host.innerHTML = ''; },
    };
  }

  window.PianoV2 = { create };
})();
