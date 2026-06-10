import esbuild from 'esbuild';
import { builtinModules } from 'node:module';

const builtins = new Set([...builtinModules, ...builtinModules.map(m => `node:${m}`)]);
const result = await esbuild.build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  write: false,
  metafile: true,
  format: 'cjs',
  target: 'es2018',
  logLevel: 'silent',
  external: ['obsidian','electron','@codemirror/*','@lezer/*', ...builtins],
});
const inputs = result.metafile.inputs;
function bfs(root) {
  const seen = new Set();
  const queue = [root];
  while (queue.length) {
    const mod = queue.shift();
    if (seen.has(mod) || !inputs[mod]) continue;
    seen.add(mod);
    for (const imp of inputs[mod].imports) {
      if (imp.kind === 'import-statement' || imp.kind === 'require-call') {
        if (inputs[imp.path]) queue.push(imp.path);
      }
    }
  }
  return seen;
}
const mainGraph = bfs('src/main.ts');
const remoteGraph = bfs('src/remote/registration.ts');
const mobile = new Set([...mainGraph, ...remoteGraph]);
const offenders = [];
for (const mod of mobile) {
  const nodeImps = inputs[mod].imports.filter(i => i.external && builtins.has(i.path)).map(i => i.path);
  if (nodeImps.length) offenders.push({ mod, nodeImps: [...new Set(nodeImps)], where: mainGraph.has(mod) ? 'main' : 'remote-only' });
}
offenders.sort((a,b) => a.mod.localeCompare(b.mod));
console.log(`main graph: ${mainGraph.size}, remote graph adds: ${[...remoteGraph].filter(m => !mainGraph.has(m)).length}, total mobile: ${mobile.size}`);
for (const o of offenders) console.log(`[${o.where}] ${o.mod}: ${o.nodeImps.join(', ')}`);
