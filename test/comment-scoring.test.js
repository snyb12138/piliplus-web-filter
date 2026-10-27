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
});
