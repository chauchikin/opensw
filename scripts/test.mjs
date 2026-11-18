// Runs every test in test/*.mjs one after another (they need `npx vite build` first).
// Usage: node scripts/test.mjs [name ...]   e.g. node scripts/test.mjs smoke tables
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const only = process.argv.slice(2);
const files = readdirSync('test').filter((f) => f.endsWith('.mjs'))
  .filter((f) => !only.length || only.includes(f.replace(/\.mjs$/, '')));
const failed = [];
for (const f of files) {
  const t = Date.now();
  const r = spawnSync(process.execPath, [`test/${f}`], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 600000 });
  const ok = r.status === 0;
  if (!ok) failed.push(f);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${f} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
  if (!ok) console.log(String(r.stdout).slice(-1500) + String(r.stderr).slice(-1500));
}
console.log(failed.length ? `${failed.length} failed: ${failed.join(' ')}` : `all ${files.length} passed`);
process.exit(failed.length ? 1 : 0);
