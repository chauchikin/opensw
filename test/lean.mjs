// Compute > Check with Lean: equations become Lean 4 theorems; Lean proves the true ones
// and not the false ones. The Lean part runs when Lean with Mathlib is installed
// (LEAN_PROJECT, default ~/ckproof). Run: node test/lean.mjs
import { ComputeEngine } from '@cortex-js/compute-engine';
import { execFileSync } from 'child_process';
import { existsSync, writeFileSync, mkdtempSync } from 'fs';
import { tmpdir, homedir } from 'os';
import { join } from 'path';
import { chromium } from 'playwright';
import { leanTheorem, leanVerdict } from '../src/lean.js';

let fails = 0;
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fails++; };
const ce = new ComputeEngine();
const theorem = (s) => leanTheorem(ce.parse(s, { canonical: false }).json, s);

const TRUE = ['\\frac{1}{2}+\\frac{1}{3}=\\frac{5}{6}', '(x+y)^2=x^2+2xy+y^2', '2^{10}=1024', '\\frac{1}{x}+\\frac{1}{y}=\\frac{x+y}{xy}',
  '0.5+0.25=0.75', 'x-y=-(y-x)', '1+1=2=\\frac{4}{2}', '\\frac{x^2-1}{x-1}=x+1', 'x^{-2}=\\frac{1}{x^2}'];
const FALSE = ['\\frac{1}{2}+\\frac{1}{3}=\\frac{2}{5}', '(x+y)^2=x^2+y^2'];

// the statements say what was written: real numbers, and a hypothesis for each variable denominator factor
check(theorem('\\frac{1}{x}+\\frac{1}{y}=\\frac{x+y}{xy}').statement ===
  'theorem opensw_check (x y : ℝ) (h1 : x ≠ 0) (h2 : y ≠ 0) : (((1 / x) + (1 / y)) : ℝ) = ((x + y) / (x * y))', 'statement with hypotheses');
check(theorem('2^{10}=1024').statement === 'theorem opensw_check : ((2 ^ 10) : ℝ) = 1024', 'numbers are real numbers');
check(/∧/.test(theorem('1+1=2=\\frac{4}{2}').statement), 'a = b = c checks both');
for (const s of ['\\sin x=x', 'x>1', 'x^{1/2}=1']) {
  let err = null;
  try { theorem(s); } catch (e) { err = e.message; }
  check(!!err, `not supported, said so: ${s} (${err})`);
}
check(leanVerdict("'opensw_check' depends on axioms: [propext, Classical.choice, Quot.sound]", true).ok, 'verdict: standard axioms pass');
check(!leanVerdict("'opensw_check' depends on axioms: [propext, sorryAx, Classical.choice, Quot.sound]", true).ok, 'verdict: sorry fails');

// Lean itself
const project = process.env.LEAN_PROJECT || join(homedir(), 'ckproof');
const lake = join(homedir(), '.elan', 'bin', 'lake');
if (existsSync(lake) && existsSync(project)) {
  const dir = mkdtempSync(join(tmpdir(), 'opensw-lean-'));
  const run = (s, i) => {
    const f = join(dir, `t${i}.lean`);
    writeFileSync(f, theorem(s).code);
    try { return leanVerdict(execFileSync(lake, ['env', 'lean', f], { cwd: project, encoding: 'utf8' }), true); }
    catch (e) { return leanVerdict((e.stdout || '') + (e.stderr || ''), false); }
  };
  TRUE.forEach((s, i) => check(run(s, i).ok, `Lean proves ${s}`));
  FALSE.forEach((s, i) => check(!run(s, 100 + i).ok, `Lean does not prove ${s}`));
} else console.log('skip Lean runs (no Lean project at', project + ')');

// the menu in the web version: shows the statement, says Lean needs the desktop app
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const page = await b.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:4173/?lang=zh-TW'); await page.waitForTimeout(600);
await page.evaluate(() => window.sw.call('set', { latex: 'So $\\frac{1}{2}+\\frac{1}{3}=\\frac{5}{6}$.' }));
await page.evaluate(() => document.querySelectorAll('.math-inline')[0]._mathView.enter(false));
await page.click('.menu-top:has-text("計算")');
await page.click('.menu-list button:has(> span:text-is("用 Lean 檢查"))');
await page.waitForSelector('.lean-code', { timeout: 15000 });
const shown = await page.textContent('.lean-code');
check(shown.includes('((1 / 2) + (1 / 3)) : ℝ) = (5 / 6)'), 'menu shows the Lean statement: ' + shown);
check(!errs.length, 'no page errors ' + errs.join('; '));
await b.close();
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
