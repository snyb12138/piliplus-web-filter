(function initPiliPlusCommentScoring(root, factory) {
  const api = factory();
  if (typeof process === 'object' && process?.versions?.node && typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    Object.defineProperty(root, 'PiliPlusPurifyCommentScoring', {
      value: api,
      configurable: true,
    });
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function buildCommentScoring() {
  'use strict';

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  }

  function analyzeComment(comment) {
    const text = String(comment?.text || '');
    const mentionNames = [...new Set((Array.isArray(comment?.mentions) ? comment.mentions : [])
      .map((mention) => String(mention?.name || '').trim())
      .filter(Boolean))]
      .sort((left, right) => right.length - left.length);
    let working = text.trim();
    if (/^回复\s*@/u.test(working)) working = working.replace(/^回复\s*/u, '');
    let mentionCount = 0;
    for (const name of mentionNames) {
      const pattern = new RegExp(`@${escapeRegExp(name)}`, 'gu');
      working = working.replace(pattern, () => {
        mentionCount += 1;
        return ' ';
      });
    }
    const residualText = working.replace(/[\p{White_Space}\p{Punctuation}]/gu, '');
    const isPureMention = mentionCount > 0 && residualText.length === 0;
    const informativeLength = [...residualText].length;
    const density = isPureMention
      ? 0
      : Math.min(100, Math.round((informativeLength / Math.max(1, informativeLength + mentionCount * 4)) * 100));
    const evidence = [];
    if (isPureMention) {
      evidence.push({
        code: mentionCount >= 2 ? 'multiple-pure-mentions' : 'single-pure-mention',
        points: mentionCount >= 2 ? 5 : 4,
        detail: `正文仅包含 ${mentionCount} 次真实提及`,
      });
    }
    return Object.freeze({
      density,
      suspiciousScore: evidence.reduce((sum, item) => sum + item.points, 0),
      evidence: Object.freeze(evidence),
      residualText,
      mentionCount,
      distinctMentions: mentionNames.length,
      isPureMention,
      pendingReview: isPureMention && mentionCount >= 2,
    });
  }

  return Object.freeze({ analyzeComment });
});
