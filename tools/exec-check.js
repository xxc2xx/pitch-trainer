// exec-check.js — runs the appended reskin script against a stub DOM to catch
// RUNTIME errors (TDZ, null lookups, undefined globals) that a parse-only check
// cannot see. The stub models DOM connectivity on purpose: getElementById()
// returns null for elements created but never inserted, which is the exact
// failure mode that has bitten this file twice.
//   usage: node tools/exec-check.js [file.html]
// Executes the reskin script against a stub DOM to catch RUNTIME errors
// (TDZ, undefined refs, bad ordering) that a parse-only check misses.
const fs=require('fs');
const h=fs.readFileSync('/Users/xxc2xx/pitch-trainer/dj-lab2.html','utf8');
// Select the RESKIN block specifically. dj-lab2.html has three <script> blocks:
// block 1 is the original pitch-trainer app, block 2 is the Beat Hive reskin
// (what this gate exists to validate), block 3 is a tiny fallback that catches
// its OWN exceptions. A naive .pop() picks the fallback, so a real TDZ / null
// lookup / ordering bug in the reskin still reports "executes without throwing"
// — defeating the one thing this runtime gate is for. Match by signature, and
// fail closed if it can't be uniquely located rather than run a false pass.
const blocks=[...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const reskin=blocks.filter(b=>/getElementById\(['"]djView['"]\)/.test(b) && /rsDisplay/.test(b));
if(reskin.length!==1){
  console.log('  FAIL  exec-check could not uniquely locate the reskin <script> block '+
              '(matched '+reskin.length+' of '+blocks.length+') — refusing to run a false pass');
  process.exit(1);
}
const js=reskin[0];

const mkStyle=()=>new Proxy({},{get:(t,k)=>
  k==='setProperty'||k==='removeProperty'?()=>{}:
  k==='getPropertyValue'?()=>'#ef4444':(t[k]||''),
  set:(t,k,v)=>{t[k]=v;return true;}});
const REG=new Map();            // id -> element
function connected(e){ while(e){ if(e.__root) return true; e=e.parentNode; } return false; }
function el(tag='div'){
  const e={
    tagName:tag,id:'',className:'',textContent:'',innerHTML:'',value:'120',
    dataset:{v:'x',bank:'drums',pattern:'hiphop'},style:mkStyle(),children:[],
    classList:{add(){},remove(){},toggle(){return true;},contains(){return false;}},
    appendChild(c){e.children.push(c); if(c) c.parentNode=e; return c;},
    insertBefore(c){e.children.unshift(c); if(c) c.parentNode=e; return c;},
    removeChild(){},addEventListener(){},removeEventListener(){},
    querySelector:()=>el(),querySelectorAll:()=>[],closest:()=>el(),
    scrollTo(){},scrollIntoView(){},click(){},focus(){},getBoundingClientRect:()=>({top:0,left:0,width:100,height:100}),
    setAttribute(){},getAttribute:()=>'',offsetWidth:100,offsetHeight:100,scrollTop:0,clientHeight:96,
    getContext:()=>new Proxy({},{get:()=>()=>({})}),width:0,height:0,
    previousElementSibling:null,parentNode:null,__root:false,
  };
  Object.defineProperty(e,'id',{get:()=>e.__id||'',
    set:v=>{ e.__id=v; REG.set(v,e); }});
  // register ids declared via innerHTML so getElementById can resolve them
  Object.defineProperty(e,'innerHTML',{get:()=>e.__html||'',
    set:v=>{ e.__html=v;
      String(v).replace(/id="([^"]+)"/g,(_,id)=>{
        const c=el(); c.__id=id; c.parentNode=e; REG.set(id,c); return _;
      });
    }});
  e.previousElementSibling=null;
  return e;
}
const pads=Array.from({length:16},()=>el('button'));
global.document={
  createElement:tag=>el(tag),
  getElementById:id=>{
    const APP=['djView','djPads','djSeq','djScratch','djDisc0','djDisc1','djBpmSlider',
               'djBpmVal','djTapBtn','djPlayBtn','djAdvBtn','djChopLoad','djChopStatus',
               'pianoArea','instBar','octaveBar','noteCard','hint'];
    if(APP.includes(id)){ const e=el(); e.__root=true; e.id=id; return e; }
    const hit=REG.get(id);
    if(hit) return connected(hit)?hit:null;        // created but never inserted -> null
    const e=el(); e.id=id; e.__root=true;
    if(id==='rsMatrix') e.getContext=()=>new Proxy({},{get:()=>()=>({})});
    return e;
  },
  querySelector:()=>el(),
  querySelectorAll:sel=>sel.includes('dj-pad')?pads:[],
  addEventListener(){},
  body:el(),
};
global.window={AudioContext:function(){},webkitAudioContext:function(){},
  AudioNode:function(){},MediaRecorder:function(){},isSecureContext:true,
  addEventListener(){},djDrum:function(){},switchDjBank:function(){}};
global.navigator={vibrate(){},canShare:()=>false,share:async()=>{},
  mediaDevices:{getUserMedia:async()=>({getTracks:()=>[]})}};
// The reskin reads location.protocol/host for the insecure-origin warning path;
// a secure https origin takes the happy path (skips the warning insert).
global.location={protocol:'https:',host:'xxc2xx.github.io',
  href:'https://xxc2xx.github.io/beat-hive/'};
// djCtx is a block-1 `let` the reskin reads (watchCtx) but this check only runs
// block 2; model "no context created yet" so that path runs for real instead of
// short-circuiting on a swallowed ReferenceError.
global.djCtx=null;
global.AudioNode=function(){}; global.AudioNode.prototype={connect(){}};
global.MediaRecorder=function(){}; global.MediaRecorder.isTypeSupported=()=>true;
global.Audio=function(){return{play(){},pause(){}};}; global.Blob=function(){}; global.File=function(){};
global.URL={createObjectURL:()=>'blob:x'};
let rafN=0;
global.requestAnimationFrame=f=>{ if(rafN++<3) f(); return rafN; };  // cap: tick() re-registers itself
global.setTimeout=(f)=>1; global.setInterval=()=>1; global.clearTimeout=()=>{}; global.clearInterval=()=>{};
global.getComputedStyle=()=>({paddingTop:'35px'});
global.setMode=function(){ global.__mode='dj'; };
global.CHOREO=undefined;

try{
  new Function(js)();
  console.log('  ok    reskin script EXECUTES without throwing');
}catch(e){
  console.log('  FAIL  runtime error: '+e.constructor.name+': '+e.message);
  process.exit(1);
}
