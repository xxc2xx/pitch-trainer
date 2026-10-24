#!/usr/bin/env node
// shared.mjs — governance for the engine modules pitch-trainer shares with
// beat-hive and music-garden. pitch-trainer is the source of truth; consumers
// carry vendored copies pinned by vendor.lock.json. This file is itself
// copied into each consumer's tools/ by `sync`, so the consumer gate needs
// nothing from pitch-trainer to run.
//
//   node tools/shared.mjs manifest              write shared-manifest.json (pitch-trainer)
//   node tools/shared.mjs check                 producer gate: header = VERSION = manifest,
//                                               and API changes match the semver bump
//   node tools/shared.mjs sync <dir> [--major] [--to <commit>] [--dry]
//                                               copy modules into a consumer + write its lock
//   node tools/shared.mjs verify [dir]          consumer gate: files match the lock, every
//                                               name the consumer uses exists in its copy
//
// API = exported names + kind/arity, read by RUNNING each module in a stub
// window (the same way a browser loads them), so it can't drift from the code.
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODULES = {                        // file → global it defines
  'music-core.js': 'MusicCore', 'hear.js': 'Hear', 'midi.js': 'Midi',
  'sound.js': 'Sound', 'echo.js': 'Echo', 'notes.js': 'Notes',
};
const CONSUMERS = {                      // which modules each consumer vendors
  'beat-hive':    ['music-core.js', 'hear.js', 'midi.js'],
  'music-garden': ['music-core.js', 'hear.js', 'midi.js', 'sound.js'],
};
const ALIASES = { MC: 'MusicCore' };     // how consumers name the globals in their own code
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const semver = (v) => (v || '0.0.0').split('.').map(Number);
let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok    ' : '  FAIL  ') + m); if(!c) fail++; return c; };
const warn = (m) => console.log('  warn  ' + m);

// ── load modules in a stub window → { global: {name: kind/arity} } ──────
function apiOf(sources){                 // sources: {file: text}, loaded in dependency order
  const store = {};
  const win = {
    location: { pathname: '/', search: '', hostname: 'example.test' },
    navigator: {}, console, performance: { now: () => 0 },
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    document: { createElement: () => ({ getContext: () => null, style: {} }), addEventListener: () => {} },
  };
  win.window = win; win.self = win; win.globalThis = win;
  const ctx = vm.createContext(win);
  const out = {}, errors = {};
  for(const f of Object.keys(MODULES)){
    if(!(f in sources)) continue;
    try{ vm.runInContext(sources[f], ctx, { filename: f }); }
    catch(e){ errors[f] = e.message; continue; }
    const g = win[MODULES[f]];
    if(!g){ errors[f] = `did not define window.${MODULES[f]}`; continue; }
    const api = {};
    for(const k of Object.keys(g).sort()){
      const d = Object.getOwnPropertyDescriptor(g, k);
      api[k] = d && d.get ? 'getter' : typeof g[k] === 'function' ? 'fn/' + g[k].length : typeof g[k];
    }
    out[f] = api;
  }
  return { api: out, errors };
}
const headerVersion = (text) => (text.match(/^\/\* @shared [\w-]+ (\d+\.\d+\.\d+) \*\//) || [])[1];

// ── producer side (pitch-trainer) ───────────────────────────────────────
function readSources(dir, files){ const s = {}; files.forEach(f => { const p = path.join(dir, f); if(fs.existsSync(p)) s[f] = fs.readFileSync(p, 'utf8'); }); return s; }
function buildManifest(dir){
  const src = readSources(dir, Object.keys(MODULES));
  const { api, errors } = apiOf(src);
  const m = {};
  for(const f of Object.keys(MODULES)){
    if(!src[f]) continue;
    m[f] = { global: MODULES[f], version: headerVersion(src[f]) || null, sha256: sha(src[f]), api: api[f] || null,
             consumers: Object.keys(CONSUMERS).filter(c => CONSUMERS[c].includes(f)) };
    if(errors[f]) m[f].loadError = errors[f];
  }
  return m;
}
function check(dir){
  const mpath = path.join(dir, 'shared-manifest.json');
  const old = fs.existsSync(mpath) ? JSON.parse(fs.readFileSync(mpath, 'utf8')) : {};
  const now = buildManifest(dir);
  for(const [f, cur] of Object.entries(now)){
    ok(!cur.loadError, `${f} loads in a stub window${cur.loadError ? ': ' + cur.loadError : ''}`);
    ok(!!cur.version, `${f} has an @shared header`);
    const exported = cur.api && cur.api.VERSION;
    const g = cur.api ? cur.version : null;
    if(cur.api) ok(exported === 'string', `${f} exports VERSION`);
    // VERSION value must equal the header
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    const val = (src.match(/VERSION\s*[:=]\s*'(\d+\.\d+\.\d+)'/) || [])[1];
    ok(val === cur.version, `${f} VERSION '${val}' = header '${cur.version}'`);
    const prev = old[f];
    if(!prev || !prev.api || !cur.api) continue;
    const removed = Object.keys(prev.api).filter(k => !(k in cur.api));
    const changed = Object.keys(prev.api).filter(k => k in cur.api && prev.api[k] !== cur.api[k]);
    const added = Object.keys(cur.api).filter(k => !(k in prev.api));
    const [M0, m0, p0] = semver(prev.version), [M1, m1, p1] = semver(cur.version);
    const bumped = M1 > M0 ? 'major' : m1 > m0 && M1 === M0 ? 'minor' : p1 > p0 && M1 === M0 && m1 === m0 ? 'patch' : 'none';
    if(removed.length || changed.length) ok(bumped === 'major', `${f}: removed/changed [${[...removed, ...changed].join(', ')}] needs a MAJOR bump (have ${prev.version} → ${cur.version})`);
    else if(added.length) ok(bumped === 'minor' || bumped === 'major', `${f}: added [${added.join(', ')}] needs at least a MINOR bump (have ${prev.version} → ${cur.version})`);
    else if(prev.sha256 !== cur.sha256) ok(bumped !== 'none', `${f}: code changed, version must be bumped (still ${cur.version})`);
  }
  return now;
}

// ── consumer side ────────────────────────────────────────────────────────
// names a consumer's OWN code (not the vendored files) uses on each global
function usesOf(dir, vendored){
  const globals = Object.values(MODULES);
  const re = new RegExp(`\\b(${[...globals, ...Object.keys(ALIASES)].join('|')})\\.([A-Za-z_$][\\w$]*)`, 'g');
  const skip = new Set([...vendored, 'shared.mjs']);
  const uses = {};
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
    if(e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'staging' || e.name === 'reports') return;
    const p = path.join(d, e.name);
    if(e.isDirectory()) return walk(p);
    if(!/\.(js|mjs|html)$/.test(e.name) || skip.has(e.name)) return;
    const t = fs.readFileSync(p, 'utf8');
    for(const m of t.matchAll(re)){ const g = ALIASES[m[1]] || m[1]; (uses[g] = uses[g] || new Set()).add(m[2]); }
  });
  walk(dir);
  return Object.fromEntries(Object.entries(uses).map(([g, s]) => [g, [...s].sort()]));
}
function sync(dest, flags){
  const name = path.basename(path.resolve(dest));
  const files = CONSUMERS[name];
  if(!files){ console.log(`unknown consumer '${name}' (known: ${Object.keys(CONSUMERS).join(', ')})`); process.exit(1); }
  const src = path.join(HERE, '..');
  const at = flags.to || null;
  const read = (f) => at ? execSync(`git -C "${src}" show ${at}:${f}`, { encoding: 'utf8', maxBuffer: 1 << 26 }) : fs.readFileSync(path.join(src, f), 'utf8');
  const git = (c) => { try{ return execSync(`git -C "${src}" ${c}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }catch(e){ return null; } };
  const commit = git(`rev-parse --short ${at || 'HEAD'}`) || 'no-git';
  const dirty = !at && git(`status --porcelain -- ${files.join(' ')}`);
  const lockPath = path.join(dest, 'vendor.lock.json');
  const lock = fs.existsSync(lockPath) ? JSON.parse(fs.readFileSync(lockPath, 'utf8')) : { modules: {} };
  const next = { source: 'pitch-trainer', sourceCommit: commit + (dirty ? '+uncommitted' : ''), syncedAt: new Date().toISOString(), modules: {} };
  for(const f of files){
    const text = read(f), v = headerVersion(text);
    const prev = lock.modules && lock.modules[f];
    if(prev && semver(v)[0] > semver(prev.version)[0] && !flags.major){
      console.log(`  REFUSED  ${f}: ${prev.version} → ${v} is a MAJOR change for ${name}. Review its uses, then re-run with --major.`);
      process.exit(2);
    }
    if(!flags.dry) fs.writeFileSync(path.join(dest, f), text);
    next.modules[f] = { version: v, sha256: sha(text) };
    console.log(`  ${flags.dry ? 'would sync' : 'synced'} ${f} ${prev ? prev.version : '—'} → ${v}`);
  }
  if(!flags.dry){
    fs.mkdirSync(path.join(dest, 'tools'), { recursive: true });
    fs.copyFileSync(fileURLToPath(import.meta.url), path.join(dest, 'tools', 'shared.mjs'));
    const u = usesOf(dest, files);
    for(const f of files) next.modules[f].uses = u[MODULES[f]] || [];
    fs.writeFileSync(lockPath, JSON.stringify(next, null, 2) + '\n');
    console.log(`  lock → ${lockPath} (${next.sourceCommit})`);
  }
}
function verify(dir){
  const lockPath = path.join(dir, 'vendor.lock.json');
  if(!ok(fs.existsSync(lockPath), 'vendor.lock.json present')) return;
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const files = Object.keys(lock.modules);
  const src = readSources(dir, files);
  for(const f of files){
    ok(!!src[f], `${f} present`);
    if(src[f]) ok(sha(src[f]) === lock.modules[f].sha256, `${f} unmodified since sync (${lock.modules[f].version} @ ${lock.sourceCommit})`);
  }
  const { api, errors } = apiOf(src);
  const uses = usesOf(dir, files);
  for(const f of files){
    if(errors[f]){ ok(false, `${f} loads: ${errors[f]}`); continue; }
    const g = MODULES[f], used = uses[g] || [];
    const missing = used.filter(n => !(n in (api[f] || {})));
    ok(!missing.length, `${g}: all ${used.length} names this app uses exist${missing.length ? ' — MISSING ' + missing.join(', ') : ''}`);
  }
  // the source moving ahead is not a failure, just news
  const pt = process.env.PITCH_TRAINER || path.join(dir, '..', 'pitch-trainer');
  if(fs.existsSync(path.join(pt, 'music-core.js'))){
    for(const f of files){
      const p = path.join(pt, f); if(!fs.existsSync(p)) continue;
      const v = headerVersion(fs.readFileSync(p, 'utf8'));
      if(v && v !== lock.modules[f].version) warn(`${f}: pitch-trainer has ${v}, this app pins ${lock.modules[f].version} — run pitch-trainer tools/sync-core.sh when ready`);
    }
  }
}

// ── cli ──────────────────────────────────────────────────────────────────
const [cmd, ...rest] = process.argv.slice(2);
const flags = { major: rest.includes('--major'), dry: rest.includes('--dry'), to: rest.includes('--to') ? rest[rest.indexOf('--to') + 1] : null };
const pos = rest.filter((a, i) => !a.startsWith('--') && rest[i - 1] !== '--to');
if(cmd === 'manifest'){
  const dir = path.join(HERE, '..');
  fs.writeFileSync(path.join(dir, 'shared-manifest.json'), JSON.stringify(buildManifest(dir), null, 2) + '\n');
  console.log('wrote shared-manifest.json');
} else if(cmd === 'check'){
  check(path.join(HERE, '..'));
  console.log(fail ? `\nSHARED CHECK FAIL (${fail})` : '\nSHARED CHECK PASS');
} else if(cmd === 'sync'){
  if(!pos[0]){ console.log('usage: shared.mjs sync <consumer-dir> [--major] [--to <commit>] [--dry]'); process.exit(1); }
  sync(pos[0], flags);
} else if(cmd === 'verify'){
  verify(pos[0] || path.join(HERE, '..'));
  console.log(fail ? `\nVENDOR CHECK FAIL (${fail})` : '\nVENDOR CHECK PASS');
} else {
  console.log('usage: shared.mjs manifest | check | sync <dir> [--major] [--to <commit>] [--dry] | verify [dir]');
  process.exit(1);
}
process.exit(fail ? 1 : 0);
