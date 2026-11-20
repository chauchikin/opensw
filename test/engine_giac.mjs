// Giac as a first try of the SymPy engine when Python runs it on the computer
// (engine/opensw_giac.py): test/engine_giac.py, run by a Python that has SymPy (OPENSW_PYTHON,
// else python3 or python), with Giac and with OPENSW_GIAC=0. Skipped, and saying so, where
// there is no such Python; the Giac part is skipped where that Python has no giacpy.
// FriCAS, asked between Giac and SymPy, is off here (OPENSW_FRICAS=0): this compares Giac's
// answers with SymPy's; test/engine_fricas.mjs has FriCAS.
// Run: node test/engine_giac.mjs
import { spawnSync } from 'node:child_process';

const python = [process.env.OPENSW_PYTHON, 'python3', 'python'].filter(Boolean)
  .find((p) => spawnSync(p, ['-c', 'import sympy'], { stdio: 'ignore' }).status === 0);
if (!python) {
  console.log('skipped: no Python with SymPy (set OPENSW_PYTHON to one)');
  process.exit(0);
}
let failed = false;
for (const giac of ['1', '0']) {
  const r = spawnSync(python, ['-B', 'test/engine_giac.py'], { env: { ...process.env, OPENSW_GIAC: giac, OPENSW_FRICAS: '0' }, encoding: 'utf8', timeout: 300000 });
  console.log(`OPENSW_GIAC=${giac} (${python})\n${r.stdout}${r.stderr}`);
  failed ||= r.status !== 0;
}
process.exit(failed ? 1 : 0);
