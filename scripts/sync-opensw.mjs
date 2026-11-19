// Copies the development branch into a checkout of the public opensw repository and commits it:
// the files of <ref> replace the tracked files, test/fixtures/sw6 is left out, and opensw's own
// .gitignore and test/fixtures/README.md are kept. Runs precheck-public.mjs before committing.
// Usage (from the development checkout): node scripts/sync-opensw.mjs <opensw checkout> [ref=sw-next]
// It does not push: push opensw main yourself, and a tag v<version> to publish a release.
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const [target, ref = 'sw-next'] = process.argv.slice(2);
if (!target) { console.log('Usage: node scripts/sync-opensw.mjs <opensw checkout> [ref]'); process.exit(1); }
const out = resolve(target);
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();

if (git(out, 'status', '--porcelain')) { console.log(`${out} has uncommitted changes; stopping.`); process.exit(1); }
const keep = ['.gitignore', 'test/fixtures/README.md'];
const kept = Object.fromEntries(keep.map((f) => [f, readFileSync(join(out, f))]));

for (const f of git(out, 'ls-files').split('\n').filter(Boolean)) rmSync(join(out, f), { force: true });
const tar = join(tmpdir(), `opensw-sync-${Date.now()}.tar`);
execFileSync('git', ['archive', '--format=tar', '-o', tar, ref]);
execFileSync('tar', ['-xf', tar, '-C', out]);
rmSync(tar);
rmSync(join(out, 'test/fixtures/sw6'), { recursive: true, force: true });
for (const f of keep) writeFileSync(join(out, f), kept[f]);

git(out, 'add', '-A');
execFileSync(process.execPath, [join(import.meta.dirname, 'precheck-public.mjs'), out], { stdio: 'inherit' });
if (!git(out, 'status', '--porcelain')) { console.log('Nothing changed.'); process.exit(0); }
const version = JSON.parse(readFileSync(join(out, 'package.json'), 'utf8')).version;
const sha = execFileSync('git', ['rev-parse', '--short', ref], { encoding: 'utf8' }).trim();
git(out, 'commit', '-q', '-m', `opensw ${version} (from sw-next ${sha})`);
console.log(`Committed in ${out}: opensw ${version} (from sw-next ${sha}). Push main yourself.`);
