'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../src/core.js');

test('CRC32 UID test vectors are stable', () => {
  assert.equal(Core.crc32Uid(1), '83dcefb7');
  assert.equal(Core.crc32Uid(33), '0a6216d9');
  assert.equal(Core.crc32Uid(123456789), 'cbf43926');
});

test('v3 golden sample normalizes without comment-field drift', () => {
  const file = fs.readFileSync(path.join(__dirname, 'fixtures/v3-golden.json'), 'utf8');
  const { config, diagnostics } = Core.parseConfigText(file);
  assert.equal(diagnostics.length, 0);
  assert.equal(config.schema, 'piliplus-purify');
  assert.equal(config.version, 4);
  assert.deepEqual(config.mutedUsers.map(({ mid, name }) => ({ mid, name })), [
    { mid: 33, name: '前导零哈希测试' },
    { mid: 123456789, name: '示例账号' },
  ]);
  assert.equal(config.aiFilterLevel, 'balanced');
  assert.equal(config.replyKeywordPattern, '示例|测试');
  assert.equal(config.futureTopLevel.keep, true);
  assert.equal(config.mutedUsers[0].futureUserField, 'keep-me');

  const restored = Core.parseConfigText(Core.exportConfig(config)).config;
  assert.deepEqual(restored, config);
});

test('unknown nested fields survive while dangerous keys are removed', () => {
  const raw = JSON.parse('{"mutedUsers":[],"future":{"value":7,"__proto__":{"polluted":true}},"danmakuAssistant":{"futureAssistant":true},"danmakuRules":{"futureRules":[1,2]}}');
  const restored = Core.parseConfigText(Core.exportConfig(raw)).config;
  assert.equal(restored.future.value, 7);
  assert.equal(Object.hasOwn(restored.future, '__proto__'), false);
  assert.equal(restored.danmakuAssistant.futureAssistant, true);
  assert.deepEqual(restored.danmakuRules.futureRules, [1, 2]);
  assert.equal({}.polluted, undefined);
});

test('mutedUsers hashes are authoritative and legacy hashes only supplement them', () => {
  const config = Core.defaultConfig();
  config.mutedUsers = [{ mid: 33 }];
  config.danmakuRules.uidHashes = ['a6216d9', '0xA6216D9', '83dcefb7'];
  const runtime = Core.buildRuntimeRules(config);
  assert.deepEqual(runtime.mutedUidHashes, ['0a6216d9']);
  assert.deepEqual(runtime.legacyUidHashes, ['83dcefb7']);
});

test('unsafe and invalid regex rules are isolated', () => {
  assert.equal(Core.validateRegex('^正常\\d+$').ok, true);
  assert.equal(Core.validateRegex('(').ok, false);
  assert.equal(Core.validateRegex('^(a+)+$').ok, false);
  assert.equal(Core.validateRegex('(a)\\1').ok, false);

  const config = Core.defaultConfig();
  config.danmakuRules.regex = ['^正常\\d+$', '(', '^(a+)+$'];
  const runtime = Core.buildRuntimeRules(config);
  assert.deepEqual(runtime.regex, ['^正常\\d+$']);
  assert.equal(runtime.disabledRegex.length, 2);
});

test('matcher applies UID, exact, keyword and format rules', () => {
  const config = Core.defaultConfig();
  config.mutedUsers = [{ mid: 123456789 }];
  config.danmakuAssistant.absoluteRules = ['剧透'];
  config.danmakuAssistant.gentleRules = ['考古'];
  config.danmakuAssistant.blockPeopleCounts = true;
  config.danmakuRules.keywords = ['广告'];
  config.danmakuRules.regex = ['^测试\\d+$'];
  const match = Core.compileRuntimeMatcher(Core.buildRuntimeRules(config));
  assert.equal(match('普通文本', 'cbf43926').kind, 'uid');
  assert.equal(match('这里有剧透', '').kind, 'absolute');
  assert.equal(match(' 考古 ', '').kind, 'gentle');
  assert.equal(match('1000人', '').kind, 'peopleCount');
  assert.equal(match('这是广告', '').kind, 'keyword');
  assert.equal(match('测试42', '').kind, 'regex');
  assert.equal(match('正常弹幕', ''), null);
});

test('1000-rule configuration remains comfortably below local storage scale', () => {
  const config = Core.defaultConfig();
  config.danmakuRules.keywords = Array.from({ length: 1000 }, (_, index) => `测试规则-${index}`);
  const started = performance.now();
  const runtime = Core.buildRuntimeRules(config);
  const elapsed = performance.now() - started;
  const bytes = Buffer.byteLength(Core.exportConfig(config));
  assert.equal(runtime.keywords.length, 1000);
  assert.ok(bytes < 1024 * 1024, `serialized size was ${bytes} bytes`);
  assert.ok(elapsed < 200, `rule compilation took ${elapsed.toFixed(1)}ms`);
});

test('uploader blocklist normalizes independently from comment users', () => {
  const config = Core.defaultConfig();
  config.mutedUsers = [{ mid: 33, name: '评论账号' }];
  config.uploaderRules.users = [
    { mid: '123456789', name: 'UP主' },
    { mid: 123456789, name: 'UP主新名称', future: true },
    { mid: 'invalid' },
  ];
  const { config: normalized, diagnostics } = Core.normalizeConfig(config);
  assert.deepEqual(normalized.uploaderRules.users, [{ mid: 123456789, name: 'UP主新名称', future: true }]);
  assert.equal(normalized.mutedUsers[0].mid, 33);
  assert.deepEqual(Core.buildRuntimeRules(normalized).blockedUploaders, normalized.uploaderRules.users);
  assert.equal(diagnostics.some((entry) => entry.code === 'invalid-user-mid'), true);
});

test('homepage carousel layout preference defaults on and round-trips off', () => {
  const defaults = Core.defaultConfig();
  assert.equal(defaults.browserExtension.hideHomepageCarousel, true);
  assert.equal(defaults.browserExtension.videoPageDomEnhancements, false);
  defaults.browserExtension.hideHomepageCarousel = false;
  defaults.browserExtension.videoPageDomEnhancements = true;
  const restored = Core.parseConfigText(Core.exportConfig(defaults)).config;
  assert.equal(restored.browserExtension.hideHomepageCarousel, false);
  assert.equal(restored.browserExtension.videoPageDomEnhancements, true);
  assert.equal(restored.browserExtension.version, 5);
});

test('advertising preferences and remote keywords build a deduplicated runtime', () => {
  const config = Core.defaultConfig();
  config.browserExtension.adFilter.customKeywords = ['自定义推广', '重复'];
  const runtime = Core.buildRuntimeRules(config, { adKeywords: ['远程推广', '重复'] });
  assert.equal(runtime.adFilter.enabled, true);
  assert.deepEqual(runtime.adFilter.keywords, ['远程推广', '重复', '自定义推广']);
  config.browserExtension.adFilter.remoteKeywordsEnabled = false;
  assert.deepEqual(Core.buildRuntimeRules(config, { adKeywords: ['远程推广'] }).adFilter.keywords, ['自定义推广', '重复']);
});
