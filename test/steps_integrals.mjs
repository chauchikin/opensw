// Integral step regressions through the real browser parser, engine and Changes panel.
import { chromium } from 'playwright';
import { standIn } from './lib/desktop.mjs';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const page = await browser.newPage();
let fails = 0;
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.route('**/*', route => /^(http:\/\/localhost:|data:|blob:)/.test(route.request().url()) ? route.continue() : route.abort());
await standIn(page, { settings: { startup: 'blank' } });
await page.goto(`http://localhost:${process.env.OPENSW_PORT || 4173}/?lang=en`);
await page.waitForFunction(() => !!window.sw);
const call = async (cmd, args) => {
  const r = await page.evaluate(([c,a]) => window.sw.call(c,a), [cmd,args]);
  if (!r.ok) throw new Error(`${cmd}: ${r.error}`);
  return r.result;
};
const check = (name, ok, r) => { if (!ok) fails++; console.log(ok ? 'ok  ' : 'FAIL', name, JSON.stringify(r)); };
const cases = [
  ['exact polynomial', String.raw`\int 2x\,dx=x^2`, 'pass'],
  ['exact half polynomial', String.raw`\int x\,dx=\frac{x^2}{2}`, 'pass'],
  ['exact trig', String.raw`\int 2\sin x\cos x\,dx=\sin^2 x`, 'pass'],
  ['exact trig alternate form', String.raw`\int 2\sin x\cos x\,dx=1-\cos^2 x`, 'pass'],
  ['constant one', String.raw`\int 2x\,dx=x^2+1`, 'unknown'],
  ['constant', String.raw`\int x\,dx=\frac{x^2}{2}+7`, 'unknown'],
  ['constant, with the integral sign as 5.x writes it in display style', String.raw`\dint x\,dx=\frac{x^2}{2}+7`, 'unknown'],
  ['exact, with 5.x\'s text-style integral sign', String.raw`\tint 2x\,dx=x^2`, 'pass'],
  ['trig constant', String.raw`\int 2\sin x\cos x\,dx=-\cos^2 x`, 'unknown'],
  ['SymPy unresolved', String.raw`\int\sqrt{1+\sin x}\,dx=\frac{-2\cos x}{\sqrt{1+\sin x}}`, 'unknown'],
  ['wrong shifted square root', String.raw`\int\sqrt{x^2+20x+100}\,dx=\frac{x^2}{2}+10x`, ['unknown','fail']],
  ['wrong derivative', String.raw`\int x\,dx=x^2`, 'fail'],
  ['P30 positive', String.raw`\int\sqrt{x^2+2x+1}\,dx=\frac{x^2}{2}+x+1`, ['pass','unknown'], true],
  ['P29b nested', String.raw`\int\left(\int 1\,dx\right)\,dx=\frac{x^2}{2}+3x+5`, 'unknown'],
  ['different integration variables', String.raw`\int x\,dx=\int y\,dy`, 'unknown'],
  ['complex variable square root', String.raw`\int\sqrt{x^4}\,dx=\frac{x^3}{3}`, ['unknown','fail']],
  ['mixed finite', String.raw`\int x\,dx+\int_0^1 t\,dt=\frac{x^2}{2}+\frac{1}{2}+7`, 'unknown'],
  ['mixed finite exact', String.raw`\int x\,dx+\int_0^1 t\,dt=\frac{x^2}{2}+\frac{1}{2}`, 'pass'],
  ['mixed divergent', String.raw`\int x\,dx+\int_{-1}^1\frac{1}{t^2}\,dt=\frac{x^2}{2}-2`, 'unknown'],
  ['definite', String.raw`\int_0^1 x\,dx=\frac{1}{2}`, 'pass'],
  ['definite wrong', String.raw`\int_0^1 x\,dx=2`, 'fail'],
  ['Big O', String.raw`e^x=1+x+O(x^2)`, 'pass'],
];
try {
  for (const [name, latex, expected, positive] of cases) {
    if (positive) {
      // checkSteps deliberately sets the user's definitions AND assumptions aside. Exercise
      // P30 through the browser's direct stepcheck with the assumption actually in force.
      const assumed = await call('compute', { op:'evaluate', latex:'\\operatorname{assume}(x,\\mathrm{positive})' });
      console.log('ASSUMPTION', JSON.stringify(assumed));
      const r = await call('compute', { op:'stepcheck', latex:String.raw`\int\sqrt{x^2+2x+1}\,dx`, params:[String.raw`\frac{x^2}{2}+x+1`] });
      check(name, r.kind==='step' && r.result!=='notequal', r);
      await call('compute', { op:'evaluate', latex:'\\operatorname{unassume}(x)' });
      continue;
    }
    await call('set', { latex:`\\[${latex}\\]` });
    await call('nameSteps');
    const r = await call('checkSteps');
    check(name, [expected].flat().includes(r.steps[0]?.status), r);
    const full = await call('steps', { name:r.steps[0].name });
    console.log('DETAIL', name, JSON.stringify(full.result));
  }
  check('no page errors', errors.length===0, errors);
} finally { await browser.close(); }
console.log(`${fails} failed of ${cases.length + 1}`);
process.exit(fails ? 1 : 0);
