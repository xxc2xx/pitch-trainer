/* sound.js — instrument voices: sampled when available, synth until then.
   Classic script → window.Sound.

   Sampled instruments come from smplr (https://github.com/danigb/smplr,
   MIT; samples hosted on smpldsnds.github.io / gleitz soundfonts), loaded
   lazily from jsDelivr the first time a context is supplied. Safari gets
   .m4a, everyone else .ogg (smplr picks):
     piano   → SplendidGrandPiano (Steinway) — ONE velocity layer (mf, ~5 MB;
               all five are ~20 MB). Velocities stay inside 85–100 so every
               note hits a loaded layer; softness comes from a second,
               quieter instance sharing the same buffers (no re-download).
     epiano  → ElectricPiano CP80
     guitar / bass / strings → General MIDI soundfonts (MusyngKite)
   Until the samples arrive — or offline — a small built-in synth plays, so
   a tap is never silent.

   Sound.use(ctx)                 bind the AudioContext (call inside a tap)
   Sound.setInstrument(id)        'piano' | 'epiano' | 'guitar' | 'bass' | 'strings'
   Sound.noteOn(m, vel)           press: sounds until noteOff (or natural decay)
   Sound.noteOff(m)               release
   Sound.schedule(m, when, dur, { vel, tag, soft })   timed note (songs, demo);
                                  soft = the quieter guide voice
   Sound.cancel(tag)              stop every scheduled note with that tag
   Sound.onStatus(fn)             fn({ id, state:'loading'|'ready'|'synth', loaded, total })
*/
(function(){
  'use strict';
  const SMPLR = 'https://cdn.jsdelivr.net/npm/smplr@1.1.0/dist/index.mjs';
  const MF = [85, 100];                     // the one piano layer we load
  const DEFS = {
    piano:   (lib, o) => lib.SplendidGrandPiano(ctx, opt(o, { decayTime: 0.6, notesToLoad: { velocityRange: MF } })),
    epiano:  (lib, o) => lib.ElectricPiano(ctx, opt(o, { instrument: 'CP80' })),
    guitar:  (lib, o) => lib.Soundfont(ctx, opt(o, { instrument: 'acoustic_guitar_nylon' })),
    bass:    (lib, o) => lib.Soundfont(ctx, opt(o, { instrument: 'electric_bass_finger' })),
    strings: (lib, o) => lib.Soundfont(ctx, opt(o, { instrument: 'string_ensemble_1' })),
  };
  const SOFT_VOLUME = 55;                   // guide melody under her playing
  let loader = null;                        // shared SampleLoader: soft twin reuses buffers
  let ctx = null, lib = null, libP = null, current = 'piano';
  const inst = {}, soft = {}, loading = {}; // id → smplr instance / quiet twin / promise
  const held = new Map();                   // midi → stop fn (live presses)
  const tagged = new Map();                 // tag → [{stop, synth}]
  let statusFn = () => {};

  function opt(extra, o){
    return Object.assign({ volume: 100, loader, onLoadProgress: p => status(currentLoading, 'loading', p) }, o, extra);
  }
  let currentLoading = 'piano';
  function status(id, state, p){ try{ statusFn({ id, state, loaded: p && p.loaded, total: p && p.total }); }catch(e){} }

  function loadLib(){
    if(!libP) libP = import(SMPLR).then(m => (lib = m)).catch(e => { libP = null; throw e; });
    return libP;
  }
  function load(id){
    if(inst[id] || loading[id] || !DEFS[id]) return;
    currentLoading = id; status(id, 'loading', { loaded: 0, total: 0 });
    const wait = i => i.ready ? i.ready.then(() => i) : i.load.then(() => i);
    loading[id] = loadLib()
      .then(l => { if(!loader && l.SampleLoader) loader = l.SampleLoader(ctx); return wait(DEFS[id](l, {})); })
      .then(i => {
        inst[id] = i; delete loading[id]; status(id, 'ready');
        // quiet twin for guide melodies — buffers come from the shared loader
        wait(DEFS[id](lib, { volume: SOFT_VOLUME, onLoadProgress: undefined }))
          .then(q => { soft[id] = q; }).catch(() => {});
      })
      .catch(e => { delete loading[id]; status(id, 'synth'); console.warn('[sound] sampled', id, 'unavailable, using synth:', e && e.message); });
  }

  // ── Fallback synth (also the voice while samples download) ───────────
  // Additive piano-ish tone. Unlike the old fixed-decay voices it holds a
  // sustain level until released, so a long press is a long note.
  const TIMBRE = {
    piano:   { parts: [[1,.5],[2,.26],[3,.12],[4.01,.06]], sus: .28, decay: 1.6, rel: .35, type: 'sine' },
    epiano:  { parts: [[1,.6],[2,.18],[7,.03]],             sus: .35, decay: 1.2, rel: .3,  type: 'sine' },
    guitar:  { parts: [[1,.5],[2,.3],[3,.2]],               sus: .15, decay: .9,  rel: .2,  type: 'triangle' },
    bass:    { parts: [[1,.7],[2,.25]],                     sus: .4,  decay: .8,  rel: .2,  type: 'triangle' },
    strings: { parts: [[1,.4],[2,.25],[3,.15]],             sus: .8,  decay: .2,  rel: .5,  type: 'sawtooth', attack: .12 },
  };
  function synthVoice(m, when, vel, dest){
    const T = TIMBRE[current] || TIMBRE.piano, f = 440 * Math.pow(2, (m - 69) / 12);
    const out = ctx.createGain(), lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = Math.min(f * 8, 12000);
    out.connect(lp); lp.connect(dest || ctx.destination);
    const peak = 0.32 * (vel / 100), atk = T.attack || 0.006;
    out.gain.setValueAtTime(0.0001, when);
    out.gain.linearRampToValueAtTime(peak, when + atk);
    out.gain.setTargetAtTime(peak * T.sus, when + atk, T.decay / 3);
    const oscs = T.parts.map(([h, a]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = T.type; o.frequency.value = f * h; g.gain.value = a;
      o.connect(g); g.connect(out); o.start(when); return o;
    });
    return function stop(at){
      const t = Math.max(at == null ? ctx.currentTime : at, when);
      out.gain.cancelScheduledValues(t);
      out.gain.setTargetAtTime(0.0001, t, T.rel / 3);
      oscs.forEach(o => { try{ o.stop(t + T.rel * 2); }catch(e){} });
    };
  }

  function play(m, when, vel, tag, quiet){
    const i = (quiet && soft[current]) || inst[current];
    if(i){
      // piano: keep velocity inside the loaded layer, or the note is silent
      const v = current === 'piano' ? Math.max(MF[0], Math.min(MF[1], vel)) : vel;
      const s = i.start({ note: m, velocity: v, time: when, stopId: tag || undefined });
      return at => { try{ s({ time: at }); }catch(e){} };
    }
    let dest = null;
    if(tag){                                  // synth notes of a tag share a bus we can cut
      if(!tagBus.has(tag)){ const b = ctx.createGain(); b.connect(ctx.destination); tagBus.set(tag, b); }
      dest = tagBus.get(tag);
    }
    return synthVoice(m, when, quiet ? vel * 0.5 : vel, dest);
  }
  const tagBus = new Map();

  const Sound = {
    use(c){
      if(ctx !== c){ ctx = c; loader = null; [inst, soft].forEach(o => Object.keys(o).forEach(k => delete o[k])); }
      load(current);
      return Sound;
    },
    setInstrument(id){
      if(!DEFS[id]) return;
      current = id;
      if(ctx) load(id);
    },
    get instrument(){ return current; },
    get sampled(){ return !!inst[current]; },
    noteOn(m, vel){
      if(!ctx) return;
      Sound.noteOff(m);
      held.set(m, play(m, ctx.currentTime, vel || 90, null));
    },
    noteOff(m){
      const s = held.get(m);
      if(s){ held.delete(m); s(ctx.currentTime); }
    },
    allOff(){ held.forEach(s => s(ctx.currentTime)); held.clear(); },
    schedule(m, when, dur, o){
      if(!ctx) return;
      o = o || {};
      const s = play(m, when, o.vel || 90, o.tag, !!o.soft);
      s(when + dur);
      if(o.tag){ if(!tagged.has(o.tag)) tagged.set(o.tag, []); tagged.get(o.tag).push(s); }
    },
    cancel(tag){
      const now = ctx ? ctx.currentTime : 0;
      (tagged.get(tag) || []).forEach(s => s(now));
      tagged.delete(tag);
      [...Object.values(inst), ...Object.values(soft)].forEach(i => { try{ i.stop(tag); }catch(e){} });
      const b = tagBus.get(tag); if(b){ try{ b.disconnect(); }catch(e){} tagBus.delete(tag); }
    },
    onStatus(fn){ statusFn = fn || (() => {}); },
  };
  window.Sound = Sound;
})();
