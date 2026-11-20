// What an AI changed is shown (status bar, tinted blocks) and taken back in one step (aiedits.js);
// Help > Talking to AI and Tools > Connect AI (web: desktop only). Run: node test/ai_edits.mjs
// (needs `npx vite preview --port 4173`)
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const page = await b.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
let fails = 0;
const check = (name, ok, detail) => { if (!ok) fails++; console.log(ok ? 'ok  ' : 'FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 300)); };
const call = (cmd, args) => page.evaluate(([c, a]) => window.sw.call(c, a), [cmd, args]);
const text = () => page.evaluate(() => window.swEditor.state.doc.textContent);
const tinted = () => page.locator('.ProseMirror .ai-changed').count();
const bar = () => page.evaluate(() => { const e = document.querySelector('#status-ai'); return e.hidden ? null : e.textContent; });
const menu = async (top, item) => {
  await page.click(`.menu-top:has-text("${top}")`);
  await page.locator(`.menu-list button:has(> span:text-is("${item}"))`).filter({ visible: true }).first().click();
};

await page.goto(`http://localhost:${process.env.OPENSW_PORT || 4173}/?lang=en`); await page.waitForTimeout(600);
await call('set', { latex: 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.' });
// a person's own edit first, so there is something that is not the AI's
await page.click('.ProseMirror p:last-child'); await page.keyboard.press('End'); await page.keyboard.type(' Mine.');
const mine = await text();
check('the person\'s edit is not an AI edit', (await bar()) === null && (await tinted()) === 0, await bar());

await call('insert', { latex: 'Added by AI with $x^2$.', index: 0 });
check('status bar: AI is editing', /AI is editing/.test(await bar()), await bar());
check('the new block is tinted', (await tinted()) === 1);
await call('replaceBlock', { index: 3, latex: 'Third paragraph, changed.' });
check('both changes are tinted (one range)', (await tinted()) === 3, await tinted());
await page.waitForTimeout(3300);
check('afterwards: AI changed this document', /AI changed this document/.test(await bar()) && /Undo AI changes/.test(await bar()), await bar());

await page.click('#status-ai-undo');
check('Undo AI changes: the document as before the AI, in one step', (await text()) === mine, await text());
check('... and the note and tint are gone', (await bar()) === null && (await tinted()) === 0);
await page.click('.ProseMirror'); await page.keyboard.press('Control+z');
check('Ctrl+Z brings the AI\'s version back', /Added by AI/.test(await text()) && /changed\./.test(await text()), await text());

// the person changes the document: the AI edit is over (undoing it would lose their typing)
await call('insert', { latex: 'Another AI paragraph.' });
check('a new AI edit', (await bar()) !== null && (await tinted()) === 1);
await page.click('.ProseMirror p:first-child'); await page.keyboard.press('Home'); await page.keyboard.type('X');
check('the person types: the AI edit ends', (await bar()) === null && (await tinted()) === 0, await bar());
await menu('Edit', 'Undo AI Changes');
check('Edit > Undo AI Changes with nothing to undo leaves the document', (await text()).startsWith('X'), await text());

// set (the whole document) and undo through the menu; read-only commands start nothing
await call('outline'); await call('get'); await call('formulas');
check('reading the document is not an edit', (await bar()) === null);
const beforeSet = await text();
await call('set', { latex: '\\documentclass{article}\\begin{document}Brand new.\\end{document}' });
check('set: an AI edit', (await bar()) !== null && (await text()) === 'Brand new.');
await menu('Edit', 'Undo AI Changes');
check('Edit > Undo AI Changes after set', (await text()) === beforeSet, await text());

// AI's own undo is part of its edit
await call('insert', { latex: 'Oops.' });
await call('undo');
check('the AI\'s undo stays in its edit, nothing left tinted', (await bar()) !== null && (await tinted()) === 0 && (await text()) === beforeSet);

await menu('Help', 'Talking to AI…');
check('Help > Talking to AI shows examples', (await page.locator('#dialog-body li').count()) >= 6 && /Undo AI Changes/.test(await page.textContent('#dialog-body')));
await page.click('#dialog-cancel');
await menu('Tools', 'Connect AI…');
check('Tools > Connect AI on the web: desktop app only', /desktop app/.test(await page.textContent('#dialog-body')));
await page.click('#dialog-cancel');

// Chinese
await page.goto(`http://localhost:${process.env.OPENSW_PORT || 4173}/?lang=zh-TW`); await page.waitForTimeout(600);
await call('insert', { latex: '新的一段。' });
check('Chinese: AI 正在修改', /AI 正在修改/.test(await bar()) && /復原 AI 的修改/.test(await bar()), await bar());
await menu('說明', '跟 AI 說話…');
check('Chinese: 跟 AI 說話', /用自己的話/.test(await page.textContent('#dialog-body')));
await page.click('#dialog-cancel');

check('no page errors', !errs.length, errs);
await b.close();
process.exit(fails ? 1 : 0);
