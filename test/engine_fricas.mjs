// FriCAS for the indefinite integrals Giac does not find, asked before SymPy when Python runs the
// SymPy engine on the computer (engine/opensw_fricas.py): test/engine_fricas.py, run by a Python that
// has SymPy (OPENSW_PYTHON, else python3 or python), with FriCAS and with OPENSW_FRICAS=0.
// FriCAS is the one in engine/fricas, or where OPENSW_FRICAS_DIR says. Skipped, and saying so,
// where there is no such Python; the FriCAS part is skipped where there is no FriCAS.
// Run: node test/engine_fricas.mjs
import { spawnSync } from 'node:child_process';

const python = [process.env.OPENSW_PYTHON, 'python3', 'python'].filter(Boolean)
  .find((p) => spawnSync(p, ['-c', 'import sympy'], { stdio: 'ignore' }).status === 0);
if (!python) {
  console.log('skipped: no Python with SymPy (set OPENSW_PYTHON to one)');
  process.exit(0);
}
let failed = false;
for (const fricas of ['1', '0']) {
  const r = spawnSync(python, ['-B', 'test/engine_fricas.py'], { env: { ...process.env, OPENSW_FRICAS: fricas }, encoding: 'utf8', timeout: 300000 });
  console.log(`OPENSW_FRICAS=${fricas} (${python})\n${r.stdout}${r.stderr}`);
  failed ||= r.status !== 0;
}
process.exit(failed ? 1 : 0);
