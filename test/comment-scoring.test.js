'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Scoring = require('../src/comment-scoring.js');

function analyze(text, mentions) {
  return Scoring.analyzeComment({ text, mentions: mentions.map(([name, mid], index) => ({ name, mid: mid || String(index + 1) })) });
}

test('a structured single pure mention is hidden conservatively but not queued', () => {
  const result = analyze('@甲 ', [['甲']]);
  assert.equal(result.isPureMention, true);
  assert.equal(result.mentionCount, 1);
  assert.equal(result.pendingReview, false);
  assert.equal(result.density, 0);
  assert.equal(result.suspiciousScore, 4);
});

test('two or more real mention occurrences enter pending review', () => {
  const result = analyze('@甲，@乙！@甲', [['甲'], ['乙']]);
  assert.equal(result.isPureMention, true);
  assert.equal(result.mentionCount, 3);
  assert.equal(result.distinctMentions, 2);
  assert.equal(result.pendingReview, true);
  assert.equal(result.evidence[0].code, 'multiple-pure-mentions');
});

test('reply prefix and punctuation do not add information', () => {
  const result = analyze('回复 @甲：@乙。', [['甲'], ['乙']]);
  assert.equal(result.isPureMention, true);
  assert.equal(result.pendingReview, true);
});

test('meaningful text or unverified at-text is never auto-hidden', () => {
  const meaningful = analyze('@甲 谢谢你的说明', [['甲']]);
  assert.equal(meaningful.isPureMention, false);
  assert.equal(meaningful.pendingReview, false);
  assert.ok(meaningful.density > 0);

  const unverified = analyze('@陌生账号', []);
  assert.equal(unverified.isPureMention, false);
  assert.equal(unverified.mentionCount, 0);
});

test('emoji remains information and prevents pure-mention hiding', () => {
  const result = analyze('@甲 👍', [['甲']]);
  assert.equal(result.isPureMention, false);
  assert.equal(result.residualText, '👍');
  assert.equal(result.isEmoteOnly, true);
  assert.equal(result.pendingReview, true);
});

test('comments with fewer than five effective characters enter review', () => {
  const short = analyze(' 好！的。 ', []);
  assert.equal(short.informativeLength, 2);
  assert.equal(short.isShort, true);
  assert.deepEqual(short.pendingReasons, ['短评论']);

  const boundary = analyze('刚好五个字', []);
  assert.equal(boundary.informativeLength, 5);
  assert.equal(boundary.isShort, false);
  assert.equal(boundary.pendingReview, false);
});

test('structured Bilibili emotes, unicode emoji and picture comments are detected', () => {
  const structured = Scoring.analyzeComment({ text: '[doge][笑哭]', mentions: [], emotes: ['[doge]', '[笑哭]'] });
  assert.equal(structured.isEmoteOnly, true);
  assert.ok(structured.pendingReasons.includes('纯表情'));

  const unicode = Scoring.analyzeComment({ text: '👨‍👩‍👧‍👦 🇨🇳 1️⃣', mentions: [] });
  assert.equal(unicode.isEmoteOnly, true);

  const picture = Scoring.analyzeComment({ text: '', mentions: [], pictureCount: 1 });
  assert.equal(picture.isEmoteOnly, true);
  assert.equal(picture.pendingReview, true);
});
