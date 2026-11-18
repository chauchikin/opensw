import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const srv = spawn('python3', ['test/csp_server.py', '5189'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
for (const z of [1, 2]) {
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  await page.goto('http://localhost:5189/?lang=zh-TW');
  await page.waitForTimeout(800);
  await page.selectOption('#zoom-select', String(z));
  // click just inside the right edge and just inside the left edge
  for (const label of ['right', 'left']) {
    const box = await page.locator('.math-inline math-field').first().boundingBox(); // the formula may move after each edit
    await page.mouse.click(label === 'right' ? box.x + box.width - 3 : box.x + 3, box.y + box.height / 2);
    await page.waitForTimeout(200);
    await page.keyboard.type('Q');
    await page.keyboard.press('Escape');
    const l = await page.evaluate(() => { let l; window.swEditor.state.doc.descendants((n) => { if (!l && n.type.name === 'math_inline') l = n.attrs.latex; }); return l; });
    console.log(await page.textContent('#status-zoom'), label, l);
  }
  await page.close();
}
await browser.close(); srv.kill();
