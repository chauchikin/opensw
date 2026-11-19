// Checks a checkout before it goes public: no keys or passwords, no personal paths or names,
// no Scientific Word 6 sample files, and every 5.5 macro file in src-tauri/tex55 either carries
// the "NOT proprietary" notice or was written for opensw.
// Usage: node scripts/precheck-public.mjs [dir]   (default: current folder; exits 1 on a problem)
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const dir = process.argv[2] || '.';
const files = execFileSync('git', ['-C', dir, 'ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);
const problems = [];

const secret = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\bgh[pousr]_[A-Za-z0-9]{30,}/, /\bgithub_pat_[A-Za-z0-9_]{30,}/,
  /\bsk-[A-Za-z0-9_-]{20,}/, /\bAKIA[0-9A-Z]{16}\b/, /\bxox[abp]-[A-Za-z0-9-]{10,}/,
  /\b\d{8,10}:AA[A-Za-z0-9_-]{30,}/, // Telegram bot token
  /(password|passwd|api[_-]?key|secret)\s*[:=]\s*['"][^'"\s]{6,}['"]/i,
];
// Personal words (names, user folders) are not written here, since this file is public: put one
// per line in the file named by OPENSW_PRECHECK_WORDS (kept outside the repository).
const wordsFile = process.env.OPENSW_PRECHECK_WORDS;
const personal = !wordsFile ? [] : readFileSync(wordsFile, 'utf8').split(/\r?\n/).map((w) => w.trim()).filter(Boolean)
  .map((w) => new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
if (!wordsFile) console.log('note: OPENSW_PRECHECK_WORDS not set, personal names and paths are not checked');
// The one line that may name the old identifier: moving settings from the old sw-next install.
const allowed = (file, line) => file === 'src-tauri/src/lib.rs' && /^const OLD_IDENTIFIER: &str = "[\w.]+";$/.test(line.trim());

for (const f of files) {
  if (f.startsWith('test/fixtures/sw6/')) { problems.push(`${f}: Scientific Word 6 sample file`); continue; }
  const buf = readFileSync(join(dir, f));
  if (buf.includes(0)) continue; // binary
  const lines = buf.toString('utf8').split('\n');
  lines.forEach((line, i) => {
    for (const re of secret) if (re.test(line)) problems.push(`${f}:${i + 1}: looks like a key or password`);
    for (const re of personal) if (re.test(line) && !allowed(f, line)) problems.push(`${f}:${i + 1}: personal name or path (${re.source})`);
  });
  if (f.startsWith('src-tauri/tex55/') && !f.endsWith('README.md')) {
    const text = buf.toString('latin1');
    if (!/NOT proprietary/.test(text) && !/opensw/i.test(text)) problems.push(`${f}: 5.5 file without the "NOT proprietary" notice`);
  }
}

if (problems.length) { console.log(problems.join('\n')); console.log(`${problems.length} problem(s)`); process.exit(1); }
console.log(`ok: ${files.length} files checked`);
