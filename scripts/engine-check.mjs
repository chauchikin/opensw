// The acceptance test of a computation engine: the cases of test/fixtures/engine/cases.json
// (made by scripts/engine-cases.mjs) sent to the engine the way the desktop app sends them
// (engine/engines.json, the line protocol of ENGINE.md), each answer checked.
//   node scripts/engine-check.mjs sympy                 SymPy, by Python (engine/opensw_stdio.py)
//   node scripts/engine-check.mjs mathematica [program] Mathematica (program: its wolfram.exe;
//                                                       none: found as the desktop app finds it)
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';

const MARK = '@@OPENSW@@';
const dir = path.resolve('engine');
const SYMPY = { id: 'sympy', name: 'SymPy (Python)', program: ['python', 'python3'], args: ['{adapter}'], adapter: 'opensw_stdio.py', load: '', call: '{op} {data}' };
const [id = 'sympy', chosen] = process.argv.slice(2);
const spec = id === 'sympy' ? SYMPY : JSON.parse(fs.readFileSync(path.join(dir, 'engines.json'), 'utf8')).engines.find((e) => e.id === id);
if (!spec) throw new Error(`no engine ${id} in engine/engines.json`);

// the files a pattern names ("*": any folder); the newest version (the numbers in the path) wins
function expand(pattern) {
  const parts = pattern.split(/[\\/]/);
  let paths = [parts[0] + path.sep];
  parts.slice(1).forEach((part, i) => {
    const last = i === parts.length - 2;
    paths = part === '*'
      ? paths.flatMap((p) => { try { return fs.readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(p, d.name)); } catch { return []; } })
      : paths.map((p) => path.join(p, part)).filter((p) => fs.existsSync(p) && fs.statSync(p).isFile() === last);
  });
  return paths;
}
const version = (p) => (p.match(/\d+/g) || []).map(Number);
const newer = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? -1) !== (b[i] ?? -1)) return (a[i] ?? -1) > (b[i] ?? -1); return false; };
function programs() {
  if (chosen) return [chosen];
  let best = null;
  for (const p of spec.program.filter((p) => /[\\/]/.test(p)).flatMap(expand)) if (!best || newer(version(p), version(best))) best = p;
  return best ? [best] : spec.program.filter((p) => !/[\\/]/.test(p));
}

const adapter = path.join(dir, spec.adapter);
const withAdapter = (t) => t.replaceAll('{adapter64}', Buffer.from(adapter).toString('base64')).replaceAll('{adapter}', adapter);

async function start() {
  for (const program of programs()) {
    const child = spawn(program, spec.args.map(withAdapter), { stdio: ['pipe', 'pipe', 'ignore'] });
    const failed = await new Promise((resolve) => { child.once('spawn', () => resolve(false)); child.once('error', () => resolve(true)); });
    if (failed) continue;
    const lines = readline.createInterface({ input: child.stdout })[Symbol.asyncIterator]();
    const answer = async () => {
      for (;;) {
        const { value, done } = await lines.next();
        if (done) throw new Error(`${spec.name} stopped`);
        const i = value.indexOf(MARK);
        if (i >= 0) return value.slice(i + MARK.length).replace(/[\s"]+$/, '');
      }
    };
    const send = (line) => { child.stdin.write(line + '\n'); return answer(); };
    const ready = spec.load ? await send(withAdapter(spec.load)) : await answer();
    if (ready !== 'ready') throw new Error(`${spec.name} did not load ${spec.adapter}: ${ready}`);
    console.log(`${spec.name}: ${program}`);
    return { child, send };
  }
  throw new Error(`${spec.name} not found (${programs().join(', ')})`);
}

const engine = await start();
const compute = async (op, json) => {
  const line = spec.call.replaceAll('{op}', op).replaceAll('{data}', Buffer.from(json).toString('base64'));
  return JSON.parse(Buffer.from(await engine.send(line), 'base64').toString('utf8'));
};

// expect (or by[engine id]): the answer's LaTeX contains it (a list: one of them), true/false
// for check, "error:<text>" an error with that text, "fallback", or null: any answer.
// LaTeX is compared with the forms engines write differently made alike: no spaces, \left,
// \right or \, ; matrices as pmatrix; x^{2} as x^2
const alike = (s) => s.replace(/\\left|\\right|\\,|\s/g, '').replace(/\(\\begin\{matrix\}/g, '\\begin{pmatrix}')
  .replace(/\\end\{matrix\}\)/g, '\\end{pmatrix}').replace(/([\^_])\{(\w)\}/g, '$1$2');
const cases = JSON.parse(fs.readFileSync('test/fixtures/engine/cases.json', 'utf8'));
let fails = 0;
for (const c of cases) {
  const t = Date.now();
  const r = await compute(c.op, c.json);
  const latex = alike(r.latex ?? (r.solutions || []).join(';'));
  const expect = c.by?.[id] ?? c.expect;
  const ok = expect === 'fallback' ? r.fallback === true
    : typeof expect === 'string' && expect.startsWith('error:') ? (r.error || '').includes(expect.slice(6))
      : typeof expect === 'boolean' ? r.value === expect
        : expect === null ? !r.error
          : !r.error && [expect].flat().some((e) => latex.includes(alike(e)));
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${c.op} ${c.latex} -> ${JSON.stringify(r).slice(0, 160)} (${Date.now() - t}ms)`);
}
engine.child.kill();
console.log(`${fails} failed of ${cases.length}`);
process.exit(fails ? 1 : 0);
