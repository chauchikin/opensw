// More SW 6 elements (A19): breaks, spaces, \verb, raw TeX, 5.5 \QTR tags, plots (<graph>),
// SW 6's own notes / citations / index entries.  node test/sw6more.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import JSZip from 'jszip';
const tpl = await JSZip.loadAsync(fs.readFileSync('test/fixtures/sw6/template.sci'));
const xml = (await tpl.file('main.xhtml').async('string')).replace(/<body[^]*<\/body>/, `<body>
<bodyText>A<hspace type="thinSpace"/>B<hspace type="requiredSpace"/>C<vspace type="bigSkip"/>D<msibr type="newPage"/>E<msibr type="allowBreak"/>F<msibr/>G</bodyText>
<bodyText>Code <verb>x|y</verb>, raw <rawTeX tex="\\textup">up</rawTeX>, tag <QTR type="bf">bold</QTR>.</bodyText>
<bodyText>Note<notewrapper type="footnote"><note type="footnote" hide="false"><bodyText>Made in SW 6.</bodyText></note></notewrapper>,
cite <citation citekey="k1,k2" hasRemark="true" type="bibtex"><biblabel class="remark">p. 2</biblabel></citation>,
index<indexitem pri="Hilbert space" sec="separable" enc="textbf" specAppearance="p"><prispec><italics>Hilbert</italics> space</prispec></indexitem>.</bodyText>
<bodyText><graph><graphSpec plotType="2D"><plot><Expression>x</Expression></plot></graphSpec><msiframe frametype="image" units="in" pos="center" width="3" height="2"><object data="plots/p1.xvz" msigraph="true"/><object data="graphics/p1.png" msisnap="true" style="width: 288px; height: 192px;"/></msiframe></graph></bodyText>
</body>`);
const zip = new JSZip();
for (const [p, e] of Object.entries(tpl.files)) if (!e.dir && p !== 'main.xhtml') zip.file(p, await e.async('uint8array'));
zip.file('main.xhtml', xml);
zip.file('graphics/p1.png', fs.readFileSync('test/fixtures/pictures/graphics/dot.png'));
zip.file('plots/p1.xvz', 'plot data');
fs.writeFileSync('/tmp/sw6more.sci', await zip.generateAsync({ type: 'nodebuffer' }));

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const page = await b.newPage({ viewport: { width: 1024, height: 900 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:4173/?lang=zh-TW'); await page.waitForTimeout(600);
let fails = 0;
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fails++; };
const open = async (file) => {
  await page.setInputFiles('#file', file);
  if (await page.isVisible('#confirm')) await page.click('#confirm-ok');
  await page.waitForTimeout(1200);
};
const docJSON = () => page.evaluate(() => JSON.stringify(window.swEditor.state.doc.toJSON()).replace(/"src":"blob:[^"]*"/g, '"src":"blob"'));
await open('/tmp/sw6more.sci');
const p1 = await page.evaluate(() => JSON.stringify(window.swEditor.state.doc.child(0).toJSON().content.map((n) => n.text ?? n.attrs?.tex ?? n.type)));
check(p1 === JSON.stringify(['A\u2009B\u00a0C', '\\bigskip', 'D', '\\newpage', 'EF', 'hard_break', 'G']), 'breaks and spaces: ' + p1);
const p2 = await page.evaluate(() => window.swEditor.state.doc.child(1).toJSON().content.map((n) => (n.text ?? n.attrs.tex) + (n.marks ? ':' + n.marks.map((m) => m.type).join('+') : '')).join(' | '));
check(p2 === 'Code  | x|y:code | , raw  | \\textup{up} | , tag  | bold:bold | .', 'verb, raw TeX, \\QTR: ' + p2);
const p3 = await page.evaluate(() => { const l = []; window.swEditor.state.doc.child(2).forEach((n) => { if (!n.isText) l.push(n.type.name + ':' + (n.attrs.kind || '') + (n.attrs.keys || '') + (n.attrs.note || '') + (n.attrs.entry || '') + (n.textContent || '')); }); return l.join(' | '); });
check(p3 === 'note:footnoteMade in SW 6. | cite:citek1,k2p. 2 | index_entry:Hilbert space@Hilbert space!separable|textbf', 'SW 6 note, citation, index entry: ' + p3);
check(await page.evaluate(() => [...document.querySelectorAll('.image img')].filter((i) => i.complete && i.naturalWidth > 0).length) === 1, 'plot snapshot shown');
const before = await docJSON();
fs.writeFileSync('/tmp/sw6more2.sci', Buffer.from(await page.evaluate(() => window.swSaveSci()), 'base64'));
const saved = await (await JSZip.loadAsync(fs.readFileSync('/tmp/sw6more2.sci'))).file('main.xhtml').async('string');
check(/<graph><graphSpec plotType="2D">[^]*msigraph="true"[^]*msisnap="true"[^]*<\/graph>/.test(saved), 'the SW 6 plot is written back as it was');
await open('/tmp/sw6more2.sci');
check(await docJSON() === before, 'same after saving and opening again');
check(!errs.length, 'no page errors ' + errs);
await b.close();
process.exit(fails ? 1 : 0);
