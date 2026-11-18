// Records every request the editor sends to the SymPy engine, and its answer, while a test
// runs:  OPENSW_RECORD=/tmp/rec.jsonl node --import ./scripts/record-engine.mjs test/plots4.mjs
// (used to make the cases test/wolfram.wls checks Mathematica's answers against)
import { appendFileSync } from 'node:fs';
import { chromium } from 'playwright';

const out = process.env.OPENSW_RECORD || '/tmp/opensw-engine.jsonl';
const recorder = () => {
  const W = window.Worker;
  window.Worker = class extends W {
    constructor(...a) {
      super(...a);
      const asked = new Map();
      this.addEventListener('message', (e) => {
        const d = e.data;
        if (d && asked.has(d.id)) { window.__recPush(JSON.stringify({ ...asked.get(d.id), result: d.result ?? null, error: d.error ?? null })); asked.delete(d.id); }
      });
      const post = this.postMessage.bind(this);
      this.postMessage = (m) => { if (m && m.op) asked.set(m.id, { op: m.op, json: m.json }); post(m); };
    }
  };
};
const launch = chromium.launch.bind(chromium);
chromium.launch = async (...a) => {
  const browser = await launch(...a);
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async (...b) => {
    const page = await newPage(...b);
    await page.exposeFunction('__recPush', (line) => appendFileSync(out, line + '\n'));
    await page.addInitScript(recorder);
    return page;
  };
  return browser;
};
