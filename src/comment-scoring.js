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
    let emoteWorking = working;
    let structuredEmoteCount = 0;
    const emoteTokens = [...new Set((Array.isArray(comment?.emotes) ? comment.emotes : [])
      .map((token) => String(token || '').trim())
      .filter(Boolean))]
      .sort((left, right) => right.length - left.length);
    for (const token of emoteTokens) {
      const pattern = new RegExp(escapeRegExp(token), 'gu');
      emoteWorking = emoteWorking.replace(pattern, () => {
        structuredEmoteCount += 1;
        return ' ';
      });
    }
    const residualText = working.replace(/[\p{White_Space}\p{Punctuation}]/gu, '');
    const isPureMention = mentionCount > 0 && residualText.length === 0;
    const informativeLength = [...residualText].length;
    const emoteResidual = emoteWorking.replace(/[\p{White_Space}\p{Punctuation}]/gu, '');
    const unicodeEmojiResidual = emoteResidual
      .replace(/[0-9#*]\ufe0f?\u20e3/gu, '')
      .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\u200d\ufe0e\ufe0f]/gu, '');
    const pictureCount = Math.max(0, Number(comment?.pictureCount) || 0);
    const hasUnicodeEmoji = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u.test(emoteResidual);
    const isEmoteOnly = !isPureMention && (
      (structuredEmoteCount > 0 && emoteResidual.length === 0) ||
      (hasUnicodeEmoji && unicodeEmojiResidual.length === 0) ||
      (pictureCount > 0 && residualText.length === 0)
    );
    const isShort = !isPureMention && informativeLength < 5;
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
    if (isShort) evidence.push({ code: 'short-comment', points: 2, detail: `有效正文仅 ${informativeLength} 个字符` });
    if (isEmoteOnly) evidence.push({ code: 'emote-only', points: 2, detail: '正文仅包含表情或图片表情' });
    const pendingReasons = [];
    if (isPureMention && mentionCount >= 2) pendingReasons.push('多重纯@');
    if (isShort) pendingReasons.push('短评论');
    if (isEmoteOnly) pendingReasons.push('纯表情');
    return Object.freeze({
      density,
      suspiciousScore: evidence.reduce((sum, item) => sum + item.points, 0),
      evidence: Object.freeze(evidence),
      residualText,
      mentionCount,
      distinctMentions: mentionNames.length,
      informativeLength,
      structuredEmoteCount,
      pictureCount,
      isPureMention,
      isShort,
      isEmoteOnly,
      pendingReasons: Object.freeze(pendingReasons),
      pendingReview: pendingReasons.length > 0,
    });
  }

  return Object.freeze({ analyzeComment });
});
