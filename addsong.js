/* addsong.js — "➕ Add a song": her real songs into the library.
   Classic script → window.AddSong. Depends on music-core.js, hear.js,
   songfile.js.

   AddSong.open({ detectPitch, onSaved(song) })

   Ways in:
   📁 Video / audio file  → on-device transcription (basic-pitch), original kept
   🎬 Capture a Chrome tab → record the audio of a video playing in another tab
                             (Chrome desktop: share a TAB and tick "share tab audio")
   📄 MIDI / MusicXML      → exact notes, no guessing
   🎤 Sing it              → live voice → notes
   The original recording is saved with the song (IndexedDB) so the player
   can show the notes in sync with it.
*/
(function(){
  'use strict';
  const MC = window.MusicCore;
  const CSS = `
  #asSheet{position:fixed;inset:0;z-index:60;background:rgba(6,6,16,.9);display:flex;align-items:center;justify-content:center;padding:14px;}
  #asSheet .as-box{background:#14142a;border:1px solid #2a2a55;border-radius:16px;padding:16px;width:100%;max-width:520px;
    display:flex;flex-direction:column;gap:12px;color:#e6e6f5;max-height:92vh;overflow:auto;}
  #asSheet h2{font-size:1.05rem;margin:0;}
  #asSheet .as-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
  #asSheet .as-opt{background:#1c1c3a;border:2px solid #2c2c5a;border-radius:12px;padding:12px 8px;color:#e6e6f5;
    font-weight:700;font-size:.82rem;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px;text-align:center;position:relative;}
  #asSheet .as-opt small{font-weight:500;color:#8a8ab8;font-size:.68rem;}
  #asSheet .as-opt .ic{font-size:1.6rem;}
  #asSheet .as-opt.off{opacity:.4;cursor:not-allowed;}
  #asSheet .as-opt input{position:absolute;inset:0;opacity:0;cursor:pointer;}
  #asSheet .as-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:.8rem;}
  #asSheet input[type=text]{flex:1;min-width:160px;background:#0c0c1e;border:1px solid #2c2c5a;border-radius:8px;color:#fff;padding:7px 9px;font-size:.85rem;}
  #asSheet .as-bar{height:8px;border-radius:4px;background:#0c0c1e;overflow:hidden;}
  #asSheet .as-bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#e53935,#fdd835,#43a047,#8e24aa);transition:width .3s;}
  #asSheet .as-msg{font-size:.82rem;color:#c8c8f0;min-height:1.2em;}
  #asSheet .as-err{color:#ff8a8a;}
  #asSheet .as-tip{font-size:.72rem;color:#8a8ab8;line-height:1.4;}
  #asSheet .as-btn{background:#2c2c5a;border:none;border-radius:10px;color:#fff;font-weight:700;padding:9px 14px;cursor:pointer;}
  #asSheet .as-btn.go{background:#e94560;}
  #asSheet .as-rec{display:flex;align-items:center;gap:10px;font-size:1rem;font-weight:800;}
  #asSheet .as-dot{width:12px;height:12px;border-radius:50%;background:#e94560;animation:asblink 1s infinite;}
  @keyframes asblink{50%{opacity:.3}}`;
  function injectCSS(){
    if(document.getElementById('as-css')) return;
    const s = document.createElement('style'); s.id = 'as-css'; s.textContent = CSS; document.head.appendChild(s);
  }
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
  const canCapture = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) && !/iPhone|iPad|Android/i.test(navigator.userAgent);
  const pickMime = () => ['audio/webm;codecs=opus','audio/mp4','audio/webm'].find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t));

  function open(o){
    injectCSS();
    o = o || {};
    const ov = document.createElement('div'); ov.id = 'asSheet';
    ov.innerHTML = `<div class="as-box">
      <h2>➕ Add a song</h2>
      <div class="as-row"><input type="text" id="asTitle" placeholder="Song name (optional)">
        <label><input type="checkbox" id="asClass" checked> 🎒 From class</label></div>
      <div class="as-grid" id="asOpts">
        <label class="as-opt"><span class="ic">📁</span>Video or music file<small>mp4 · mov · mp3 · m4a</small>
          <input type="file" id="asFile" accept="audio/*,video/*,.mp4,.mov,.m4a,.mp3,.wav,.webm"></label>
        <button class="as-opt${canCapture ? '' : ' off'}" id="asTab"><span class="ic">🎬</span>Capture a Chrome tab
          <small>${canCapture ? 'record a video playing in another tab' : 'needs Chrome on a computer'}</small></button>
        <label class="as-opt"><span class="ic">📄</span>MIDI / MusicXML<small>exact notes — no guessing</small>
          <input type="file" id="asSheetFile" accept=".mid,.midi,.musicxml,.xml,.mxl,audio/midi,audio/x-midi"></label>
        <button class="as-opt" id="asSing"><span class="ic">🎤</span>Sing it<small>your voice → notes</small></button>
      </div>
      <div id="asWork" style="display:none;flex-direction:column;gap:8px">
        <div class="as-msg" id="asMsg"></div><div class="as-bar"><i id="asBar"></i></div>
        <div id="asAct" class="as-row"></div>
      </div>
      <div class="as-tip">Tip: songs with a band behind the voice come out rough on the device —
        fix them in ✏️, use ✨ Better notes when it's set up, or find a MIDI/MusicXML of the song (MuseScore, IMSLP)
        for exact notes.</div>
      <div class="as-row" style="justify-content:flex-end"><button class="as-btn" id="asClose">Close</button></div>
    </div>`;
    document.body.appendChild(ov);
    const $ = id => ov.querySelector('#' + id);
    let busy = false, cleanup = null;
    const close = () => { if(cleanup) cleanup(); ov.remove(); };
    $('asClose').onclick = close;

    const work = (msg, frac) => {
      $('asOpts').style.display = 'none'; $('asWork').style.display = 'flex';
      $('asMsg').className = 'as-msg'; $('asMsg').textContent = msg;
      if(frac != null) $('asBar').style.width = Math.round(frac * 100) + '%';
    };
    const fail = msg => {
      busy = false; $('asMsg').className = 'as-msg as-err'; $('asMsg').textContent = '⚠ ' + msg;
      $('asAct').innerHTML = '<button class="as-btn" id="asBack">← Try another way</button>';
      $('asBack').onclick = () => { $('asWork').style.display = 'none'; $('asOpts').style.display = 'grid'; $('asAct').innerHTML = ''; };
    };
    const title = fallback => ($('asTitle').value.trim() || fallback || 'My song').slice(0, 40);

    async function save(song, blob, kind){
      if(song.notes.length < 2) return fail('Didn’t find a tune in that — try a clearer part of the song.');
      song.title = ($('asTitle').value.trim() || song.title || 'My song').slice(0, 40);
      if($('asClass').checked) song.tag = 'class';
      try{
        if(blob){
          song.audioId = song.audioId || ('aud_' + song.id);
          song.sync = { ...(song.sync || {}), audioId: song.audioId, kind: kind || 'audio' };
          await MC.store.saveAudio(song.audioId, blob);
        }
        await MC.store.saveTake(song);
      }catch(e){ return fail('Couldn’t save: ' + e.message); }
      work(`✓ “${song.title}” — ${song.notes.length} notes, ${song.bpm} BPM`, 1);
      $('asAct').innerHTML = '<button class="as-btn go" id="asOpen">▶ Open it</button>';
      $('asOpen').onclick = () => { close(); o.onSaved && o.onSaved(song); };
      busy = false;
    }
    async function transcribe(blob, kind, name){
      work('Getting the music ready…', 0.02);
      try{
        const song = await Hear.transcribeBlob(blob, { title: name, source: kind === 'video' ? 'video' : 'audio-file', kind,
          onProgress: (p, m) => work((m === 'Listening…' ? '👂 Listening for the notes…' : m), p) });
        song.title = name;
        await save(song, blob, kind);
      }catch(e){ fail(/decode|Unable to decode|EncodingError/i.test(e.message || '') ? 'This file’s sound can’t be read here — try an mp4/mp3.' : e.message); }
    }

    // 📁 audio / video file
    $('asFile').onchange = e => {
      const f = e.target.files && e.target.files[0]; e.target.value = '';
      if(!f || busy) return; busy = true;
      if(f.size > 400e6) return fail('That file is very big (over 400 MB) — trim it to the song first.');
      const kind = /^video\//.test(f.type) || /\.(mp4|mov|webm|m4v)$/i.test(f.name) ? 'video' : 'audio';
      transcribe(f, kind, title(f.name.replace(/\.[^.]+$/, '')));
    };

    // 📄 MIDI / MusicXML
    $('asSheetFile').onchange = async e => {
      const f = e.target.files && e.target.files[0]; e.target.value = '';
      if(!f || busy) return; busy = true;
      work('Reading the sheet…', 0.5);
      try{
        let song;
        if(/\.mxl$/i.test(f.name)) throw new Error('That’s compressed MusicXML (.mxl) — export as “uncompressed .musicxml” instead.');
        if(/\.(mid|midi)$/i.test(f.name) || /midi/.test(f.type)) song = SongFile.parseMidi(await f.arrayBuffer());
        else song = SongFile.parseMusicXML(await f.text());
        if(!$('asTitle').value.trim() && (!song.title || /MIDI song|Sheet song/.test(song.title))) song.title = f.name.replace(/\.[^.]+$/, '');
        await save(song, null);
      }catch(err){ fail(err.message); }
    };

    // 🎬 capture a Chrome tab's audio
    $('asTab').onclick = async () => {
      if(!canCapture || busy) return; busy = true;
      let stream;
      try{
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: true, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
          preferCurrentTab: false, selfBrowserSurface: 'exclude', systemAudio: 'exclude', surfaceSwitching: 'include' });
      }catch(e){ return fail('Capture was cancelled.'); }
      const tracks = stream.getAudioTracks();
      if(!tracks.length){ stream.getTracks().forEach(t => t.stop()); return fail('No sound came through — pick a TAB and tick “Also share tab audio”.'); }
      const mt = pickMime(), chunks = [];
      const rec = new MediaRecorder(new MediaStream(tracks), mt ? { mimeType: mt } : undefined);
      rec.ondataavailable = ev => { if(ev.data && ev.data.size) chunks.push(ev.data); };
      const t0 = Date.now();
      work('', null);
      $('asMsg').innerHTML = '<span class="as-rec"><span class="as-dot"></span>Recording the tab… <span id="asTime">0:00</span></span>' +
        '<div class="as-tip" style="margin-top:6px">Play the video in the other tab from the start of the song. Come back and tap Stop when it ends.</div>';
      $('asAct').innerHTML = '<button class="as-btn go" id="asStop">■ Stop</button>';
      const tick = setInterval(() => { const s = Math.floor((Date.now() - t0) / 1000); const el = $('asTime'); if(el) el.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }, 500);
      const finish = () => new Promise(res => {
        clearInterval(tick);
        rec.onstop = () => { stream.getTracks().forEach(t => t.stop()); res(new Blob(chunks, { type: rec.mimeType || 'audio/webm' })); };
        if(rec.state !== 'inactive') rec.stop(); else rec.onstop();
      });
      cleanup = () => { cleanup = null; try{ clearInterval(tick); if(rec.state !== 'inactive') rec.stop(); stream.getTracks().forEach(t => t.stop()); }catch(e){} };
      let done = false;
      const stopNow = async () => {
        if(done) return; done = true; cleanup = null;
        const blob = await finish();
        if(Date.now() - t0 < 2500) return fail('That was too short — record the whole song.');
        transcribe(blob, 'audio', title('Captured song'));
      };
      tracks[0].addEventListener('ended', stopNow);          // Chrome's own “Stop sharing” bar
      rec.start(500);
      $('asStop').onclick = stopNow;
    };

    // 🎤 sing it
    $('asSing').onclick = async () => {
      if(busy) return; busy = true;
      let r;
      try{ r = await Hear.singRecorder({ detectPitch: o.detectPitch }); }
      catch(e){ return fail('Mic: ' + e.message); }
      work('', null);
      $('asMsg').innerHTML = '<span class="as-rec"><span class="as-dot"></span>Sing your song…</span>';
      $('asAct').innerHTML = '<button class="as-btn go" id="asStop">■ Done</button>';
      cleanup = () => { cleanup = null; r.stop(); };
      $('asStop').onclick = async () => {
        cleanup = null;
        work('Working out the notes…', 0.6);
        const { take, blob } = await r.stop();
        take.title = title('Sung song');
        save(take, blob, 'audio');
      };
    };
  }

  window.AddSong = { open, canCapture };
})();
