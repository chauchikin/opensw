// Compute > Definitions (Undefine, Save / Restore Definitions, Define MuPAD Name), Interpret (Ctrl+?),
// Settings, Solve ODE > Laplace and Series, Transforms > Inverse Fourier, as in 5.5.
// Run: node test/c55_defsmisc.mjs  (needs `npx vite preview --port 4173`, or OPENSW_PORT; SymPy in the page)
import { chromium } from 'playwright';
import fs from 'node:fs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const page = await b.newPage({ acceptDownloads: true, viewport: { width: 1600, height: 1400 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`http://localhost:${process.env.OPENSW_PORT || 4173}/?lang=en`); await page.waitForTimeout(600);
let fails = 0;
const check = (name, ok, detail) => { if (!ok) fails++; console.log(ok ? 'ok  ' : 'FAIL', name, JSON.stringify(detail ?? '').slice(0, 260)); };
const call = (cmd, args) => page.evaluate(([c, a]) => window.sw.call(c, a), [cmd, args]);
const flat = (s) => (s || '').replace(/\s|\\left|\\right/g, '');
const docText = () => page.evaluate(() => JSON.stringify(window.swEditor.state.doc.toJSON()));
const enter = (i) => page.evaluate((k) => document.querySelectorAll('.math-inline')[k]._mathView.enter(false), i);
const menu = async (...items) => {
  await page.click(`.menu-top:has-text("${items[0]}")`);
  for (const it of items.slice(1)) await page.locator(`.menu-list button:has(> span:text-is("${it}"))`).filter({ visible: true }).first().click();
};
const formulas = async () => (await call('formulas')).result.map((f) => f.latex);
const until = (re) => page.waitForFunction((s) => new RegExp(s).test(JSON.stringify(window.swEditor.state.doc.toJSON())), re.source, { timeout: 60000 }).catch(() => {});

// Interpret from the menu and with Ctrl+?
await call('set', { latex: 'A $\\sin x+5$ and $\\left( 1/3\\right) x+4$.' });
await enter(0);
await menu('Compute', 'Interpret');
await until(/5 = /);
let f = await formulas();
check('Compute > Interpret: sin x + 5 as it is read', flat(f[0]).includes('=\\sinx+5'), f[0]);
await enter(1);
await page.keyboard.press('Control+?');
await until(/x\+4 =/);
f = await formulas();
check('Ctrl+? interprets too: (1/3) x + 4', flat(f[1]).replace(/[{}]/g, '').includes('=\\frac13x+4'), f[1]);

// Define (Ctrl+=), Undefine
await call('set', { latex: 'Let $a=7$ and $a+1$ and $a$.' });
await enter(0);
await page.keyboard.press('Control+=');
await page.waitForTimeout(1500);
let r = await call('compute', { latex: 'a+1' });
check('Ctrl+= defines a = 7', r.result?.latex === '8', r);
await enter(2);
await menu('Compute', 'Definitions', 'Undefine');
await page.waitForTimeout(1500);
r = await call('compute', { latex: 'a+1' });
check('Undefine (cursor on the name a): a has no value again', flat(r.result?.latex).replace(/[{}]/g, '') === 'a+1', r);

// Define MuPAD Name: n(x) <-> nextprime(x)
await call('set', { latex: 'Here $n\\left( x\\right) $.' });
await enter(0);
await menu('Compute', 'Definitions', 'Define MuPAD Name...');
check('Define MuPAD Name asks the MuPAD name and the name here', await page.isVisible('#dialog #d-mu') && (await page.inputValue('#d-sw')).includes('n'));
await page.fill('#d-mu', 'nextprime');
await page.click('#dialog-ok');
await page.waitForTimeout(1500);
r = await call('compute', { latex: 'n\\left( 100\\right) ' });
check('... then n(100) = 101', r.result?.latex === '101', r);
await call('compute', { latex: '0', op: 'cleardefs' });

// Settings: Digits Shown 8 for every document, then 5 again
await call('set', { latex: 'Root $\\sqrt{2}$.' });
await enter(0);
await menu('Compute', 'Settings...');
check('Settings has 5.5\'s General page', await page.isVisible('#dialog #d-dig') && await page.isVisible('#dialog #d-ij'));
await page.fill('#d-dig', '8');
await page.click('#dialog-ok');
r = await call('compute', { latex: '\\sqrt{2}', op: 'numeric' });
check('Digits Shown in Results 8: 1.4142136', r.result?.latex === '1.4142136', r);
await enter(0);
await menu('Compute', 'Settings...');
await page.fill('#d-dig', '5');
await page.click('#dialog-ok');
r = await call('compute', { latex: '\\sqrt{2}', op: 'numeric' });
check('... and 5 again: 1.4142', r.result?.latex === '1.4142', r);

// Solve ODE > Laplace and Series; Transforms > Inverse Fourier
await call('set', { latex: 'ODE $\\begin{array}{r}y^{\\prime \\prime }+y=x^{2} \\\\ y(0)=1 \\\\ y^{\\prime }(0)=1\\end{array}$ and $\\begin{array}{r}y^{\\prime }=y^{2}+4 \\\\ y(0)=-2\\end{array}$ and $2\\pi \\operatorname{Dirac}\\left( w\\right) $.' });
await enter(0);
await menu('Compute', 'Solve ODE', 'Laplace');
await until(/Laplace solution is/);
let t = await docText();
check('Solve ODE > Laplace: {x^2 + sin x + 3 cos x - 2}', t.includes('Laplace solution is') && /3 \\\\cos x/.test(t), t.slice(t.indexOf('Laplace'), t.indexOf('Laplace') + 200));
await enter((await formulas()).findIndex((x) => /y\^\{?2\}?\+4/.test(x.replace(/\s/g, ''))));
await menu('Compute', 'Solve ODE', 'Series');
check('Series asks the independent variable (y\' = y^2 + 4 does not say it)', await page.isVisible('#dialog #d-v'));
await page.fill('#d-v', 't');
await page.click('#dialog-ok');
await until(/Series solution is/);
t = await docText();
check('... and gives the series in t, to the series order (6)', /8t/.test(t) && /O\\\\left\(t\^\{6\}/.test(t), t.slice(t.indexOf('Series solution'), t.indexOf('Series solution') + 260));
f = await formulas();
await enter(f.length - 1);
await menu('Compute', 'Transforms', 'Inverse Fourier');
await until(/Is Fourier transform of/);
t = await docText();
check('Inverse Fourier: 2 pi Dirac(w), Is Fourier transform of 1', /Is Fourier transform of/.test(t), '');

// a 5.x document's saved definitions and settings: restored on opening (Always Restore)
await page.setInputFiles('#file', 'test/fixtures/defs55.tex');
await page.waitForTimeout(4000);
r = await call('compute', { latex: 'x_{0}+1' });
check('opening it restores x_0 = 3 (ComputeDefs)', r.result?.latex === '4', r);
r = await call('compute', { latex: 'f\\left( 2\\right) ' });
check('... and f(x) = x^2 + 1', r.result?.latex === '5', r);
r = await call('compute', { latex: 'n\\left( 100\\right) ' });
check('... and n(x) <-> nextprime(x) (MuPadMappings)', r.result?.latex === '101', r);
r = await call('compute', { latex: '\\sqrt{2}', op: 'numeric' });
check('... its Digits Shown 8 (ComputeGeneralSettings)', r.result?.latex === '1.4142136', r);
// a new definition, saved with it: the file keeps it in ComputeDefs
await call('compute', { latex: 'y_{1}=-3', op: 'define' });
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }).catch(() => null), menu('File', 'Save')]);
const saved = dl ? fs.readFileSync(await dl.path(), 'latin1') : '';
const defs = (saved.match(/%TCIDATA\{ComputeDefs=[^]*?%\}/) || [''])[0];
check('saving writes the definitions in force into ComputeDefs (Always Save)', defs.includes('%$y_{1}=-3$') && defs.includes('%$x_{0}=3$'), defs);
check('... and the mapping into MuPadMappings', /%TCIDATA\{MuPadMappings=\r?\n%\$n\\left\( x\\right\) \\leftrightarrow\$ nextprime\(x\)/.test(saved), (saved.match(/%TCIDATA\{MuPadMappings=[^]*?%\}/) || [''])[0]);
check('... and keeps its ComputeGeneralSettings', saved.includes('%TCIDATA{ComputeGeneralSettings=1,8,5,0,0,0,1}'), '');
await call('compute', { latex: '0', op: 'cleardefs' });
await enter(0);
await menu('Compute', 'Definitions', 'Restore Definitions');
await page.waitForTimeout(2500);
r = await call('compute', { latex: 'y_{1}+x_{0}' });
check('Definitions > Restore Definitions: back from the document', r.result?.latex === '0', r);

check('no page errors', !errs.length, errs);
await b.close();
process.exit(fails ? 1 : 0);
