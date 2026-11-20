/* @shared midi 1.0.6 */
/* midi.js — her physical keyboard over Web MIDI. Classic script → window.Midi.

   Web MIDI exists in Chrome / Edge / Firefox, NOT Safari (so not iPad/iPhone).
   Her keyboard station is the Mac in Chrome. USB kids' keyboards that are
   "class compliant" show up directly; Bluetooth ones must first be paired in
   macOS Audio MIDI Setup → MIDI Studio → Bluetooth.

   Midi.supported                 → boolean
   Midi.connect()                 → Promise; call from a tap (Chrome asks permission)
   Midi.autoConnect()             → connect silently if permission was granted before
   Midi.onNote(fn)                fn(m, velocity 0..127, isOn)
   Midi.onStatus(fn)              fn({ state:'unsupported'|'off'|'waiting'|'connected'|'denied', names:[…] })
   Midi.range                     → [lowest, highest] key seen (learned while she plays)

   Sustain pedal (CC64) is honoured here: while it's down, note-offs are held
   and released together when it lifts — consumers just see on/off.
*/
(function(){
  'use strict';
  // env-scoped like every stored name (MusicCore.ns); plain key if music-core isn't loaded
  const RANGE_KEY = window.MusicCore && MusicCore.adoptKey ? MusicCore.adoptKey('musicEco_kbRange') : 'musicEco_kbRange';
  const supported = typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
  let access = null, noteFn = () => {}, statusFn = () => {};
  let pedal = false, pedalSrc = null;                           // pedalSrc: the input whose pedal is down
  const sounding = new Set(), held = new Set();
  const owner = new Map();                                      // sounding note → Set of input ids holding its key down
  let range = (() => { try{ const r = JSON.parse(localStorage.getItem(RANGE_KEY)); return Array.isArray(r) ? r : null; }catch(e){ return null; } })();

  // Chrome can keep an unplugged port in `inputs` with state 'disconnected'
  function names(){ return access ? [...access.inputs.values()].filter(i => i.state !== 'disconnected').map(i => i.name || 'MIDI keyboard') : []; }
  function report(state){ try{ statusFn({ state: state || (names().length ? 'connected' : 'waiting'), names: names() }); }catch(e){} }

  function learn(m){
    const r = range ? [Math.min(range[0], m), Math.max(range[1], m)] : [m, m];
    if(!range || r[0] !== range[0] || r[1] !== range[1]){
      range = r; try{ localStorage.setItem(RANGE_KEY, JSON.stringify(r)); }catch(e){}
    }
  }
  function on(m, v, src){
    // pressed again while still sounding (pedal held it, another keyboard has
    // it down, or a doubled note-on): release it first, so every "on" a
    // consumer sees has exactly one "off"
    if(sounding.has(m)) noteFn(m, 0, false);
    held.delete(m); sounding.add(m);
    if(!owner.has(m)) owner.set(m, new Set());
    owner.get(m).add(src == null ? '?' : src);
    learn(m); noteFn(m, v, true);
  }
  function release(m){ sounding.delete(m); held.delete(m); owner.delete(m); noteFn(m, 0, false); }
  function off(m, src){
    if(!sounding.has(m)) return;                // already released (e.g. a second note-off after a doubled note-on)
    const keys = owner.get(m);
    if(keys){ keys.delete(src == null ? '?' : src); if(keys.size) return; }   // another keyboard still holds it
    if(pedal){ held.add(m); return; }
    release(m);
  }
  function message(e){
    const [st, a, b] = e.data, type = st & 0xf0, ch = st & 0x0f;
    if(ch === 9) return;                                         // drum channel
    const src = e.target && e.target.id;                        // which keyboard (several can be plugged in)
    if(type === 0x90 && b > 0) on(a, b, src);
    else if(type === 0x80 || (type === 0x90 && b === 0)) off(a, src);
    else if(type === 0xb0 && a === 64){                          // sustain pedal
      const down = b >= 64;
      if(pedal && !down){ pedal = false; pedalSrc = null; [...held].forEach(release); }
      else if(down){ pedal = true; pedalSrc = src; }
    }
    else if(type === 0xb0 && (a === 123 || a === 120)){          // all notes off
      [...sounding].forEach(release);
    }
  }
  function attach(){
    if(!access) return;
    access.inputs.forEach(inp => { inp.onmidimessage = message; });
    // unplugged mid-note: nothing will ever send its note-off — release the
    // notes that keyboard was holding (all of them when none is left)
    const live = new Set([...access.inputs.values()].filter(i => i.state !== 'disconnected').map(i => i.id));
    if(!live.size){ pedal = false; pedalSrc = null; [...sounding].forEach(release); report(); return; }
    // the keyboard holding the sustain pedal went away: the pedal is up
    if(pedal && pedalSrc != null && !live.has(pedalSrc)){ pedal = false; pedalSrc = null; [...held].forEach(release); }
    // keys held down on an unplugged keyboard: let go of them there
    [...sounding].forEach(m => {
      const keys = owner.get(m); if(!keys) return;
      [...keys].forEach(k => { if(k !== '?' && !live.has(k)) keys.delete(k); });
      if(!keys.size && !held.has(m)) pedal ? held.add(m) : release(m);
    });
    report();
  }

  const Midi = {
    VERSION: '1.0.6',
    supported,
    get range(){ return range; },
    get connected(){ return names().length > 0; },
    onNote(fn){ noteFn = fn || (() => {}); },
    onStatus(fn){ statusFn = fn || (() => {}); report(supported ? (access ? null : 'off') : 'unsupported'); },
    async connect(){
      if(!supported){ report('unsupported'); return false; }
      try{
        access = await navigator.requestMIDIAccess({ sysex: false });
        access.onstatechange = attach;                            // plug / unplug
        attach();
        return true;
      }catch(e){ report('denied'); return false; }
    },
    async autoConnect(){
      if(!supported || !navigator.permissions) return false;
      try{
        const p = await navigator.permissions.query({ name: 'midi' });
        if(p.state === 'granted') return Midi.connect();
      }catch(e){}
      return false;
    },
    resetRange(){ range = null; try{ localStorage.removeItem(RANGE_KEY); }catch(e){} },
    _message: message,                                             // test hook
    _attach(acc){ access = acc; attach(); },                       // test hook: a fake MIDIAccess
  };
  window.Midi = Midi;
})();
