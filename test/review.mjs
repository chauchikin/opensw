// View > Changes (review.js): closed at first; Ctrl+Shift+D opens it with the original on the left,
// the changed blocks tinted (one colour for the AI, one for the user), the LaTeX source read only
// with the parts written again marked, the list of changes (accept / put back), typesetting
// errors in plain words with their block, and the derivation check.  node test/review.mjs
// (needs `npx vite preview --port 4173`)
import { chromium } from 'playwright';
import { standIn, ROOT, inProject } from './lib/desktop.mjs';
const file = ['%2multibyte Version: 5.50.0.2960 CodePage: 950', '\\documentclass{article}', '%TCIDATA{OutputFilter=LATEX.DLL}',
  '\\input{tcilatex}', '\\begin{document}', '', 'First   paragraph,  odd spacing. % a comment', '', 'Second paragraph with $x^{2}$.', '',
  '\\begin{eqnarray*}', 'f(x) &=&(x+1)^{2} \\\\', '&=&x^{2}+2x+1 \\\\', '&=&x^{2}+1', '\\end{eqnarray*}', '',
  '\\[', '\\sqrt{x^{2}}=x', '\\]', '', 'Third paragraph.', '', 'Fourth paragraph \\badmacro{}.', '', '\\end{document}', ''].join('\r\n');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const page = await b.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
// (the document is in a project folder: it is opened and saved as it is)
const FILE = ROOT + '\\Teacher\\R.tex';
await standIn(page, { files: { [FILE]: file, ...inProject(ROOT + '\\Teacher', 'R.tex') } });
await page.addInitScript(() => { window.shell.on.typeset = () => ({ pdf: 'C:\\cache\\R.pdf', errors: ['Undefined control sequence. (l.30 Fourth paragraph \\badmacro)', 'Missing $ inserted. [3 times] (l.9 a_b)', 'The font "Noto Serif CJK TC" is not installed on this computer; the default font is used instead.'] }); });
await page.goto(`http://localhost:${process.env.OPENSW_PORT || 4173}/?lang=en`); await page.waitForTimeout(800);
let fails = 0;
const check = (name, ok, detail) => { if (!ok) fails++; console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : JSON.stringify(detail ?? '').slice(0, 300)); };
const call = (cmd, args) => page.evaluate(([c, a]) => window.sw.call(c, a), [cmd, args]);
const visible = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden && e.offsetParent !== null; }, sel);
const count = (sel) => page.locator(sel).count();

await call('open', { path: FILE });
await page.waitForTimeout(300);
check('closed at first: the screen is as before', !(await visible('#rv-left')) && !(await visible('#rv-tabs')) && (await count('.rv-changed')) === 0);

// a change of the user's own and one by an AI
await page.click('#editor .ProseMirror p:has-text("Third paragraph")'); await page.keyboard.press('End'); await page.keyboard.type(' Mine.');
await call('replaceBlock', { index: 1, latex: 'Second paragraph, changed by AI, with $x^{2}$.' });
check('still nothing shown while closed', (await count('.rv-changed')) === 0);

await page.click('#editor .ProseMirror p:has-text("First")');
await page.keyboard.press('Control+Shift+D');
await page.waitForTimeout(500);
check('Ctrl+Shift+D opens it: original on the left, tabs on the right', (await visible('#rv-left')) && (await visible('#rv-tabs')));
check('the original is the file as opened (read only)', await page.evaluate(() => { const o = document.querySelector('#rv-original .ProseMirror'); return o.textContent.includes('Second paragraph with') && !o.textContent.includes('Mine') && o.contentEditable !== 'true'; }));
check('the user\'s change in one colour, the AI\'s in another', (await count('.ProseMirror .rv-changed.rv-user')) === 1 && (await count('#editor .rv-changed.rv-ai')) === 1,
  [await count('#editor .rv-changed.rv-user'), await count('#editor .rv-changed.rv-ai')]);
check('the left side marks the old blocks', (await count('#rv-original .rv-old')) === 2);

// LaTeX source: read only, the written parts marked, the rest as in the file
await page.click('#rv-tabs button[data-tab="source"]'); await page.waitForTimeout(400);
const src = await page.evaluate(() => ({ text: document.querySelector('#rv-source').textContent, marked: [...document.querySelectorAll('#rv-source mark')].map((m) => m.textContent), editable: document.querySelector('#rv-source').isContentEditable }));
check('source tab: what saving writes, odd spacing and comment kept', /First   paragraph,  odd spacing\. % a comment/.test(src.text) && /changed by AI/.test(src.text), src.text.slice(0, 300));
check('... the parts written again are marked (2)', src.marked.length === 2 && src.marked.some((m) => /Mine/.test(m)), src.marked);
check('... and it cannot be edited', !src.editable && !(await visible('#scroller')));
await page.click('#editor .ProseMirror p:has-text("First")').catch(() => {});
await page.click('#rv-tabs button[data-tab="doc"]');
await page.click('#editor .ProseMirror p:has-text("First")'); await page.keyboard.press('End'); await page.keyboard.type(' More.');
await page.click('#rv-tabs button[data-tab="source"]'); await page.waitForTimeout(400);
check('source follows the document', await page.evaluate(() => /odd spacing\. More\./.test(document.querySelector('#rv-source').textContent)), await page.evaluate(() => [window.swEditor.state.doc.textContent, document.querySelector('#rv-source').textContent.slice(0, 300)]));

// the list: changes, accept and put back
await page.click('#rv-tabs button[data-tab="list"]'); await page.waitForTimeout(400);
check('list: 3 changes', (await count('#rv-list [data-hunk]')) === 3, await count('#rv-list [data-hunk]'));
await page.locator('#rv-list [data-hunk]', { hasText: 'More' }).locator('[data-back]').click(); await page.waitForTimeout(400);
check('Undo change puts the original paragraph back', await page.evaluate(() => !window.swEditor.state.doc.textContent.includes('More.')) && (await count('#rv-list [data-hunk]')) === 2);
await page.locator('#rv-list [data-hunk]', { hasText: 'AI' }).locator('[data-accept]').click(); await page.waitForTimeout(400);
check('Accept keeps it and stops showing it', (await count('#rv-list [data-hunk]')) === 1 && await page.evaluate(() => window.swEditor.state.doc.textContent.includes('changed by AI')));

// typesetting errors in plain words, with their block
await call('typeset'); await page.waitForTimeout(400);
const er = await page.locator('#rv-list .rv-error').allTextContents();
check('typesetting errors in plain words', er.length === 3 && /A command TeX does not know: \\badmacro/.test(er[0]) && /block 6/.test(er[0]) && /outside a formula/.test(er[1]), er);
check('... a repeated one says how often; a font that is not installed is named', /\(3 times; the first place is shown\)/.test(er[1]) && /The font Noto Serif CJK TC is not installed/.test(er[2]), er);

// derivation steps: (x+1)^2 = x^2+2x+1 proved, = x^2+1 not equal with a point, sqrt(x^2) = x not equal
await page.click('#rv-check');
await page.waitForFunction(() => !document.querySelector('#rv-check')?.disabled, null, { timeout: 120000 });
const steps = await page.evaluate(() => [...document.querySelectorAll('#rv-list [data-step]')].map((e) => e.textContent));
const summary = await page.locator('#rv-list .rv-none', { hasText: 'steps checked' }).last().textContent();
check('derivation: 3 steps, 1 proved', /3 steps checked: 1 proved equal/.test(summary), summary);
check('... x^2+2x+1 = x^2+1 is not equal, with the point', steps.some((s) => /Not equal/.test(s) && /x\^\{2\}\+2x\+1/.test(s) && /at x=/.test(s)), steps);
check('... sqrt(x^2) = x is not equal (x < 0)', steps.some((s) => /Not equal/.test(s) && /sqrt/.test(s)), steps);

// saving is not changed by the panel: only edited parts written again
await call('save');
const saved = await page.evaluate((path) => new TextDecoder().decode(new Uint8Array(window.shell.files.get(path))), FILE);
check('saving: the untouched paragraph and comment as in the file', /First   paragraph,  odd spacing\. % a comment\r\n/.test(saved) && /Mine\./.test(saved), saved.slice(0, 400));

await page.keyboard.press('Control+Shift+D'); await page.waitForTimeout(300);
check('Ctrl+Shift+D closes it again: no tints', !(await visible('#rv-left')) && (await count('.rv-changed')) === 0 && (await visible('#scroller')));

// zh-TW
await page.goto(`http://localhost:${process.env.OPENSW_PORT || 4173}/?lang=zh-TW`); await page.waitForTimeout(600);
check('Chinese labels', await page.evaluate(() => document.querySelector('#rv-tabs').textContent.includes('LaTeX 源碼') && document.querySelector('#rv-left').textContent.includes('原檔')));

check('no page errors', errs.length === 0, errs);
await b.close();
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
