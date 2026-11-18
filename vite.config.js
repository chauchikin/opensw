import fs from 'node:fs';
import path from 'node:path';

// Puts the computation engine (engine/ + Pyodide from node_modules) into public/engine,
// which Vite serves as plain files. public/engine is generated, not kept in git.
function engineFiles() {
  return {
    name: 'opensw-engine-files',
    buildStart() {
      const out = path.resolve('public/engine');
      fs.mkdirSync(path.join(out, 'pyodide'), { recursive: true });
      fs.mkdirSync(path.join(out, 'wheels'), { recursive: true });
      for (const f of ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']) {
        fs.copyFileSync(path.resolve('node_modules/pyodide', f), path.join(out, 'pyodide', f));
      }
      const wheels = fs.readdirSync('engine/wheels').filter((f) => f.endsWith('.whl'));
      for (const w of wheels) fs.copyFileSync(path.join('engine/wheels', w), path.join(out, 'wheels', w));
      fs.writeFileSync(path.join(out, 'wheels', 'wheels.json'), JSON.stringify(wheels));
      for (const f of ['worker.mjs', 'opensw_compute.py']) fs.copyFileSync(path.join('engine', f), path.join(out, f));
    },
  };
}

export default {
  base: './',
  plugins: [engineFiles()],
  build: { outDir: 'dist', chunkSizeWarningLimit: 2000, assetsInlineLimit: 1e8 },
};
