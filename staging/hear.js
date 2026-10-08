/* hear.js — Hear: microphone/audio → notes → Take.
   Classic script → window.Hear. Depends on music-core.js.

   Hear.pitchStream({ detectPitch, onPitch })      → { stop() }
       Live mic pitch, ~33 fps. onPitch(midiFloat|null, freq|null).
       detectPitch is the app's own autocorrelation detector (index.html),
       passed in so there is exactly one detector to tune.

   Hear.singRecorder({ detectPitch, onPitch })     → { stop() → Promise<{take, blob}> }
       Same stream, plus note segmentation and the raw audio (for a later,
       better offline pass). Built for a child's voice: notes are snapped to
       the best-fitting major key and moved by octaves into C4–C5.

   Hear.transcribeBlob(blob, { bpm, onProgress })  → Promise<Take>
       Offline, polyphonic, on-device: Spotify basic-pitch (TF.js), loaded
       lazily from jsDelivr only when first used (~1 MB model + TF.js).
       Best on a voice or one instrument; a full band mix comes out messy.
*/
(function(){
  'use strict';
  const MC = window.MusicCore;
  const BP_VER = '1.0.1';
  const BP_ESM = `https://cdn.jsdelivr.net/npm/@spotify/basic-pitch@${BP_VER}/+esm`;
  const BP_MODEL = `https://cdn.jsdelivr.net/npm/@spotify/basic-pitch@${BP_VER}/model/model.json`;
  const MAJOR = [0,2,4,5,7,9,11];
  const KEY_NAMES = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
  const KEY_PRIOR = { 0:1.5, 5:1, 7:1, 2:0.5, 10:0.5 };   // C, F, G, D, Bb

  // ── Shared mic plumbing ───────────────────────────────────────────────
  // Must be called synchronously from the tap handler: the AudioContext is
  // created and resumed BEFORE awaiting the permission prompt, because iOS
  // only unlocks audio inside the original gesture — one created after the
  // await can stay suspended and the analyser never sees a frame.
  async function openMic(){
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
      throw new Error('Microphone needs https (or localhost)');
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const resumed = ac.resume().catch(() => {});
    let stream;
    try{
      stream = await navigator.mediaDevices.getUserMedia({
        audio:{ echoCancellation:false, noiseSuppression:false, autoGainControl:false }, video:false });
    }catch(e){ try{ ac.close(); }catch(_){} throw e; }
    await resumed;
    if(ac.state !== 'running') await ac.resume().catch(() => {});
    const src = ac.createMediaStreamSource(stream);
    const an = ac.createAnalyser(); an.fftSize = 2048; an.smoothingTimeConstant = 0;
    src.connect(an);
    return { stream, ac, src, an };
  }
  function closeMic(m){
    try{ m.stream.getTracks().forEach(t => t.stop()); }catch(e){}
    try{ m.ac.close(); }catch(e){}
  }

  function pitchLoop(mic, detectPitch, onFrame){
    const buf = new Float32Array(mic.an.fftSize);
    let smoothed = null, alive = true;
    const iv = setInterval(() => {
      if(!alive) return;
      mic.an.getFloatTimeDomainData(buf);
      const raw = detectPitch(buf, mic.ac.sampleRate);
      if(raw && raw > 60 && raw < 1600){
        // same octave-jump guard + log smoothing as the Listen loop
        if(!smoothed) smoothed = raw;
        else {
          const r = raw / smoothed, adj = r > 1.7 ? raw / 2 : r < 0.6 ? raw * 2 : raw;
          smoothed = Math.exp(0.55 * Math.log(smoothed) + 0.45 * Math.log(adj));
        }
        onFrame(MC.freqToMidiFloat(smoothed), smoothed);
      } else { smoothed = null; onFrame(null, null); }
    }, 30);
    return () => { alive = false; clearInterval(iv); };
  }

  async function pitchStream(o){
    const mic = await openMic();
    const stopLoop = pitchLoop(mic, o.detectPitch, (m, f) => o.onPitch && o.onPitch(m, f));
    return { stop(){ stopLoop(); closeMic(mic); } };
  }

  // ── Segmentation: frames → notes (seconds) ────────────────────────────
  // A note starts once a rounded pitch holds MIN_ON ms and ends after
  // MIN_OFF ms of silence or of a different pitch.
  function segmenter(){
    const MIN_ON = 110, MIN_OFF = 90;
    const notes = [];
    let cur = null, cand = null, gapSince = null, t0 = performance.now();
    return {
      push(mf){
        const now = performance.now() - t0, m = mf == null ? null : Math.round(mf);
        if(cur){
          if(m === cur.m || (mf != null && Math.abs(mf - cur.m) < 0.65)){ gapSince = null; cur.samples.push(mf); cur.end = now; return; }
          if(gapSince == null) gapSince = now;
          if(now - gapSince >= MIN_OFF){ notes.push(cur); cur = null; gapSince = null; }
          else return;
        }
        if(m == null){ cand = null; return; }
        if(!cand || cand.m !== m) cand = { m, start: now, samples: [] };
        cand.samples.push(mf);
        if(now - cand.start >= MIN_ON){ cur = { ...cand, end: now }; cand = null; }
      },
      finish(){
        if(cur) notes.push(cur);
        return notes.map(n => {
          const s = n.samples.slice().sort((a,b) => a - b);
          return { m: Math.round(s[s.length >> 1]), on: n.start / 1000, off: n.end / 1000 };
        });
      },
    };
  }

  // Best-fitting major key, then snap stray notes onto it.
  function snapToKey(notes){
    if(notes.length < 3) return { notes, key:'C' };
    // Weighted profile: tonic > fifth > third > other scale notes, and an
    // out-of-key note costs more than an in-key one earns — the right key is
    // the one that leaves the most sung notes untouched.
    const W = { 0:2, 7:1.5, 4:1.2, 2:1, 5:1, 9:1, 11:1 };
    let best = 0, bestScore = -Infinity;
    for(let k = 0; k < 12; k++){
      const sc = notes.reduce((s, n) => s + (W[MC.pc(n.m - k)] ?? -2) * Math.min(2, n.d || 1), 0)
               + (MC.pc(notes[notes.length - 1].m - k) === 0 ? 0.5 : 0)    // songs tend to end on the tonic
               + (KEY_PRIOR[k] || 0);                                       // class songs live in C/F/G
      if(sc > bestScore){ bestScore = sc; best = k; }
    }
    const snapped = notes.map(n => {
      if(MAJOR.includes(MC.pc(n.m - best))) return n;
      const up = MAJOR.includes(MC.pc(n.m + 1 - best));
      return { ...n, m: n.m + (up ? 1 : -1) };
    });
    return { notes: snapped, key: KEY_NAMES[best] };
  }
  // Whole-octave shift so the median lands in C4–C5 (a child sings higher).
  function normaliseOctave(notes){
    if(!notes.length) return notes;
    const s = notes.map(n => n.m).sort((a,b) => a - b), med = s[s.length >> 1];
    const shift = 12 * Math.round((66 - med) / 12);
    return shift ? notes.map(n => ({ ...n, m: n.m + shift })) : notes;
  }
  // Same pitch broken by a near-zero gap with a sliver is one note (model
  // splits). The live path already bridges dropouts in segmenter().
  function mergeFragments(raw){
    const out = [];
    raw.forEach(n => {
      const p = out[out.length - 1];
      // basic-pitch emits real repeats AND splits back-to-back with zero gap;
      // a split leaves one sliver (<120 ms), a repeat is two full notes.
      const sliver = p && Math.min(p.off - p.on, n.off - n.on) < 0.12;
      if(p && p.m === n.m && n.on - p.off < 0.025 && sliver) p.off = Math.max(p.off, n.off);
      else out.push({ ...n });
    });
    return out;
  }
  // Melody reading: close gaps under half a beat so the staff isn't littered
  // with tiny rests between sung/played notes; real pauses survive.
  function legato(notes, maxGap){
    return notes.map((n, i) => {
      const nx = notes[i + 1];
      if(nx && nx.t > n.t && nx.t - (n.t + n.d) < maxGap) return { ...n, d: nx.t - n.t };
      return n;
    });
  }
  function secondsToTake(raw, o){
    const bpm = o.bpm || 90, spb = 60 / bpm;
    raw = mergeFragments(raw);
    const t0 = raw.length ? raw[0].on : 0;
    let notes = raw.map(n => ({ m: n.m, t: (n.on - t0) / spb, d: Math.max(0.1, (n.off - n.on) / spb), v: n.v || 0.8 }));
    notes = legato(notes, 0.5);
    notes = MC.quantize(notes, o.grid || 0.5);
    // quantize can stack two short notes on one onset — keep the longer
    const seen = new Map(); notes.forEach(n => { const k = n.t + ':' + n.m; if(!seen.has(k) || seen.get(k).d < n.d) seen.set(k, n); });
    notes = [...seen.values()];
    const snapped = o.snap === false ? { notes, key:'C' } : snapToKey(o.normalise === false ? notes : normaliseOctave(notes));
    // sync: beat 0 = the first note, `offsetSec` into the original recording
    return MC.makeTake({ title: o.title || 'My song', source: o.source || 'sing', bpm, key: snapped.key, notes: snapped.notes,
                         sync: { offsetSec: t0, kind: o.kind || 'audio', audioId: o.audioId || null } });
  }

  async function singRecorder(o){
    const mic = await openMic();
    const seg = segmenter();
    let rec = null, chunks = [];
    try{
      const mt = ['audio/webm;codecs=opus','audio/mp4','audio/webm'].find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t));
      rec = new MediaRecorder(mic.stream, mt ? { mimeType: mt } : undefined);
      rec.ondataavailable = e => { if(e.data && e.data.size) chunks.push(e.data); };
      rec.start(250);
    }catch(e){ rec = null; }
    const stopLoop = pitchLoop(mic, o.detectPitch, (m, f) => { seg.push(m); o.onPitch && o.onPitch(m, f); });
    return {
      stop(){
        stopLoop();
        return new Promise(res => {
          const done = () => {
            closeMic(mic);
            const blob = chunks.length ? new Blob(chunks, { type: rec.mimeType || 'audio/webm' }) : null;
            res({ take: secondsToTake(seg.finish(), { ...o, source:'sing' }), blob });
          };
          if(rec && rec.state !== 'inactive'){ rec.onstop = done; rec.stop(); } else done();
        });
      },
    };
  }

  // ── Offline polyphonic transcription (basic-pitch) ────────────────────
  let _bp = null;
  function loadBasicPitch(){
    if(!_bp) _bp = import(BP_ESM).then(mod => ({ mod, model: new mod.BasicPitch(BP_MODEL) }))
                                 .catch(e => { _bp = null; throw e; });
    return _bp;
  }
  // Decoding needs no live AudioContext: an OfflineAudioContext works outside
  // a user gesture (iOS leaves late-created live contexts suspended) and
  // never touches the device's audio session.
  function decode(arrayBuffer){
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const oc = new OAC(1, 1, 44100);
    return new Promise((res, rej) => {
      const p = oc.decodeAudioData(arrayBuffer, res, rej);     // callback form for older Safari
      if(p && p.then) p.then(res, rej);
    });
  }
  async function toMono22k(blob){
    const buf = await decode(await blob.arrayBuffer());
    const len = Math.ceil(buf.duration * 22050);
    const off = new OfflineAudioContext(1, len, 22050);
    const src = off.createBufferSource(); src.buffer = buf; src.connect(off.destination); src.start();
    return off.startRendering();
  }
  async function transcribeBlob(blob, o){
    o = o || {};
    const prog = o.onProgress || (() => {});
    // the sung path normalises to a child's octave; recordings keep theirs
    prog(0.02, 'Loading the listening model…');
    const [{ mod, model }, audio] = await Promise.all([loadBasicPitch(), toMono22k(blob)]);
    const frames = [], onsets = [], contours = [];
    prog(0.1, 'Listening…');
    await model.evaluateModel(audio, (f, on, c) => { frames.push(...f); onsets.push(...on); contours.push(...c); },
                              p => prog(0.1 + p * 0.85, 'Listening…'));
    const evs = mod.noteFramesToTime(mod.addPitchBendsToNoteEvents(contours,
                  mod.outputToNotesPoly(frames, onsets, 0.25, 0.25, 5)));
    const raw = evs.filter(n => n.amplitude > 0.15 && n.durationSeconds > 0.06)
                   .map(n => ({ m: n.pitchMidi, on: n.startTimeSeconds, off: n.startTimeSeconds + n.durationSeconds, v: Math.min(1, n.amplitude) }))
                   .sort((a,b) => a.on - b.on);
    prog(1, 'Done');
    // melody line for the follow engine; keep poly only when asked
    const line = o.poly ? raw : MC.skyline(raw.map(n => ({ ...n, t: n.on }))).map(n => ({ m:n.m, on:n.on, off:n.off, v:n.v }));
    if(!line.length) throw new Error('No notes heard in that recording');
    // tempo from the onsets unless the caller knows it (Beat Hive passes djBpm)
    const bpm = o.bpm || MC.estimateTempo(line.map(n => n.on));
    return secondsToTake(line, { snap:false, ...o, bpm, source: o.source || 'audio-file', grid: o.grid || 0.25 });
  }

  // ── Remote analysis (~/song-analyzer HF Space, Gradio API) ────────────
  // Same protocol the OMR client uses: upload → call → read the SSE result.
  async function gradioCall(base, api, file, o){
    o = o || {};
    base = String(base || '').replace(/\/$/, '');
    if(!/^https:\/\//.test(base) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) throw new Error('Analyzer address must start with https://');
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), o.timeoutMs || 360000);
    try{
      const fd = new FormData(); fd.append('files', file, file.name || 'song.wav');
      const up = await fetch(`${base}/gradio_api/upload?upload_id=${Math.random().toString(36).slice(2)}`, { method: 'POST', body: fd, signal: ctrl.signal });
      if(!up.ok) throw new Error(`upload ${up.status}`);
      const path = (await up.json())[0];
      o.onPhase && o.onPhase('queued');
      const call = await fetch(`${base}/gradio_api/call/${api}`, { method: 'POST', signal: ctrl.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ data: [{ path, meta: { _type: 'gradio.FileData' } }] }) });
      if(!call.ok) throw new Error(`call ${call.status}`);
      const { event_id } = await call.json();
      const sse = await fetch(`${base}/gradio_api/call/${api}/${event_id}`, { signal: ctrl.signal });
      const text = await sse.text();                 // stream ends after complete/error
      const blocks = text.split(/\n\n+/);
      for(const b of blocks){
        const ev = (b.match(/^event:\s*(\S+)/m) || [])[1], data = (b.match(/^data:\s*([\s\S]*)$/m) || [])[1];
        if(ev === 'error') throw new Error('analyzer error' + (data && data !== 'null' ? ': ' + data.slice(0, 160) : ' (GPU quota or crash — try later)'));
        if(ev === 'complete'){ const arr = JSON.parse(data); return arr[0]; }
      }
      throw new Error('analyzer returned no result');
    } catch(e){ if(e.name === 'AbortError') throw new Error('analyzer timed out'); throw e; }
    finally{ clearTimeout(timer); }
  }
  // Big videos: send only the sound, as a compact mono WAV.
  async function audioForUpload(blob){
    if(blob.size < 40e6 && !/^video\//.test(blob.type)) return new File([blob], 'song.' + ((blob.type.split('/')[1] || 'mp3').split(';')[0]), { type: blob.type });
    const buf = await decode(await blob.arrayBuffer());
    const sr = 32000, len = Math.min(Math.ceil(buf.duration * sr), sr * 360);
    const off = new OfflineAudioContext(1, len, sr), src = off.createBufferSource();
    src.buffer = buf; src.connect(off.destination); src.start();
    const x = (await off.startRendering()).getChannelData(0);
    const ab = new ArrayBuffer(44 + x.length * 2), v = new DataView(ab);
    const w = (o, str) => { for(let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
    w(0,'RIFF'); v.setUint32(4, 36 + x.length * 2, true); w(8,'WAVE'); w(12,'fmt '); v.setUint32(16,16,true);
    v.setUint16(20,1,true); v.setUint16(22,1,true); v.setUint32(24,sr,true); v.setUint32(28,sr*2,true);
    v.setUint16(32,2,true); v.setUint16(34,16,true); w(36,'data'); v.setUint32(40, x.length * 2, true);
    for(let i = 0; i < x.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x[i])) * 32767, true);
    return new File([ab], 'song.wav', { type: 'audio/wav' });
  }
  async function analyzeRemote(base, blob, o){
    o = o || {};
    o.onPhase && o.onPhase('preparing');
    const file = await audioForUpload(blob);
    o.onPhase && o.onPhase('uploading');
    const txt = await gradioCall(base, 'analyze', file, o);
    const res = typeof txt === 'string' ? JSON.parse(txt) : txt;
    if(res.error) throw new Error(res.error);
    return res;
  }

  window.Hear = { decode, pitchStream, singRecorder, transcribeBlob, snapToKey, normaliseOctave, secondsToTake, mergeFragments, legato,
                  gradioCall, analyzeRemote };
})();
