'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const source = (name) => fs.readFileSync(path.join(root, 'src', name), 'utf8');

function concat(...parts) {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function varint(value) {
  const bytes = [];
  do {
    let byte = value % 128;
    value = Math.floor(value / 128);
    if (value) byte |= 0x80;
    bytes.push(byte);
  } while (value);
  return Uint8Array.from(bytes);
}

function wireBytes(field, value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return concat(varint(field * 8 + 2), varint(bytes.length), bytes);
}

function wireVarint(field, value) {
  return concat(varint(field * 8), varint(value));
}

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.localName = tagName.toLowerCase();
    this.dataset = {};
    this.attributes = new Map();
    this.style = { setProperty() {}, removeProperty() {} };
    this.textContent = '';
    this.isConnected = true;
  }
  matches(selector) {
    return String(selector).split(',').some((part) => part.trim().toLowerCase() === this.localName);
  }
  querySelectorAll() { return []; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
}

class FakeText {}

test('MAIN and isolated worlds complete the token/rule handshake and reinjection is idempotent', async () => {
  const listeners = [];
  const runtimeListeners = [];
  const storageListeners = [];
  const storageState = {};
  let fetchBytes = new Uint8Array();
  let lastFetchUrl = '';
  const homepageFetchPayloads = [];
  let commentRenderers = [];
  const windowProxy = {
    fetch: async (input) => {
      lastFetchUrl = input instanceof Request ? input.url : String(input);
      if (lastFetchUrl.includes('/x/web-interface/') && lastFetchUrl.includes('/index/top/feed/rcmd') && homepageFetchPayloads.length) {
        return new Response(JSON.stringify(homepageFetchPayloads.shift()));
      }
      return new Response(fetchBytes);
    },
    addEventListener(type, listener) {
      if (type === 'message') listeners.push(listener);
    },
    postMessage(data) {
      for (const listener of [...listeners]) listener({ source: windowProxy, data });
    },
  };
  const document = {
    readyState: 'loading',
    documentElement: new FakeElement('html'),
    querySelector() { return null; },
    querySelectorAll(selector) {
      return String(selector).includes('bili-comment-') ? commentRenderers : [];
    },
    createElement() { return new FakeElement('meta'); },
  };
  let rootWrites = 0;
  document.documentElement.appendChild = () => { rootWrites += 1; };

  class FakeMutationObserver {
    constructor(callback) { this.callback = callback; }
    observe() {}
    disconnect() {}
  }
  class FakeXhr {
    open() {}
    send() {}
  }
  Object.defineProperty(FakeXhr.prototype, 'response', {
    configurable: true,
    get() { return this._response; },
  });

  const chrome = {
    storage: {
      local: {
        async get() { return { ...storageState }; },
        async set(value) { Object.assign(storageState, value); },
      },
      onChanged: { addListener(listener) { storageListeners.push(listener); } },
    },
    runtime: { onMessage: { addListener(listener) { runtimeListeners.push(listener); } } },
  };
  const common = {
    window: windowProxy,
    document,
    location: { origin: 'https://www.bilibili.com', href: 'https://www.bilibili.com/video/BV1TEST', pathname: '/video/BV1TEST', search: '' },
    crypto: webcrypto,
    XMLHttpRequest: FakeXhr,
    MutationObserver: FakeMutationObserver,
    Element: FakeElement,
    Text: FakeText,
    TextDecoder,
    TextEncoder,
    Uint8Array,
    URL,
    Request,
    Headers,
    Response,
    performance,
    setTimeout,
    clearTimeout,
    requestAnimationFrame(callback) { callback(); },
  };
  const page = vm.createContext({ ...common });
  const isolated = vm.createContext({ ...common, chrome });
  const run = (context, file) => new vm.Script(source(file), { filename: file }).runInContext(context);

  run(page, 'core.js');
  run(page, 'page-core.js');
  run(page, 'page-main.js');
  run(isolated, 'content-core.js');
  run(isolated, 'content.js');
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  let status;
  runtimeListeners[0]({ kind: 'get-status' }, null, (value) => { status = value; });
  assert.equal(status.connected, true);
  assert.equal(status.rulesReady, true);
  assert.equal(status.connection.coreReady, true);
  assert.equal(status.connection.bridgeTransport, 'postMessage');
  assert.equal(rootWrites, 0);
  assert.equal(page.__PBP_MAIN_DIAGNOSTIC_V1__.fetchHookInstalled, true);
  assert.equal(page.__PBP_MAIN_DIAGNOSTIC_V1__.xhrHookInstalled, true);

  const firstHomepageItems = [
    ...Array.from({ length: 9 }, (_, index) => ({ goto: 'av', bvid: `BVFIRST${index}`, title: `首批视频 ${index}` })),
    ...Array.from({ length: 3 }, (_, index) => ({ goto: 'ad', title: `广告 ${index}` })),
    { goto: 'bangumi', title: '番剧推广' },
  ];
  const refillHomepageItems = Array.from({ length: 20 }, (_, index) => ({
    goto: 'av', bvid: `BVREFILL${index}`, title: `补充视频 ${index}`,
  }));
  homepageFetchPayloads.push(
    { code: 0, data: { item: firstHomepageItems } },
    { code: 0, data: { item: refillHomepageItems } },
  );
  const homepageResponse = await windowProxy.fetch('https://api.bilibili.com/x/web-interface/wbi/index/top/feed/rcmd?ps=12');
  const homepageJson = await homepageResponse.json();
  assert.equal(page.__PBP_MAIN_DIAGNOSTIC_V1__.homepageResponsesPassedThrough, 1);
  assert.equal(new URL(lastFetchUrl).searchParams.get('ps'), '30');
  assert.equal(homepageJson.data.item.length, 24);
  assert.ok(homepageJson.data.item.every((item) => item.goto === 'av'));
  assert.equal(page.__PBP_MAIN_DIAGNOSTIC_V1__.homepageRequestsExpanded, 1);
  assert.equal(page.__PBP_MAIN_DIAGNOSTIC_V1__.homepageItemsReturned, 24);
  assert.equal(page.__PBP_MAIN_DIAGNOSTIC_V1__.homepageRefillRequests, 1);
  assert.equal(page.__PBP_MAIN_DIAGNOSTIC_V1__.homepageRefillResponses, 1);
  assert.equal(page.__PBP_MAIN_DIAGNOSTIC_V1__.homepageRefillItemsAdded, 15);

  homepageFetchPayloads.push({
    code: 0,
    data: {
      item: Array.from({ length: 24 }, (_, index) => ({
        goto: 'av',
        bvid: `BVBATCH${index}`,
        title: `主动换批 ${index}`,
        pic: `https://example.test/${index}.jpg`,
        duration: 60 + index,
        owner: { mid: 1000 + index, name: `UP ${index}` },
        stat: { view: 10000 + index, danmaku: index },
      })),
    },
  });
  const homepageBatch = await isolated.PiliPlusPurifyContentApi.requestHomepageBatch();
  assert.equal(homepageBatch.length, 24);
  assert.equal(homepageBatch[0].bvid, 'BVBATCH0');
  assert.equal(homepageBatch[0].owner.mid, 1000);
  assert.equal(page.__PBP_MAIN_DIAGNOSTIC_V1__.homepageBatchRequests, 1);
  assert.equal(page.__PBP_MAIN_DIAGNOSTIC_V1__.homepageBatchResponses, 1);
  assert.equal(page.__PBP_MAIN_DIAGNOSTIC_V1__.homepageBatchItems, 24);

  const elem = concat(wireVarint(2, 469291), wireVarint(3, 1), wireBytes(6, 'cbf43926'), wireBytes(7, '点击屏蔽测试'));
  fetchBytes = wireBytes(1, elem);
  await windowProxy.fetch('https://api.bilibili.com/x/v2/dm/wbi/web/seg.so?segment_index=2');
  const sender = await isolated.PiliPlusPurifyContentApi.requestDanmakuSender('点击屏蔽测试', 469291);
  assert.equal(sender.midHash, 'cbf43926');
  assert.equal(sender.ambiguous, false);
  assert.equal(page.__PBP_MAIN_DIAGNOSTIC_V1__.catalogEntries, 1);

  assert.equal(await isolated.PiliPlusPurifyContentApi.addDanmakuTextRule('快速规则', false), true);
  assert.deepEqual(Array.from(isolated.PiliPlusPurifyContentApi.getConfig().danmakuAssistant.gentleRules), ['快速规则']);
  assert.equal(await isolated.PiliPlusPurifyContentApi.addUidHash('83dcefb7'), true);
  assert.deepEqual(Array.from(isolated.PiliPlusPurifyContentApi.getConfig().danmakuRules.uidHashes), ['83dcefb7']);
  assert.equal(await isolated.PiliPlusPurifyContentApi.addMutedUser(123456789, '示例账号'), true);
  assert.equal(isolated.PiliPlusPurifyContentApi.getConfig().mutedUsers[0].mid, 123456789);
  assert.equal(await isolated.PiliPlusPurifyContentApi.toggleMarkedUser(33, '标记示例'), true);
  assert.equal(isolated.PiliPlusPurifyContentApi.getConfig().markedUsers[0].mid, 33);
  isolated.PiliPlusPurifyContentApi.setCommentFoldStatus({
    activePlaceholders: 2,
    revealedRpids: 1,
    created: 3,
    removed: 1,
    rebuilt: 1,
    orphaned: 0,
    routeResets: 0,
  });
  assert.deepEqual(
    Object.fromEntries(Object.entries(isolated.PiliPlusPurifyContentApi.getStatusSnapshot().commentFold).filter(([key]) => key !== 'lastAppliedAt')),
    { activePlaceholders: 2, revealedRpids: 1, created: 3, removed: 1, rebuilt: 1, orphaned: 0, routeResets: 0 },
  );
  isolated.PiliPlusPurifyContentApi.setCommentScoringStatus({
    scored: 12,
    pureMention: 3,
    autoHidden: 2,
    pendingComments: 2,
    pendingAccounts: 1,
    dismissedAccounts: 0,
    panelMounted: true,
    routeResets: 0,
  });
  assert.deepEqual(
    Object.fromEntries(Object.entries(isolated.PiliPlusPurifyContentApi.getStatusSnapshot().commentScoring).filter(([key]) => key !== 'lastAppliedAt')),
    { scored: 12, pureMention: 3, autoHidden: 2, pendingComments: 2, pendingAccounts: 1, dismissedAccounts: 0, panelMounted: true, routeResets: 0 },
  );

  const mainComment = new FakeElement('bili-comment-thread-renderer');
  mainComment.data = {
    rpid_str: '900000000000000001',
    root_str: '0',
    member: { mid: '123456789', uname: '目录用户', level_info: { current_level: 5 } },
    content: { message: '主评论目录测试' },
  };
  const replyComment = new FakeElement('bili-comment-reply-renderer');
  replyComment.data = {
    rpid_str: '900000000000000002',
    root_str: '900000000000000001',
    member: { mid: '123456789', uname: '目录用户' },
    content: { message: '回复目录测试' },
  };
  const delayedComment = new FakeElement('bili-comment-reply-renderer');
  commentRenderers = [mainComment, replyComment, delayedComment];
  assert.equal(isolated.PiliPlusPurifyContentApi.requestCommentCatalog('test', true), true);
  let catalogStatus = isolated.PiliPlusPurifyContentApi.getStatusSnapshot().commentCatalog;
  assert.equal(catalogStatus.comments, 2);
  assert.equal(catalogStatus.mainComments, 1);
  assert.equal(catalogStatus.replies, 1);
  assert.equal(catalogStatus.accounts, 1);
  assert.equal(catalogStatus.pending, 1);
  isolated.PiliPlusPurifyContentApi.registerCommentElement('900000000000000001', mainComment);
  isolated.PiliPlusPurifyContentApi.registerCommentElement('900000000000000002', replyComment);
  assert.deepEqual(
    Array.from(isolated.PiliPlusPurifyContentApi.getMountedCommentRpidsByMid('123456789')),
    ['900000000000000001', '900000000000000002'],
  );
  assert.deepEqual(
    Array.from(isolated.PiliPlusPurifyContentApi.getMountedCommentRecords(), (record) => record.rpid),
    ['900000000000000001', '900000000000000002'],
  );

  setTimeout(() => {
    delayedComment.data = {
      rpid_str: '900000000000000003',
      root_str: '900000000000000001',
      member: { mid: '456789123', uname: '延迟用户' },
      content: { message: '延迟赋值回复' },
    };
  }, 20);
  await new Promise((resolve) => setTimeout(resolve, 100));
  catalogStatus = isolated.PiliPlusPurifyContentApi.getStatusSnapshot().commentCatalog;
  assert.equal(catalogStatus.comments, 3);
  assert.equal(catalogStatus.pending, 0);
  assert.ok(catalogStatus.retries >= 1);

  const remountedMainComment = new FakeElement('bili-comment-thread-renderer');
  remountedMainComment.data = mainComment.data;
  mainComment.isConnected = false;
  isolated.PiliPlusPurifyContentApi.pruneCommentCatalog();
  assert.equal(isolated.PiliPlusPurifyContentApi.getStatusSnapshot().commentCatalog.comments, 2);
  commentRenderers = [remountedMainComment, replyComment, delayedComment];
  assert.equal(isolated.PiliPlusPurifyContentApi.requestCommentCatalog('remount-test', true), true);
  assert.equal(isolated.PiliPlusPurifyContentApi.getStatusSnapshot().commentCatalog.comments, 3);
  isolated.PiliPlusPurifyContentApi.registerCommentElement('900000000000000001', remountedMainComment);

  const resetsBeforeTrackingQuery = isolated.PiliPlusPurifyContentApi.getStatusSnapshot().commentCatalog.routeResets;
  common.location.search = '?spm_id_from=tracking-only';
  common.location.href = 'https://www.bilibili.com/video/BV1TEST?spm_id_from=tracking-only';
  assert.equal(isolated.PiliPlusPurifyContentApi.requestCommentCatalog('query-change-test', true), true);
  catalogStatus = isolated.PiliPlusPurifyContentApi.getStatusSnapshot().commentCatalog;
  assert.equal(catalogStatus.comments, 3);
  assert.equal(catalogStatus.routeResets, resetsBeforeTrackingQuery);

  remountedMainComment.isConnected = false;
  replyComment.isConnected = false;
  delayedComment.isConnected = false;
  commentRenderers = [];
  const resetsBeforeVideoRoute = isolated.PiliPlusPurifyContentApi.getStatusSnapshot().commentCatalog.routeResets;
  common.location.pathname = '/video/BV2NEXT';
  common.location.href = 'https://www.bilibili.com/video/BV2NEXT';
  isolated.PiliPlusPurifyContentApi.resetCommentCatalogForRoute('https://www.bilibili.com/video/BV2NEXT');
  assert.equal(isolated.PiliPlusPurifyContentApi.requestCommentCatalog('route-test', true), true);
  catalogStatus = isolated.PiliPlusPurifyContentApi.getStatusSnapshot().commentCatalog;
  assert.equal(catalogStatus.comments, 0);
  assert.equal(catalogStatus.routeResets, resetsBeforeVideoRoute + 1);

  const hookedFetch = windowProxy.fetch;
  const messageListenerCount = listeners.length;
  run(page, 'core.js');
  run(page, 'page-core.js');
  run(page, 'page-main.js');
  run(isolated, 'content-core.js');
  run(isolated, 'content.js');
  assert.equal(windowProxy.fetch, hookedFetch);
  assert.equal(listeners.length, messageListenerCount);
  assert.equal(runtimeListeners.length, 1);
  assert.equal(storageListeners.length, 1);
});
