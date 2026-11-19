// The engine interface: ENGINE.md's table of operations is up to date with the engines, and
// SymPy passes the acceptance cases through the line protocol (when Python has SymPy).
// Run: node test/engine_doc.mjs
import { spawnSync } from 'node:child_process';

let fails = 0;
const run = (name, args) => {
  const r = spawnSync(process.execPath, args, { encoding: 'utf8' });
  if (r.status !== 0) fails++;
  console.log(r.status === 0 ? 'ok  ' : 'FAIL', name, (r.stdout + r.stderr).trim().split('\n').at(-1));
};
run('ENGINE.md lists every operation', ['scripts/engine-doc.mjs', '--check']);
const python = ['python3', 'python'].find((p) => spawnSync(p, ['-c', 'import sympy']).status === 0);
if (python) run('SymPy passes the engine cases', ['scripts/engine-check.mjs', 'sympy']);
else console.log('skipped: SymPy by Python (no Python with SymPy here)');
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
