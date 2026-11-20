// Chinese 5.x documents (A16): Big5 file opens, typesets with xelatex (xeCJK).  node test/chinese.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const page = await b.newPage();
await page.goto(`http://localhost:${process.env.OPENSW_PORT || 4173}/?lang=zh-TW`); await page.waitForTimeout(600);
let fails = 0;
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fails++; };
await page.setInputFiles('#file', 'test/fixtures/big5.tex'); await page.waitForTimeout(1200);
const text = await page.evaluate(() => window.swEditor.state.doc.textContent);
check(text.includes('中文標題') && text.includes('這是中文段落') && text.includes('𠮷'), 'Big5 text and \\U{20BB7} read');
await page.click('#btn-latex'); await page.waitForTimeout(300);
const tex = await page.inputValue('#export-text');
check(/\\usepackage\{xeCJK\}/.test(tex), 'xeCJK added for Chinese');
fs.rmSync('/tmp/zh', { recursive: true, force: true }); fs.mkdirSync('/tmp/zh');
fs.writeFileSync('/tmp/zh/zh.tex', tex);
fs.copyFileSync('src-tauri/tex55/tcilatex.tex', '/tmp/zh/tcilatex.tex');
try { execSync('xelatex -interaction=nonstopmode zh.tex', { cwd: '/tmp/zh', stdio: 'ignore', timeout: 120000 }); } catch (e) { /* below */ }
const pdf = fs.existsSync('/tmp/zh/zh.pdf') ? execSync('pdftotext /tmp/zh/zh.pdf -').toString() : '';
check(/1 中文標題/.test(pdf) && /這是中文段落/.test(pdf), 'typesets Chinese');
await b.close();
process.exit(fails ? 1 : 0);
