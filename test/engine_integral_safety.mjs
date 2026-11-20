// Include the integral regressions in scripts/test.mjs discovery, like engine_giac/fricas.
import { spawnSync } from 'node:child_process';
const env = { ...process.env, PYTHONDONTWRITEBYTECODE:'1', PYTHONIOENCODING:'utf-8' };
const python = [process.env.OPENSW_PYTHON, 'python3', 'python'].filter(Boolean)
  .find(p => spawnSync(p, ['-B','-c','import sympy'], { env, stdio:'ignore' }).status===0);
if (!python) {
  console.log('skipped: no Python with SymPy (set OPENSW_PYTHON to one)');
  process.exit(0);
}
let failed = false;
for (const off of [false,true]) {
  const r = spawnSync(python, ['-B','test/engine_integral_safety.py'], {
    env: off ? { ...env, OPENSW_GIAC:'0', OPENSW_FRICAS:'0' } : env,
    encoding:'utf8', timeout:300000,
  });
  console.log(`integral safety: backends ${off ? 'off' : 'as installed'} (${python})\n${r.stdout}${r.stderr}`);
  failed ||= r.status!==0;
}
process.exit(failed ? 1 : 0);
