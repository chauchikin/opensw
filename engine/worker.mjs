// Runs the computation engine (SymPy in Pyodide) in a background thread so the
// editor stays responsive. Message in: {id, op, json}; out: {id, result} or {id, error}.
// `result` is the JSON text returned by opensw_compute.compute (see opensw_compute.py).
import { loadPyodide } from './pyodide/pyodide.mjs';

const base = new URL('./', import.meta.url);
const fetchBytes = async (path) => (await fetch(new URL(path, base))).arrayBuffer();

const ready = (async () => {
  const py = await loadPyodide({ indexURL: new URL('pyodide/', base).href });
  // SymPy and mpmath are pure-Python wheels shipped with the editor (no internet needed)
  const wheels = await (await fetch(new URL('wheels/wheels.json', base))).json();
  for (const w of wheels) py.unpackArchive(await fetchBytes('wheels/' + w), 'wheel');
  py.FS.writeFile('/home/pyodide/opensw_compute.py', new Uint8Array(await fetchBytes('opensw_compute.py')));
  py.runPython('import sys; sys.path.insert(0, "/home/pyodide")');
  return py.pyimport('opensw_compute').compute;
})();

// tell the page whether loading worked (a page that forbids WebAssembly cannot run it)
ready.then(() => self.postMessage({ ready: true }), (err) => self.postMessage({ fatal: String(err.message || err) }));

self.onmessage = async (e) => {
  const { id, op, json } = e.data;
  try {
    const compute = await ready;
    self.postMessage({ id, result: compute(op, json) });
  } catch (err) {
    self.postMessage({ id, error: String(err.message || err) });
  }
};
