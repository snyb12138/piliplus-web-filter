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
    this.dataset = {};
    this.style = { setProperty() {}, removeProperty() {} };
    this.textContent = '';
  }
  matches() { return false; }
  querySelectorAll() { return []; }
}

class FakeText {}

test('MAIN and isolated worlds complete the token/rule handshake and reinjection is idempotent', async () => {
  const listeners = [];
  const runtimeListeners = [];
  const storageListeners = [];
  const storageState = {};
  let fetchBytes = new Uint8Array();
  const windowProxy = {
    fetch: async () => new Response(fetchBytes),
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
    location: { origin: 'https://www.bilibili.com', href: 'https://www.bilibili.com/video/BV1TEST', pathname: '/video/BV1TEST' },
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
