// node tools/governance-test.mjs — failure injection for shared-module
// governance. Builds throwaway copies of pitch-trainer's engine and of each
// consumer, breaks them on purpose, and checks the gates refuse:
//   1. a consumer's vendored file edited locally        → consumer verify FAILS
//   2. an export removed without a major bump           → producer check FAILS
//   3. code changed with no version bump                → producer check FAILS
//   4. a major bump synced without --major              → sync REFUSES
//   5. after a forced major sync, a name Garden uses is gone → consumer verify FAILS
//   6. untouched engine → every consumer gate passes     (consumers-test.sh)
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const PT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOME = path.join(PT, '..');
const MODS = ['music-core.js', 'hear.js', 'midi.js', 'sound.js', 'echo.js', 'notes.js'];
let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok    ' : '  FAIL  ') + m); if(!c) fail++; };
const run = (args, cwd) => spawnSync('node', args, { cwd, encoding: 'utf8' });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-'));
const cp = (from, to) => fs.cpSync(from, to, { recursive: true, filter: (s) => !/\/(\.git|reports|staging|node_modules)(\/|$)/.test(s) });
function engineCopy(name){
  const d = path.join(tmp, name); fs.mkdirSync(path.join(d, 'tools'), { recursive: true });
  MODS.forEach(f => fs.copyFileSync(path.join(PT, f), path.join(d, f)));
  fs.copyFileSync(path.join(PT, 'tools', 'shared.mjs'), path.join(d, 'tools', 'shared.mjs'));
  fs.copyFileSync(path.join(PT, 'shared-manifest.json'), path.join(d, 'shared-manifest.json'));
  return d;
}
const edit = (file, from, to) => { const s = fs.readFileSync(file, 'utf8'); if(!s.includes(from)) throw new Error('edit target missing in ' + file + ': ' + from); fs.writeFileSync(file, s.replace(from, to)); };
const setVersion = (file, v) => { const s = fs.readFileSync(file, 'utf8'); fs.writeFileSync(file, s.replace(/@shared ([\w-]+) \d+\.\d+\.\d+/, `@shared $1 ${v}`).replace(/VERSION = '\d+\.\d+\.\d+'/, `VERSION = '${v}'`)); };

try{
  const garden = path.join(HOME, 'music-garden');
  if(!fs.existsSync(garden)) throw new Error('needs ~/music-garden checked out');

  // 1 — local edit of a vendored file
  const g1 = path.join(tmp, 'c1', 'music-garden'); cp(garden, g1);
  fs.appendFileSync(path.join(g1, 'hear.js'), '\n// local tweak\n');
  ok(run([path.join(g1, 'tools', 'shared.mjs'), 'verify', g1]).status !== 0, '1 consumer: a locally edited vendored file fails verify');

  // 2 — export removed, version untouched
  const e2 = engineCopy('e2');
  edit(path.join(e2, 'music-core.js'), '    staffStep, stepToMidi, CLEF_SHIFT,', '    stepToMidi, CLEF_SHIFT,');
  const r2 = run([path.join(e2, 'tools', 'shared.mjs'), 'check']);
  ok(r2.status !== 0 && /needs a MAJOR bump/.test(r2.stdout), '2 producer: removing an export without a major bump fails check');

  // 3 — code changed, version untouched
  const e3 = engineCopy('e3');
  edit(path.join(e3, 'hear.js'), "window.Hear = { VERSION: '1.0.0',", "window.Hear = { VERSION: '1.0.0', /* changed */");
  const r3 = run([path.join(e3, 'tools', 'shared.mjs'), 'check']);
  ok(r3.status !== 0 && /version must be bumped/.test(r3.stdout), '3 producer: a code change with no version bump fails check');

  // 4 — major bump synced without --major
  const e4 = engineCopy('e4');
  edit(path.join(e4, 'music-core.js'), '    staffStep, stepToMidi, CLEF_SHIFT,', '    stepToMidi, CLEF_SHIFT,');
  setVersion(path.join(e4, 'music-core.js'), '2.0.0');
  ok(run([path.join(e4, 'tools', 'shared.mjs'), 'check']).status === 0, '4a producer: the same removal WITH a major bump passes check');
  const g4 = path.join(tmp, 'c4', 'music-garden'); cp(garden, g4);
  const r4 = run([path.join(e4, 'tools', 'shared.mjs'), 'sync', g4]);
  ok(r4.status === 2 && /REFUSED/.test(r4.stdout), '4b sync: a major bump is refused without --major');

  // 5 — forced major sync → Garden still uses the removed name
  const r5 = run([path.join(e4, 'tools', 'shared.mjs'), 'sync', g4, '--major']);
  ok(r5.status === 0, '5a sync: --major goes through');
  const v5 = run([path.join(g4, 'tools', 'shared.mjs'), 'verify', g4]);
  ok(v5.status !== 0 && /MISSING staffStep/.test(v5.stdout), '5b consumer: verify names the missing engine function (staffStep)');

  // 6 — untouched engine against every real consumer
  const r6 = spawnSync('sh', [path.join(PT, 'tools', 'consumers-test.sh')], { encoding: 'utf8' });
  ok(r6.status === 0 && /CONSUMERS PASS/.test(r6.stdout), '6 producer: unchanged engine passes every consumer gate' + (r6.status ? '\n' + r6.stdout.slice(-1500) : ''));
}catch(e){ ok(false, 'harness: ' + e.message); }
finally{ fs.rmSync(tmp, { recursive: true, force: true }); }

console.log(fail ? `\nGOVERNANCE TEST FAIL (${fail})` : '\nGOVERNANCE TEST PASS');
process.exit(fail ? 1 : 0);
