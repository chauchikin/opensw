// 5.5's menus besides Compute (File, Edit, Insert, View, Go, Tag, Typeset, Tools, Window, Help):
// the items added from sw550ENUS.dll's menus 10, 23 and 24 (src/menus55.js).  node test/c55_othermenus.mjs
// (needs `npx vite build` and `npx vite preview --port 4173`, or OPENSW_PORT)
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const ctx = await b.newContext({ viewport: { width: 1100, height: 900 }, acceptDownloads: true });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`http://localhost:${process.env.OPENSW_PORT || 4173}/?lang=en`); await page.waitForTimeout(700);
let fails = 0;
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fails++; };
const menu = async (top, ...items) => {
  await page.click(`.menu-top:has-text("${top}")`);
  for (const it of items) await page.locator(`.menu-list button:has(> span:text-is("${it}"))`).filter({ visible: true }).first().click();
};
const call = (cmd, args) => page.evaluate(([c, a]) => window.sw.call(c, a), [cmd, args]);
const nodes = (type) => page.evaluate((t) => { const out = []; window.swEditor.state.doc.descendants((n) => { if (n.type.name === t) out.push(n.toJSON()); }); return out; }, type);
const tex55 = () => page.evaluate(() => new TextDecoder().decode(new Uint8Array(window.swTex55ForTests())));
const toEnd = () => page.evaluate(() => { const v = window.swEditor; v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.atEnd(v.state.doc))); v.focus(); });
const inFormula = async () => { await page.evaluate(() => { const m = document.querySelector('.math-inline'); m._mathView.enter(false); }); await page.waitForTimeout(150); };
const latexOf = () => page.evaluate(() => document.querySelector('.math-inline')._mathView.mf.getValue('latex'));

// every top menu, in 5.5's order (Compute and Typeset where 5.5 puts them)
const tops = await page.$$eval('.menu-top', (l) => l.map((e) => e.textContent.trim()));
check(tops.slice(0, 10).join(',') === 'File,Edit,Insert,View,Go,Tag,Compute,Typeset,Tools,Window', 'top menus in 5.5\'s order: ' + tops.join(','));
const items = async (top) => { await page.click(`.menu-top:has-text("${top}")`); const l = await page.$$eval('#popup > .menu-list > button > span', (s) => s.map((x) => x.textContent.trim())); await page.keyboard.press('Escape'); return l; };
const file = await items('File');
check(file.slice(0, 12).join('|') === 'New...|Open...|Open Location...|Close|Save|Save As...|Save All|Export Document...|Import Fragment...|Import Picture...|Import Contents...|Import Non-SWP/SW LaTeX...', 'File as 5.5: ' + file.slice(0, 12).join('|'));
const edit = await items('Edit');
check(edit.slice(0, 13).join('|') === 'Undo|Properties...|Cut|Copy|Paste|Paste Special...|Delete|Select All|Copy Picture|Copy as Internal Format|Find...|Replace...|Redo', 'Edit as 5.5, then opensw\'s: ' + edit.slice(0, 13).join('|'));

// ---------- Insert ----------
await call('set', { latex: 'Some text $x$ here.\n\n\\section{Two}\nMore text.\n\nLast paragraph.' });
await page.waitForTimeout(300);
await inFormula();
await page.keyboard.press('End');
await menu('Insert', 'Operator...');
await page.click('#dialog .pick55 button[title="\\\\sum"]');
check(/\\sum/.test(await latexOf()), 'Insert > Operator: a symbol from the picker');
await menu('Insert', 'Binomial...');
await page.selectOption('#d-f', '[]');
await page.click('#dialog-ok');
check(/\\genfrac\{\[\}\{\]\}\{0pt\}/.test(await latexOf()), 'Insert > Binomial with brackets');
await menu('Insert', 'Math Name...');
await page.fill('#d-name', 'sgn');
await page.click('#dialog-ok');
check(/sgn/.test(await latexOf()), 'Insert > Math Name: a name not in the list ' + await latexOf());
await menu('Insert', 'Label...');
await page.click('#dialog-ok');
check(/\\underbrace/.test(await latexOf()), 'Insert > Label: brace below');
await menu('Insert', 'Unit Name...');
await page.click('#dialog-ok');
check(/\\unit\{m\}/.test(await latexOf()), 'Insert > Unit Name');
await page.evaluate(() => document.querySelector('.math-inline')._mathView.exit(1));
await toEnd();
await menu('Insert', 'Spacing', 'Vertical Space...');
await page.click('#dialog-ok');
await menu('Insert', 'Spacing', 'Rule...');
await page.click('#dialog-ok');
await menu('Insert', 'Spacing', 'Break...');
await page.check('input[name="d-br"][value="newpage"]');
await page.click('#dialog-ok');
const fields = (await nodes('tex_field')).map((n) => n.attrs.tex);
check(fields.includes('\\bigskip') && fields.includes('\\rule{1in}{0.4pt}') && fields.includes('\\newpage'), 'Insert > Spacing: vertical space, rule, break ' + fields.join(' '));
await menu('Insert', 'Spacing', 'Horizontal Space...');
await page.check('input[name="d-sp"][value="custom"]');
await page.fill('#d-w', '2cm');
await page.click('#dialog-ok');
check((await nodes('tex_field')).some((n) => n.attrs.tex === '\\hspace{2cm}'), 'Insert > Spacing > Horizontal Space: custom width');
await toEnd();
await menu('Insert', 'Typeset Object', 'Subdocument...');
await page.fill('#d-file', 'chapter1.tex');
await page.click('#dialog-ok');
check((await nodes('subdoc'))[0]?.attrs.tex === '\\QSubDoc{Include chapter1}{\\input{chapter1}}', 'Insert > Typeset Object > Subdocument (5.x\'s \\QSubDoc)');
await toEnd();
await menu('Insert', 'Typeset Object', 'Bibliography...');
await page.fill('#d-files', 'refs.bib');
await page.click('#dialog-ok');
check((await nodes('bibtex'))[0]?.attrs.files === 'refs', 'Insert > Typeset Object > Bibliography (BibTeX)');
await toEnd();
await menu('Insert', 'Typeset Object', 'Hypertext Target...');
await page.fill('#d-key', 'here');
await page.click('#dialog-ok');
check((await nodes('tex_field')).some((n) => n.attrs.tex === '\\hypertarget{here}{}'), 'Insert > Typeset Object > Hypertext Target');
await call('set', { latex: 'A place\\label{spot} to go.\n\nSecond paragraph.\n\nThird paragraph.' });
await toEnd();
await menu('Insert', 'Typeset Object', 'Hypertext Reference...');
await page.fill('#d-text', 'go there');
await page.click('#dialog-ok');
check(/\\hyperref\{go there\}\{\}\{\}\{spot\}/.test(await tex55()), 'Insert > Typeset Object > Hypertext Reference, written as 5.x does');

// ---------- Edit ----------
await page.evaluate(() => { const v = window.swEditor; v.dispatch(v.state.tr.setSelection(window.swTextSelection.create(v.state.doc, 1, 7))); v.focus(); });
await menu('Edit', 'Copy as Internal Format');
check(/^A plac/.test(await page.evaluate(() => navigator.clipboard.readText())), 'Edit > Copy as Internal Format: the 5.x LaTeX');
await menu('Edit', 'Delete');
check(!/A place/.test(await page.evaluate(() => window.swEditor.state.doc.textContent)), 'Edit > Delete removes the selection');

// ---------- Go ----------
await menu('Go', 'To Paragraph...');
await page.fill('#d-n', '3');
await page.click('#dialog-ok');
const p3 = await page.evaluate(() => window.swEditor.state.selection.$from.parent.textContent);
check(/^Third paragraph/.test(p3), 'Go > To Paragraph: ' + p3);
await menu('Go', 'View History...');
await page.click('#dialog-ok');
check(await page.evaluate(() => window.swEditor.state.selection.$from.parent.textContent) !== 'Third paragraph.', 'Go > View History goes back');

// ---------- File > Document Info: title and links, kept as 5.5 keeps them; Go > Links ----------
await menu('File', 'Document Info...');
await page.fill('#d-title', 'My notes');
await page.click('#dialog details summary');
await page.fill('#d-l-next', 'spot');
await page.click('#dialog-ok');
const t1 = await tex55();
check(/%TCIDATA\{<META NAME="Title" CONTENT="My notes">\}/.test(t1) && /%TCIDATA\{<LINK REL="next" HREF="spot">\}/.test(t1), 'Document Info: %TCIDATA title and link');
await page.evaluate(() => { const v = window.swEditor; v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.atEnd(v.state.doc))); });
await menu('Go', 'Links', 'Next Document');
check(/to go/.test(await page.evaluate(() => window.swEditor.state.selection.$from.parent.textContent)), 'Go > Links > Next Document: to the marker the link names');
await menu('Go', 'Links', 'Glossary');
check(/no "Glossary" link/.test(await page.textContent('#toast')), 'Go > Links: a link not set says so');

// a 5.x document: its own %TCIDATA lines are read and changed in place
writeFileSync('/tmp/c55_links.tex', '%2multibyte Version: 5.50.0.2960 CodePage: 1252\n\\documentclass{article}\n\\usepackage{amsmath}\n%TCIDATA{OutputFilter=LATEX.DLL}\n%TCIDATA{<META NAME="Title" CONTENT="Old">}\n%TCIDATA{<LINK REL="contents" HREF="dm0-0.tex">}\n%TCIDATA{BibliographyScheme=Manual}\n\\input{tcilatex}\n\\begin{document}\nHello.\n\\end{document}\n');
await page.setInputFiles('#file', '/tmp/c55_links.tex'); await page.waitForTimeout(800);
await menu('File', 'Document Info...');
check(await page.inputValue('#d-title') === 'Old' && await page.inputValue('#d-l-contents') === 'dm0-0.tex', 'Document Info reads a 5.x file\'s title and links');
await page.click('#dialog-cancel');
await menu('Typeset', 'Bibliography Choice...');
check(await page.isChecked('input[name="d-b"][value="Manual"]'), 'Bibliography Choice reads 5.x\'s scheme');
await page.check('input[name="d-b"][value="BibTeX"]');
await page.click('#dialog-ok');
check(/%TCIDATA\{BibliographyScheme=BibTeX\}/.test(await page.evaluate(() => window.swApp?.meta?.()?.preamble55raw ?? '')) || /BibliographyScheme=BibTeX/.test(await tex55()), 'Bibliography Choice changes the 5.x preamble');
await menu('Typeset', 'Options and Packages...');
await page.fill('#d-o', '12pt');
await page.fill('#d-p', 'amsmath\n[margin=1in]geometry');
await page.click('#dialog-ok');
const t2 = await tex55();
check(/\\documentclass\[12pt\]\{article\}/.test(t2) && /\\usepackage\[margin=1in\]\{geometry\}/.test(t2), 'Options and Packages: class options and packages in the 5.x preamble');
await menu('File', 'Style...');
await page.selectOption('#d-class', 'report');
await page.click('#dialog-ok');
check(/\\documentclass\[12pt\]\{report\}/.test(await tex55()), 'File > Style: the class');

// ---------- Typeset > Front Matter ----------
await call('set', { latex: 'Body.' });
await menu('Typeset', 'Front Matter...');
await page.fill('#d-title', 'A Title');
await page.fill('#d-author', 'Someone');
await page.fill('#d-f-keywords', 'algebra');
await page.click('#dialog-ok');
const first = await page.evaluate(() => window.swEditor.state.doc.toJSON().content.slice(0, 3).map((n) => n.type));
check(first.join(',') === 'title,env,front_field', 'Front Matter: title, author, keywords at the top ' + first);

// ---------- Tag > Apply ----------
await page.evaluate(() => { const v = window.swEditor; v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.atEnd(v.state.doc))); v.focus(); });
await menu('Tag', 'Apply...');
await page.selectOption('#d-tag', 'block:h2');
await page.click('#dialog-ok');
check((await nodes('heading')).length === 1, 'Tag > Apply: Section');

// ---------- View ----------
await menu('View', '✓ Status Bar');
check(await page.isHidden('#statusbar'), 'View > Status Bar hides it');
await page.evaluate(() => localStorage.removeItem('opensw-view55'));
await page.reload(); await page.waitForTimeout(700);
check(await page.isVisible('#statusbar'), 'Status Bar back');
await menu('View', '　Invisibles');
check(await page.evaluate(() => document.querySelector('#editor').classList.contains('show-invisibles')), 'View > Invisibles');
await menu('View', 'Custom...');
await page.fill('#d-z', '150');
await page.click('#dialog-ok');
check(await page.textContent('#status-zoom') === '150%', 'View > Custom zoom');
await page.evaluate(() => localStorage.removeItem('opensw-view55'));

// ---------- Tools ----------
await call('set', { latex: 'This sentense has a mispelled word.' });
await page.evaluate(() => { const v = window.swEditor; v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.atStart(v.state.doc))); });
await menu('Tools', 'Spelling...');
await page.waitForSelector('#d-word', { timeout: 20000 });
await page.waitForTimeout(300);
check(await page.textContent('#d-word') === 'sentense', 'Tools > Spelling finds a word not in the dictionary: ' + await page.textContent('#d-word'));
check(await page.inputValue('#d-new') === 'sentence', 'and suggests the word');
await page.click('#dialog button.dialog-extra:text-is("Change")');
await page.waitForTimeout(200);
check(await page.textContent('#d-word') === 'mispelled', 'Change, then the next word');
await page.click('#dialog button.dialog-extra:text-is("Ignore")');
await page.waitForTimeout(200);
check(/This sentence has/.test(await page.evaluate(() => window.swEditor.state.doc.textContent)) && await page.isHidden('#dialog'), 'Spelling done');
const [dl] = await Promise.all([page.waitForEvent('download'), menu('Tools', 'Save User Preferences...')]);
check(/opensw-preferences\.json/.test(dl.suggestedFilename()), 'Tools > Save User Preferences: a file');

// ---------- File ----------
await call('set', { latex: 'Formula $x^2$ here.' });
await inFormula();
const [png] = await Promise.all([page.waitForEvent('download'), menu('File', 'Export as Picture...')]);
check(/\.png$/.test(png.suggestedFilename()), 'File > Export as Picture: a PNG');
await page.evaluate(() => document.querySelector('.math-inline')._mathView.exit(1));
await menu('File', 'Export Document...');
await page.check('input[name="d-as"][value="md"]');
await page.click('#dialog-ok');
check(await page.isVisible('#export') && /x\^2|x\^\{2\}/.test(await page.inputValue('#export-text')), 'File > Export Document: Markdown');
await page.click('#export-close');
await menu('File', 'Preview...');
await page.waitForTimeout(500);
check(await page.isVisible('#preview55') && /Formula/.test(await page.frameLocator('#preview55-frame').locator('body').textContent()), 'File > Preview: the pages in a window');
await page.click('#preview55-close');
writeFileSync('/tmp/c55_part.tex', '\\documentclass{article}\\begin{document}Imported part.\\end{document}');
await toEnd();
const [chooser] = await Promise.all([page.waitForEvent('filechooser'), menu('File', 'Import Contents...')]);
await chooser.setFiles('/tmp/c55_part.tex');
await page.waitForTimeout(500);
check(/Formula.*Imported part/.test(await page.evaluate(() => window.swEditor.state.doc.textContent)), 'File > Import Contents: put in at the cursor');

// ---------- Help ----------
await menu('Help', 'About SW...');
check(/opensw/.test(await page.textContent('#dialog-body')), 'Help > About');
await page.click('#dialog-ok');
await menu('Help', 'Search...');
await page.fill('#d-q', 'Compute');
await page.click('#dialog-ok');
await page.waitForTimeout(1500);
check(/manual/i.test(await page.title()) || await page.evaluate(() => window.swEditor.state.doc.textContent.length > 2000), 'Help > Search opens the manual');

check(!errs.length, 'no page errors ' + errs);
await b.close();
process.exit(fails ? 1 : 0);
