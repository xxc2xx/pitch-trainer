// qc.js — validation gate for the Beat Hive prototype.
// Validates the WHOLE rendered state, not just the last edit: a delta check
// cannot catch deletion, and every regression in this file so far has been
// something removed or detached rather than something added.
//   usage: node tools/qc.js [file.html]      exit 0 = pass, 1 = fail
// QC harness: validates the whole rendered state, not just the last delta.
const fs=require('fs');
const F=process.argv[2]||require('path').join(__dirname,'..','dj-lab2.html');
const h=fs.readFileSync(F,'utf8');
let fail=0; const bad=m=>{console.log('  FAIL  '+m);fail++;};
const ok =m=>console.log('  ok    '+m);

// 1 ── JS parses
const blocks=[...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
blocks.forEach((b,i)=>{ try{ new Function(b); }catch(e){ bad('script #'+(i+1)+' parse: '+e.message); } });
ok('all '+blocks.length+' script blocks parse');
const js=blocks[1];

// 2 ── every class/id the JS creates must have a CSS rule
const NEED=['.rs-dial{','.rs-dial-scroll{','.rs-dial-cap{','.rs-dial-band{','.rs-dial-item{',
            '#rsTop{','#rsPlay{','#rsDisplay{','.rs-lcd{','#rsBottom{','#rsDeck{',
            '#rsBankDots{','.rs-dot{','.rs-bank-name{'];
const miss=NEED.filter(n=>!h.includes(n));
miss.length?bad('missing CSS: '+miss.join(' ')):ok('all '+NEED.length+' CSS rules present');

// 3 ── ids referenced in JS exist in the HTML it generates
['beatDial','who1','who2','rsPlay','rsBankName','rsBank','rsBpm','rsMatrix']
 .forEach(id=>{ h.includes(id)?0:bad('id not built: '+id); });
ok('dial + display ids wired');

// 4 ── sprites
const CHARS=eval('('+js.match(/const CHARS=(\{[\s\S]*?\n  \});/)[1]+')');
const ORDER=eval(js.match(/const CHAR_ORDER=(\[[^\]]*\]);/)[1]);
const PERS =eval('('+js.match(/const PERSONA=(\{[\s\S]*?\n  \});/)[1]+')');
let sp=0;
ORDER.forEach(k=>{const c=CHARS[k];
  if(!c) return bad('no sprite: '+k);
  if(!PERS[k]) return bad('no persona: '+k);
  const v=px=>{const w=px.filter(r=>r.length!==16).length;
    const mx=Math.max(...px.join('').split('').filter(x=>x!=='.').map(Number));
    if(px.length!==16||w||mx>c.pal.length) bad(c.name+' sprite geometry'); else sp++;};
  v(c.px); (c.frames||[]).forEach(v);});
ok(ORDER.length+' dancers, '+sp+' sprite frames valid');

// 5 ── layout order must be unique and complete
const ord=[...h.matchAll(/body\.mode-dj ([#.][\w-]+)\{order:(\d)/g)].map(m=>[m[1],+m[2]]);
// collision = same order value on DIFFERENT elements
const byOrd={}; ord.forEach(([sel,n])=>{(byOrd[n]=byOrd[n]||new Set()).add(sel);});
// swipe pages may share a slot: they're mutually exclusive (display toggled)
const SHARED=[['#djPads','#pianoArea']];
const clash=Object.entries(byOrd).filter(([n,set])=>{
  if(set.size<2) return false;
  return !SHARED.some(g=>[...set].every(x=>g.includes(x)));
});
clash.length?bad('order collision: '+clash.map(([n,s])=>n+'->'+[...s]).join(' '))
           :ok('layout order: '+Object.entries(byOrd).sort((a,b)=>a[0]-b[0]).map(([n,s])=>n+'='+[...s][0]).join(' '));

// 6 ── live app untouched
const live=fs.readFileSync(require('path').join(__dirname,'..','index.html'),'utf8');
const removed=live.split('\n').filter(l=>l.trim()&&!h.includes(l)).length;
removed?bad(removed+' lines of index.html missing from prototype'):ok('index.html fully preserved (0 lines lost)');


// 7 ── pad colour integrity: every pad must ship an inline --pc, and the
//      switchDjBank wrapper must restore it (the original deletes it).
const pads=[...h.matchAll(/class="dj-pad"[^>]*style="--pc:(#[0-9a-fA-F]{6})/g)].map(m=>m[1]);
pads.length===16?ok('16 pads carry inline --pc'):bad('only '+pads.length+' pads have --pc');
js.includes("ORIG_PC")&&js.includes("setProperty('--pc',ORIG_PC[i])")
  ?ok('bank switch restores original pad colours'):bad('pad colour restore missing');
js.includes('CHOP_PC')?ok('chop slices colour-coded'):bad('chop colours missing');

// 8 ── no synthetic-mouse double fire on bank swipe
js.includes("addEventListener('mousedown'")?bad('mouse fallback still present (double-fires on iOS)')
                                           :ok('swipe is touch-only');

// 9 ── page must be locked to the viewport
h.includes('overflow:hidden!important')?ok('page locked, no scroll'):bad('page still scrollable');

// 10 ── defaults
const dm=js.match(/let who1='(\w+)', who2='(\w+)'/);
const seed=js.match(/dWho2\.seed\((\d+)\)/);
const ORD=eval(js.match(/const CHAR_ORDER=(\[[^\]]*\]);/)[1]);
// dial index 0 is "none", so slot-2 seed must be CHAR_ORDER.indexOf(who2)+1
const wantSeed=ORD.indexOf(dm[2])+1;
(dm && seed && +seed[1]===wantSeed && ORD.includes(dm[1]) && ORD.includes(dm[2]))
  ? ok('defaults: '+dm[1]+' + '+dm[2]+' (dial seed '+seed[1]+' matches roster)')
  : bad('dancer defaults/seed mismatch: who2='+(dm&&dm[2])+' seed='+(seed&&seed[1])+' expected '+wantSeed);
js.includes("'__shuf'")?ok('beat defaults to Shuffle'):bad('shuffle not first');

// 10c ── every id the JS creates must be styled
const made=[...js.matchAll(/\.id='(rs[\w-]+)'/g)].map(m=>m[1]);
const unstyled=made.filter(id=>!h.includes('#'+id));
unstyled.length?bad('created but unstyled: '+unstyled):ok('all created ids styled: '+made.join(','));

// 10b ── no CSS for elements the JS no longer builds
const cssIds=[...h.matchAll(/body\.mode-dj (#[\w-]+)\{order:/g)].map(m=>m[1].slice(1));
const orphan=cssIds.filter(id=>!js.includes("'"+id+"'")&&!js.includes('"'+id+'"'));
orphan.length?bad('orphan CSS for removed elements: '+orphan):ok('no orphan layout CSS');

// 11 ── execute against a stub DOM: parse-only checks miss TDZ/runtime errors
try{ require('child_process').execFileSync('node',[__dirname+'/exec-check.js',F],{stdio:'inherit'}); }
catch(e){ fail++; }

console.log(fail?'\n'+fail+' FAILURE(S)':'\nQC PASS');
process.exit(fail?1:0);
