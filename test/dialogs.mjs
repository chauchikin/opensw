// One dialog at a time (src/dialogs.js): a question that comes while another dialog is on screen
// waits its turn, so no dialog is replaced and every question is answered. An AI's request to
// open a file while the import dialog is up; while Tools > User Setup is open; two requests at
// once; a question whose dialog is closed some other way; a document's own question when it is
// opened (its saved definitions) and the import's dialog. With the stand-in for the desktop
// shell (test/lib/desktop.mjs). Run: node test/dialogs.mjs  (needs `npx vite preview --port 4173`)
import { chromium } from 'playwright';
import { standIn } from './lib/desktop.mjs';

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const page = await b.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
let fails = 0;
const check = (name, ok, detail) => { if (!ok) fails++; console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : JSON.stringify(detail ?? '').slice(0, 600)); };
const tex = '\\documentclass{article}\n%TCIDATA{Version=5.50.0.2960}\n\\input{tcilatex}\n\\begin{document}\nHello.\n\\end{document}\n';
await standIn(page, { files: { 'D:\\Papers\\paper.tex': tex, 'E:\\Far\\one.tex': tex, 'E:\\Far\\two.tex': tex, 'E:\\Far\\three.tex': tex, 'E:\\Far\\four.tex': tex } });
await page.goto(`http://localhost:${process.env.OPENSW_PORT || 4173}/?lang=en`); await page.waitForTimeout(800);
// an AI's command, not waited for: its answer is kept in the page until asked for
const send = (key, cmd, args) => page.evaluate(([k, c, a]) => { window.answers = window.answers || {}; window.sw.call(c, a).then((r) => { window.answers[k] = r; }); }, [key, cmd, args]);
const answerOf = async (key) => { await page.waitForFunction((k) => window.answers?.[k], key); return page.evaluate((k) => window.answers[k], key); };
const title = () => page.textContent('#dialog-title');
const shown = (text) => page.waitForFunction((t) => !document.querySelector('#dialog').hidden && document.querySelector('#dialog').textContent.includes(t), text);
const menu = async (top, item) => {
  await page.click(`.menu-top:has-text("${top}")`);
  await page.locator(`.menu-list button:has(> span:text-is("${item}"))`).filter({ visible: true }).first().click();
};

// 1. the import dialog is up; an AI asks to open a file outside the allowed folders
await page.evaluate(() => { window.shell.open = 'D:\\Papers\\paper.tex'; });
await menu('File', 'Open...');
await shown('A copy was made in');
await send('one', 'open', { path: 'E:\\Far\\one.tex' });
await page.waitForTimeout(500);
check('an AI\'s question arriving meanwhile does not take the import dialog\'s place', (await title()) === 'A copy was made' && (await page.locator('#dialog-body button:text-is("Show folder")').count()) === 1 && !(await page.evaluate(() => window.answers?.one)));
await page.locator('#dialog-body button:text-is("OK")').click();
await shown('E:\\Far\\one.tex');
check('once the import dialog is answered the AI\'s question is shown, with its own buttons', (await title()) === 'AI wants to open this file' && await page.isVisible('#dialog-ok') && await page.isVisible('#dialog-cancel'));
await page.click('#dialog-ok');
let r = await answerOf('one');
check('... and its answer reaches the AI: the file is opened (imported)', r.ok && r.result.imported?.from === 'E:\\Far\\one.tex' && await page.isHidden('#dialog'), r);

// (the case that once left every later dialog without its buttons: the question is taken away
// unanswered, and then a dialog the user opens must have OK and Cancel)
await page.evaluate(() => { window.shell.files.set('D:\\Papers\\x.tex', window.shell.files.get('D:\\Papers\\paper.tex')); window.shell.open = 'D:\\Papers\\x.tex'; });
await menu('File', 'Open...');
await shown('A copy was made in');
await send('lost', 'open', { path: 'E:\\Far\\two.tex' });
await page.waitForTimeout(500);
check('again an AI\'s question while the import dialog is up: the dialog on screen is whole', (await title()) === 'A copy was made' && (await page.locator('#dialog-body button').count()) === 2 && !(await page.isVisible('#dialog-ok')));
await page.locator('#dialog-body button:text-is("OK")').click();
await shown('E:\\Far\\two.tex');
await page.evaluate(() => { document.querySelector('#dialog-cancel').click(); });
r = await answerOf('lost');
await menu('Tools', 'User Setup...');
check('... and after the question went (answered no), a dialog the user opens has OK and Cancel', !r.ok && (await title()) === 'User setup (this computer)' && await page.isVisible('#dialog-ok') && await page.isVisible('#dialog-cancel'), r);
await page.click('#dialog-cancel');

// 2. Tools > User Setup is open (an ordinary dialog): the AI's question waits until it is closed
await menu('Tools', 'User Setup...');
await send('two', 'open', { path: 'E:\\Far\\two.tex' });
await page.waitForTimeout(500);
check('a dialog the user opened stays, the question waits', (await title()) === 'User setup (this computer)' && (await page.locator('#d-aifolders').count()) === 1);
await page.click('#dialog-cancel');
await shown('E:\\Far\\two.tex');
await page.click('#dialog-cancel');
r = await answerOf('two');
check('then the question comes; Cancel: the AI is told no', !r.ok && /did not allow opening E:\\Far\\two\.tex/.test(r.error), r);

// 3. two questions at once are asked one after the other, in the order they came
await send('three', 'open', { path: 'E:\\Far\\three.tex' });
await send('four', 'open', { path: 'E:\\Far\\four.tex' });
await shown('E:\\Far\\three.tex');
await page.waitForTimeout(300);
check('the first of two questions is on screen, the second waits', !(await page.textContent('#dialog')).includes('four.tex'));
await page.click('#dialog-cancel');
await shown('E:\\Far\\four.tex');
await page.click('#dialog-ok');
const [three, four] = [await answerOf('three'), await answerOf('four')];
check('each gets its own answer', !three.ok && /three\.tex/.test(three.error) && four.ok && four.result.imported?.from === 'E:\\Far\\four.tex', [three, four]);

// 4. a question whose dialog is closed some other way is answered too (as not allowed)
await page.evaluate(() => { delete window.answers.two; });
await send('two', 'open', { path: 'E:\\Far\\two.tex' });
await shown('E:\\Far\\two.tex');
await page.evaluate(() => { document.querySelector('#dialog').hidden = true; });
r = await answerOf('two');
check('a dialog closed without an answer: the question is answered no, nothing waits for ever', !r.ok && /did not allow/.test(r.error), r);
// ... and the same for a question with buttons of its own: the next dialog has the usual buttons again
await page.evaluate(() => { window.shell.files.set('D:\\Papers\\again.tex', window.shell.files.get('D:\\Papers\\paper.tex')); window.shell.open = 'D:\\Papers\\again.tex'; });
await menu('File', 'Open...');
await shown('A copy was made in');
await page.evaluate(() => { document.querySelector('#dialog').hidden = true; });
await page.waitForTimeout(300);
await menu('Tools', 'User Setup...');
check('after a question with its own buttons was closed that way, the usual buttons are back', await page.isVisible('#dialog-ok') && await page.isVisible('#dialog-cancel') && (await title()) === 'User setup (this computer)');
await page.click('#dialog-cancel');
// the editor is not stuck: a document opened next gets a window of its own as usual
r = await page.evaluate(() => window.sw.call('documents'));
check('the documents opened are all there', r.ok && r.result.some((d) => /again\.tex$/.test(d.path || '')) && r.result.some((d) => /four\.tex$/.test(d.path || '')), r);

// 5. a document that asks about its saved definitions when it opens (Definition Options) is imported:
// that question and the import's dialog come one after the other
const page2 = await b.newPage();
page2.on('pageerror', (e) => errs.push(e.message));
await standIn(page2, { files: { 'D:\\Papers\\defs.tex': tex.replace('\\input{tcilatex}', '%TCIDATA{ComputeDefs=\n%$x_{0}=3$\n%}\n\\input{tcilatex}') }, settings: { compute55: { defs_open: 'ask' } } });
await page2.goto(`http://localhost:${process.env.OPENSW_PORT || 4173}/?lang=en`); await page2.waitForTimeout(800);
await page2.evaluate(() => { window.shell.open = 'D:\\Papers\\defs.tex'; });
await page2.click('.menu-top:has-text("File")');
await page2.locator('.menu-list button:has(> span:text-is("Open..."))').filter({ visible: true }).first().click();
await page2.waitForSelector('#dialog:not([hidden])');
await page2.waitForTimeout(500);
const firstTitle = await page2.textContent('#dialog-title');
await page2.click('#dialog-cancel');
await page2.waitForFunction(() => !document.querySelector('#dialog').hidden && document.querySelector('#dialog-title').textContent === 'A copy was made');
check('the definitions question first (it is not replaced), then the import\'s dialog', firstTitle === 'Restore Definitions' && (await page2.locator('#dialog-body button:text-is("Show folder")').count()) === 1, firstTitle);
await page2.locator('#dialog-body button:text-is("OK")').click();
check('both answered: no dialog is left', await page2.isHidden('#dialog'));
await page2.close();

check('no page errors', errs.length === 0, errs);
await b.close();
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
