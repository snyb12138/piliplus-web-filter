'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
if (manifest.manifest_version !== 3) throw new Error('manifest_version must be 3');
if (!manifest.permissions?.includes('scripting')) throw new Error('connection diagnostics require scripting permission');

const referenced = new Set(['popup.html', manifest.options_page]);
if (manifest.background?.service_worker) referenced.add(manifest.background.service_worker);
const scriptWorlds = new Map();
for (const group of manifest.content_scripts || []) {
  const world = group.world || 'ISOLATED';
  for (const file of group.js || []) {
    referenced.add(file);
    const previousWorld = scriptWorlds.get(file);
    if (previousWorld && previousWorld !== world) throw new Error(`${file} is reused across ${previousWorld} and ${world}`);
    scriptWorlds.set(file, world);
  }
}
for (const file of referenced) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing manifest file: ${file}`);
}

for (const file of fs.readdirSync(path.join(root, 'src')).filter((name) => name.endsWith('.js'))) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, 'src', file)], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || `Syntax check failed: ${file}`);
}
const pageCoreSource = fs.readFileSync(path.join(root, 'src/core.js'));
const isolatedCoreSource = fs.readFileSync(path.join(root, 'src/content-core.js'));
if (!pageCoreSource.equals(isolatedCoreSource)) throw new Error('content-core.js must remain byte-identical to core.js');
const interactionSource = fs.readFileSync(path.join(root, 'src/interactions.js'), 'utf8');
if (!interactionSource.includes('.container.is-version8 > .recommended-swipe')) {
  throw new Error('homepage carousel selector is missing');
}
if (!interactionSource.includes('findHomepageGridItem') || !interactionSource.includes('.feed-card:empty')) {
  throw new Error('homepage grid compaction is missing');
}
if (!interactionSource.includes('observeListContainer') || !interactionSource.includes('adsDomHidden')) {
  throw new Error('continuous advertising DOM fallback is missing');
}
if (!fs.existsSync(path.join(root, 'config/ad-keywords.json'))) throw new Error('bundled advertising keywords are missing');
if (!manifest.permissions?.includes('alarms')) throw new Error('advertising rule synchronization requires alarms');
if (!fs.readFileSync(path.join(root, 'options.html'), 'utf8').includes('id="hideHomepageCarousel"')) {
  throw new Error('homepage carousel option is missing');
}
console.log(`Static check passed: ${referenced.size} manifest files, ${fs.readdirSync(path.join(root, 'src')).filter((name) => name.endsWith('.js')).length} scripts.`);
