// Window menu (B): several documents open, switch, close.  node test/windows.mjs
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const page = await b.newPage({ viewport: { width: 1024, height: 900 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`http://localhost:${process.env.OPENSW_PORT || 4173}/?lang=zh-TW`); await page.waitForTimeout(600);
let fails = 0;
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fails++; };
const menuItems = async () => { await page.click('.menu-top:has-text("視窗")'); const l = await page.$$eval('.menu-list button > span', (s) => s.map((x) => x.textContent)); await page.keyboard.press('Escape'); await page.click('#editor'); return l; };
const text = () => page.evaluate(() => window.swEditor.state.doc.textContent.slice(0, 30));
await page.setInputFiles('#file', 'test/fixtures/tables.tex'); await page.waitForTimeout(1000);
// change it, then open another: the first stays open
await page.click('#editor .ProseMirror > p'); await page.keyboard.press('End'); await page.keyboard.type(' edited');
await page.setInputFiles('#file', 'test/fixtures/notes.tex'); await page.waitForTimeout(1000);
check(!(await page.isVisible('#confirm')), 'opening does not ask: the edited document stays open');
let items = await menuItems();
check(items[0] === '全部關閉' && items.find((x) => x.startsWith('✓')) === '✓ notes' && items.some((x) => /tables \*/.test(x)), 'Window menu as 5.5 (Close All, then the documents): ' + items.join(' | '));
check(/^Text with a footnote/.test(await text()), 'notes on screen');
await page.keyboard.press('Control+F6');
check(/Data/.test(await text()), 'Ctrl+F6 brings tables back');
check(await page.evaluate(() => window.swEditor.state.doc.textContent.includes('edited')), 'with its edit kept');
check(await page.evaluate(() => document.title) === 'tables * - opensw', 'title shows name and changed mark: ' + await page.evaluate(() => document.title));
// close the edited one: asks (save, don't save, stay); then the other one is on screen
await page.keyboard.press('Control+F4');
check(await page.isVisible('#closeask') && await page.isVisible('#closeask-save'), 'closing an edited document asks first, and offers to save it');
await page.click('#closeask-cancel');
check(/Data/.test(await text()), 'Cancel: it stays');
await page.keyboard.press('Control+F4');
await page.click('#closeask-discard');
check(/^Text with a footnote/.test(await text()), 'after closing, the other document is on screen');
items = await menuItems();
const docsIn = (l) => l.filter((x) => !/下一個|全部關閉/.test(x));
check(docsIn(items).length === 1, 'one document left: ' + items.join(' | '));
// the × at the right end of the menu bar closes the document on screen (as in 5.5)
await page.setInputFiles('#file', 'test/fixtures/tables.tex'); await page.waitForTimeout(1000);
check(docsIn(await menuItems()).length === 2, 'two open again');
const box = await page.locator('#doc-close').boundingBox();
check(box && box.x + box.width > 1000, 'the × is at the right end of the menu bar');
await page.click('#doc-close');
check(/^Text with a footnote/.test(await text()) && docsIn(await menuItems()).length === 1, '× closed the one on screen');
// Window > Close All: every changed document is asked about; Cancel keeps them all
await page.setInputFiles('#file', 'test/fixtures/tables.tex'); await page.waitForTimeout(1000);
await page.click('#editor .ProseMirror > p'); await page.keyboard.press('End'); await page.keyboard.type(' edited');
const closeAll = async () => { await page.click('.menu-top:has-text("視窗")'); await page.click('.menu-list button:has-text("全部關閉")'); await page.waitForTimeout(200); };
await closeAll();
check(await page.isVisible('#closeask'), 'Close All asks about the changed one');
await page.click('#closeask-cancel');
check(docsIn(await menuItems()).length === 2, 'Cancel: both still open');
await closeAll();
await page.click('#closeask-discard'); await page.waitForTimeout(200);
items = await menuItems();
check(docsIn(items).length === 1 && await text() === '', 'Close All leaves one empty document: ' + items.join(' | '));

// ---- the same for an AI: documents, switchTo, close ----
const sw = (cmd, args) => page.evaluate(([c, a]) => window.sw.call(c, a), [cmd, args || {}]);
await page.setInputFiles('#file', 'test/fixtures/notes.tex'); await page.waitForTimeout(1000);
await page.setInputFiles('#file', 'test/fixtures/tables.tex'); await page.waitForTimeout(1000);
let r = await sw('documents');
check(r.ok && r.result.length === 2 && r.result[0].doc === 0 && r.result[0].name === 'tables' && r.result[1].name === 'notes' && !r.result[0].changed, 'documents lists them, the one on screen first: ' + JSON.stringify(r.result));
r = await sw('switchTo', { doc: 1 });
check(r.ok && r.result[0].name === 'notes' && /^Text with a footnote/.test(await text()), 'switchTo brings the other one to the screen');
check(!(await sw('switchTo', { doc: 5 })).ok, 'switchTo a number that is not there: an error');
// what the AI changed stays with its document: after switching, "undo AI changes" must not touch the other one
await sw('insert', { latex: 'Added by AI.' });
check(await page.isVisible('#status-ai'), 'the AI edit is shown');
r = await sw('documents');
check(r.result[0].changed === true && r.result[1].changed === false, 'changed is told per document: ' + JSON.stringify(r.result.map((d) => d.changed)));
await sw('switchTo', { doc: 1 });
check(!(await page.isVisible('#status-ai')) && /Data/.test(await text()), 'on the other document there is no AI edit to undo');
// closing: an unchanged one goes at once; a changed one needs discard, and then the user is asked
r = await sw('close', { doc: 1 });
check(!r.ok && /unsaved changes/.test(r.error), 'a changed document is not closed: ' + r.error);
let pending = sw('close', { doc: 1, discard: true });
await page.waitForSelector('#dialog:not([hidden])');
check(/AI/.test(await page.textContent('#dialog-title')), 'discard asks the user');
await page.click('#dialog-cancel');
r = await pending;
check(!r.ok && (await sw('documents')).result.length === 2, 'the user said no: still open');
pending = sw('close', { doc: 1, discard: true });
await page.waitForSelector('#dialog:not([hidden])');
await page.click('#dialog-ok');
r = await pending;
check(r.ok && r.result.length === 1 && r.result[0].name === 'tables' && /Data/.test(await text()), 'the user said yes: closed, the one on screen stays: ' + JSON.stringify(r.result));
r = await sw('close');
check(r.ok && r.result.length === 1 && r.result[0].name === null && await text() === '', 'closing the last one leaves a new empty document');
check(!errs.length, 'no page errors ' + errs);
await b.close();
process.exit(fails ? 1 : 0);
