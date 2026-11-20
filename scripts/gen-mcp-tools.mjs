// Writes src-tauri/mcp-tools.json (the MCP tool list) from COMMANDS in src/api.js.
// Run after changing COMMANDS: node scripts/gen-mcp-tools.mjs   (--check: only compare)
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../src/api.js', import.meta.url), 'utf8');
const block = src.slice(src.indexOf('export const COMMANDS = {'), src.indexOf('};', src.indexOf('export const COMMANDS = {')) + 2);
const COMMANDS = new Function(block.replace('export const COMMANDS =', 'return'))();
const TYPES = { string: 'string', number: 'integer', boolean: 'boolean', object: 'object' };
const tools = Object.entries(COMMANDS).filter(([name]) => name !== 'help').map(([name, [desc, params]]) => {
  const properties = {};
  const required = [];
  for (const [p, t] of Object.entries(params)) {
    const base = t.replace('?', '');
    properties[p] = base.endsWith('[]') ? { type: 'array', items: { type: TYPES[base.slice(0, -2)] } } : { type: TYPES[base] };
    if (!t.endsWith('?')) required.push(p);
  }
  return { name: 'sw_' + name, description: desc, inputSchema: { type: 'object', properties, ...(required.length ? { required } : {}) } };
});
const text = JSON.stringify(tools, null, 2) + '\n';
const out = new URL('../src-tauri/mcp-tools.json', import.meta.url);
if (process.argv.includes('--check')) {
  const same = fs.existsSync(out) && fs.readFileSync(out, 'utf8') === text;
  console.log(same ? 'mcp-tools.json is up to date' : 'mcp-tools.json is OUT OF DATE');
  process.exit(same ? 0 : 1);
}
fs.writeFileSync(out, text);
console.log('wrote', tools.length, 'tools');
