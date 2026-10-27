'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const PageCore = require('../src/page-core.js');

function concat(...parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(size);
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

function wireVarint(field, value) {
  return concat(varint(field * 8), varint(value));
}

function wireBytes(field, value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return concat(varint(field * 8 + 2), varint(bytes.length), bytes);
}

function elem(progress, hash, text) {
  return concat(wireVarint(2, progress), wireVarint(3, 1), wireBytes(6, hash), wireBytes(7, text));
}

test('protobuf span filter drops only matched DanmakuElem fields', () => {
  const segment = concat(
    wireBytes(1, elem(469291, 'cbf43926', 'PBP-UID-TEST')),
    wireBytes(1, elem(470000, '83dcefb7', '保留文本')),
    wireBytes(4, Uint8Array.of(8, 1)),
    wireBytes(5, Uint8Array.of(16, 2)),
  );
  const result = PageCore.filterSegment(segment, (_text, hash) => hash === 'cbf43926' ? { kind: 'uid', reason: '账号名单' } : null);
  assert.equal(result.total, 2);
  assert.equal(result.dropped, 1);
  assert.equal(result.hits[0].progress, 469291);
  assert.equal(result.hits[0].content, 'PBP-UID-TEST');
  assert.deepEqual(result.observed, [
    { content: 'PBP-UID-TEST', progress: 469291, midHash: 'cbf43926' },
    { content: '保留文本', progress: 470000, midHash: '83dcefb7' },
  ]);
  const top = PageCore.readFields(result.bytes);
  assert.deepEqual(top.map((field) => field.field), [1, 4, 5]);
  const kept = PageCore.decodeElem(result.bytes.subarray(top[0].valueStart, top[0].end), new TextDecoder());
  assert.equal(kept.text, '保留文本');
});

test('malformed protobuf throws so callers can fail open', () => {
  assert.throws(() => PageCore.filterSegment(Uint8Array.of(0x0a, 0xff), () => null));
});

test('uploader JSON filter covers recommendation, search and dynamic shapes', () => {
  const json = {
    data: {
      item: [
        { bvid: 'BV-blocked', owner: { mid: 100, name: '屏蔽UP' } },
        { bvid: 'BV-kept', owner: { mid: 200, name: '保留UP' } },
      ],
      result: [
        { type: 'video', mid: 100, author: '屏蔽UP', title: '搜索结果' },
        { type: 'video', mid: 300, author: '其他UP', title: '保留结果' },
      ],
      items: [
        { type: 'DYNAMIC_TYPE_AV', modules: { module_author: { mid: 100, name: '屏蔽UP' } } },
        { type: 'DYNAMIC_TYPE_AV', modules: { module_author: { mid: 400, name: '动态UP' } } },
      ],
      unrelatedUsers: [{ mid: 100, name: '不是内容卡片' }],
    },
  };
  const result = PageCore.filterUploaderJson(json, [100]);
  assert.equal(result.dropped, 3);
  assert.deepEqual(result.hits.map((item) => item.mid), [100, 100, 100]);
  assert.deepEqual(json.data.item.map((item) => item.owner.mid), [200]);
  assert.deepEqual(json.data.result.map((item) => item.mid), [300]);
  assert.deepEqual(json.data.items.map((item) => item.modules.module_author.mid), [400]);
  assert.equal(json.data.unrelatedUsers.length, 1);
});

test('advertising filter removes homepage markers and dynamic promotions without touching normal cards', () => {
  const homepage = { data: { item: [{ goto: 'ad', title: '广告' }, { goto: 'av', title: '正常视频' }] } };
  const homeResult = PageCore.filterContentJson(homepage, [], { kind: 'homepage', filterAds: true });
  assert.equal(homeResult.adsDropped, 1);
  assert.deepEqual(homepage.data.item.map((item) => item.title), ['正常视频']);

  const dynamic = { data: { items: [
    { type: 'DYNAMIC_TYPE_DRAW', modules: { module_dynamic: { desc: { text: '限时领券' } } } },
    { type: 'DYNAMIC_TYPE_AV', modules: { module_dynamic: { desc: { text: '普通动态' } } } },
    { type: 'DYNAMIC_TYPE_WORD', modules: { module_dynamic: { additional: { type: 'ADDITIONAL_TYPE_GOODS' } } } },
  ] } };
  const dynamicResult = PageCore.filterContentJson(dynamic, [], { kind: 'dynamic', filterAds: true, keywords: ['领券'] });
  assert.equal(dynamicResult.adsDropped, 2);
  assert.equal(dynamic.data.items.length, 1);
});

test('structured comment data keeps identifiers exact and distinguishes replies', () => {
  const main = PageCore.normalizeCommentData({
    rpid_str: '987654321012345678',
    root_str: '0',
    member: {
      mid: '123456789',
      uname: '结构化用户',
      avatar: 'https://example.test/avatar.jpg',
      sign: '签名',
      level_info: { current_level: 6 },
      official_verify: { type: 0 },
      vip: { vipStatus: 1 },
    },
    content: {
      message: '[doge]主评论',
      at_name_to_mid: { 被提及者: '9988' },
      emote: { '[doge]': { url: 'https://example.test/doge.png' } },
      pictures: [{ img_src: 'https://example.test/comment.jpg' }],
    },
    ctime: 1700000000,
    like: 42,
  }, false);
  assert.equal(main.rpid, '987654321012345678');
  assert.equal(main.mid, '123456789');
  assert.equal(main.root, '0');
  assert.equal(main.isReply, false);
  assert.deepEqual(main.mentions, [{ mid: '9988', name: '被提及者' }]);
  assert.deepEqual(main.emotes, ['[doge]']);
  assert.equal(main.pictureCount, 1);

  const reply = PageCore.normalizeCommentData({
    rpid: 456,
    root: 123,
    member: { mid: 789, uname: '回复用户' },
    content: { message: '楼中楼回复' },
  }, true);
  assert.equal(reply.rpid, '456');
  assert.equal(reply.root, '123');
  assert.equal(reply.mid, '789');
  assert.equal(reply.isReply, true);
  assert.equal(PageCore.normalizeCommentData({ rpid: 1, member: {} }), null);
});
