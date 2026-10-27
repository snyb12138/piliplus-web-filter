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
const pageMainSource = fs.readFileSync(path.join(root, 'src/page-main.js'), 'utf8');
if (!interactionSource.includes('.container.is-version8 > .recommended-swipe')) {
  throw new Error('homepage carousel selector is missing');
}
if (!interactionSource.includes('findHomepageGridItem') || !interactionSource.includes('.feed-card:empty') || !interactionSource.includes('isHomepageGrid')) {
  throw new Error('homepage grid compaction is missing');
}
if (!interactionSource.includes('[class*="recommended-container_"]') || !interactionSource.includes('grid-area:auto!important')) {
  throw new Error('homepage grid variant compaction is missing');
}
if (!interactionSource.includes('observeListContainer') || !interactionSource.includes('adsDomHidden')) {
  throw new Error('continuous advertising DOM fallback is missing');
}
if (!interactionSource.includes("card.matches('.floor-single-card')")) {
  throw new Error('homepage official promotion card filter is missing');
}
if (!pageMainSource.includes('HOMEPAGE_UPSTREAM_SIZE = 30') || !pageMainSource.includes('HOMEPAGE_MAX_REFILLS = 2') || !pageMainSource.includes('homepageRefillRequest')) {
  throw new Error('homepage 6x4 upstream refill is missing');
}
if (!interactionSource.includes("document.readyState === 'loading'") || !interactionSource.includes('PAGE_CHROME_SELECTOR')) {
  throw new Error('hydration-safe interaction startup is missing');
}
if (interactionSource.includes('data-pbp-video-ad-filter="1"] .strip-ad')) {
  throw new Error('video advertising CSS must not hide generic strip-ad nodes globally');
}
if (!interactionSource.includes('ROUTE_SETTLE_MS') || !interactionSource.includes('routeScanDeferrals')) {
  throw new Error('SPA route stabilization is missing');
}
if (!interactionSource.includes('videoAdDomFallbackAllowed') || !fs.readFileSync(path.join(root, 'options.html'), 'utf8').includes('id="videoPageDomEnhancements"')) {
  throw new Error('video page compatibility mode is missing');
}
if (!interactionSource.includes('scanUploaderRoot(root)') || !interactionSource.includes('if (isVideoPageLocation()) return;')) {
  throw new Error('video page uploader injection guard is missing');
}
if (!interactionSource.includes('videoInteractionHoldUntil') || !interactionSource.includes('videoPageInteractionDeferrals')) {
  throw new Error('video page safe interaction restoration is missing');
}
if (!interactionSource.includes('bili-comment-replies-renderer') || !interactionSource.includes('commentReplyButtons')) {
  throw new Error('nested comment reply purification is missing');
}
if (!interactionSource.includes('data-pbp-home-grid') || !interactionSource.includes('order:0!important') || !interactionSource.includes('margin-top:0!important')) {
  throw new Error('homepage direct grid-item normalization is missing');
}
if (!interactionSource.includes('inspectHomepageGridLayout') || !fs.readFileSync(path.join(root, 'src/content.js'), 'utf8').includes('firstRowOffsetSpread')) {
  throw new Error('homepage grid diagnostics are missing');
}
if (!interactionSource.includes('HOMEPAGE_GRID_SLOTS = 24') || !interactionSource.includes('HOMEPAGE_VIDEO_SLOTS = 22') || !interactionSource.includes('data-pbp-home-paged-ready') || !interactionSource.includes('applyHomepagePageLimit')) {
  throw new Error('homepage 6x4 paged mode is missing');
}
if (!interactionSource.includes('data-pbp-home-stats') || !interactionSource.includes('FEEDBACK_URL') || !interactionSource.includes('getStatusSnapshot')) {
  throw new Error('homepage purification statistics panel is missing');
}
if (!interactionSource.includes('activeHomepageGrid') || !interactionSource.includes('requestHomepageBatch') || !interactionSource.includes('pbp-home-custom-card') || !interactionSource.includes('.flexible-roll-btn-inner')) {
  throw new Error('homepage managed refresh is missing');
}
if (!interactionSource.includes('suppressHomepageNativeGridItems') || !interactionSource.includes('nativeSlotsSuppressed')) {
  throw new Error('homepage managed refresh skeleton suppression is missing');
}
if (!pageMainSource.includes('homepage-batch-result') || !pageMainSource.includes('homepageBatchRequests')) {
  throw new Error('homepage managed refresh bridge is missing');
}
if (!pageMainSource.includes('request-comment-catalog') || !pageMainSource.includes('COMMENT_RETRY_DELAYS = [60, 250]') || !pageMainSource.includes('data-pbp-comment-rpid')) {
  throw new Error('structured comment catalog and retry queue are missing');
}
if (!interactionSource.includes('pbp-comment-catalog-updated') || !interactionSource.includes('visible-fallback') || !interactionSource.includes('resetCommentCatalogForRoute')) {
  throw new Error('incremental comment catalog lifecycle is missing');
}
const contentSource = fs.readFileSync(path.join(root, 'src/content.js'), 'utf8');
if (!contentSource.includes('commentsByRpid') || !contentSource.includes('accountsByMid') || !contentSource.includes('elementsByRpid') || !contentSource.includes('getMountedCommentRpidsByMid')) {
  throw new Error('isolated-world comment indexes are missing');
}
if (!fs.existsSync(path.join(root, 'config/ad-keywords.json'))) throw new Error('bundled advertising keywords are missing');
if (!manifest.permissions?.includes('alarms')) throw new Error('advertising rule synchronization requires alarms');
if (!fs.readFileSync(path.join(root, 'options.html'), 'utf8').includes('id="hideHomepageCarousel"')) {
  throw new Error('homepage carousel option is missing');
}
if (!fs.readFileSync(path.join(root, 'options.html'), 'utf8').includes('id="homepagePagedMode"')) {
  throw new Error('homepage paged mode option is missing');
}
console.log(`Static check passed: ${referenced.size} manifest files, ${fs.readdirSync(path.join(root, 'src')).filter((name) => name.endsWith('.js')).length} scripts.`);
