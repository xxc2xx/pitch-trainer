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
  const RANGE_KEY = 'musicEco_kbRange';
  const supported = typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
  let access = null, noteFn = () => {}, statusFn = () => {};
  let pedal = false;
  const sounding = new Set(), held = new Set();
  let range = (() => { try{ const r = JSON.parse(localStorage.getItem(RANGE_KEY)); return Array.isArray(r) ? r : null; }catch(e){ return null; } })();

  function names(){ return access ? [...access.inputs.values()].map(i => i.name || 'MIDI keyboard') : []; }
  function report(state){ try{ statusFn({ state: state || (names().length ? 'connected' : 'waiting'), names: names() }); }catch(e){} }

  function learn(m){
    const r = range ? [Math.min(range[0], m), Math.max(range[1], m)] : [m, m];
    if(!range || r[0] !== range[0] || r[1] !== range[1]){
      range = r; try{ localStorage.setItem(RANGE_KEY, JSON.stringify(r)); }catch(e){}
    }
  }
  function on(m, v){ held.delete(m); sounding.add(m); learn(m); noteFn(m, v, true); }
  function off(m){
    if(pedal){ held.add(m); return; }
    sounding.delete(m); noteFn(m, 0, false);
  }
  function message(e){
    const [st, a, b] = e.data, type = st & 0xf0, ch = st & 0x0f;
    if(ch === 9) return;                                         // drum channel
    if(type === 0x90 && b > 0) on(a, b);
    else if(type === 0x80 || (type === 0x90 && b === 0)) off(a);
    else if(type === 0xb0 && a === 64){                          // sustain pedal
      const down = b >= 64;
      if(pedal && !down){ pedal = false; held.forEach(m => { sounding.delete(m); noteFn(m, 0, false); }); held.clear(); }
      else pedal = down;
    }
    else if(type === 0xb0 && (a === 123 || a === 120)){          // all notes off
      sounding.forEach(m => noteFn(m, 0, false)); sounding.clear(); held.clear();
    }
  }
  function attach(){
    if(!access) return;
    access.inputs.forEach(inp => { inp.onmidimessage = message; });
    report();
  }

  const Midi = {
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
  };
  window.Midi = Midi;
})();
