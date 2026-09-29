#!/usr/bin/env node
/**
 * Merge stream-owned scene modules into the editable main scene.
 *   node scripts/merge-scene-modules.mjs public/scenes/modules/valley.iwsdk.scene.json [...more]
 * Nodes are matched by id (module wins), authoring views are merged by id, and a
 * module's root `environment` block (fog) is adopted when present. Prefab resources
 * are merged by id. Idempotent: running it twice changes nothing.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const MAIN = 'public/scenes/main.iwsdk.scene.json';
const modules = process.argv.slice(2);
if (!modules.length) {
  console.error('usage: merge-scene-modules.mjs <module.iwsdk.scene.json>...');
  process.exit(1);
}
const main = JSON.parse(readFileSync(MAIN, 'utf8'));
const report = [];
for (const path of modules) {
  const module = JSON.parse(readFileSync(path, 'utf8'));
  if (module.imports?.length) throw new Error(`${path}: flatten imports before merging`);
  let added = 0, replaced = 0;
  for (const node of module.nodes ?? []) {
    const index = main.nodes.findIndex((existing) => existing.id === node.id);
    if (index >= 0) { main.nodes[index] = node; replaced++; } else { main.nodes.push(node); added++; }
  }
  for (const view of module.authoring?.views ?? []) {
    main.authoring ??= {};
    main.authoring.views ??= [];
    const index = main.authoring.views.findIndex((existing) => existing.id === view.id);
    if (index >= 0) main.authoring.views[index] = view; else main.authoring.views.push(view);
  }
  for (const prefab of module.resources?.prefabs ?? []) {
    main.resources ??= {};
    main.resources.prefabs ??= [];
    const index = main.resources.prefabs.findIndex((existing) => existing.id === prefab.id);
    if (index >= 0) main.resources.prefabs[index] = prefab; else main.resources.prefabs.push(prefab);
  }
  if (module.environment) main.environment = { ...(main.environment ?? {}), ...module.environment };
  report.push(`${path}: +${added} nodes, ${replaced} replaced`);
}
const ids = new Set();
for (const node of main.nodes) {
  if (ids.has(node.id)) throw new Error(`duplicate node id after merge: ${node.id}`);
  ids.add(node.id);
}
writeFileSync(MAIN, `${JSON.stringify(main, null, 2)}\n`);
console.log(report.join('\n'), `\nmain: ${main.nodes.length} nodes`);
