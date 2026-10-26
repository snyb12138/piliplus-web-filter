(function initPiliPlusPurifyCore(root, factory) {
  const api = factory();
  if (typeof process === 'object' && process?.versions?.node && typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    Object.defineProperty(root, 'PiliPlusPurifyCore', {
      value: api,
      configurable: true,
    });
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function buildCore() {
  'use strict';

  const SCHEMA = 'piliplus-purify';
  const FORMAT_VERSION = 4;
  const EXTENSION_CONFIG_VERSION = 6;
  const UPLOADER_RULES_VERSION = 1;
  const MAX_REGEX_LENGTH = 256;
  const MAX_REGEX_INPUT_LENGTH = 512;
  const SLOW_REGEX_MS = 8;
  const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let crc = i;
      for (let bit = 0; bit < 8; bit += 1) {
        crc = (crc & 1) ? ((crc >>> 1) ^ 0xedb88320) : (crc >>> 1);
      }
      table[i] = crc >>> 0;
    }
    return table;
  })();

  const FORMAT_PATTERNS = Object.freeze({
    dateStamp: /^(?:(?:20\d{2}\s*[年./-]\s*)?\d{1,2}\s*(?:月|[./-])\s*\d{1,2}\s*(?:日|号)?|20\d{2}\s*(?:年|[./-])\s*\d{1,2}\s*月?)(?:\s*(?:[01]?\d|2[0-3])\s*(?:[:时点]\s*[0-5]?\d\s*分?)?)?(?:\s+\d{1,7}\s*人)?(?:\s*(?:前来)?(?:打卡|签到|留名|考古|探访古迹|到此一游))?$/iu,
    timeStamp: /^(?:[01]?\d|2[0-3])\s*(?::|时|点)\s*[0-5]\d\s*分?(?:\s+\d{1,7}\s*人)?(?:\s*(?:打卡|签到|留名))?$/iu,
    peopleCount: /^\d{1,7}\s*人(?:\s*(?:打卡|签到|留名))?$/iu,
    shortCheckIn: /^(?:(?:20\d{2})\s*年?\s*)?(?:前来)?(?:打卡|签到|留名|考古|探访古迹|到此一游)$/iu,
  });

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function safeClone(value, depth = 0) {
    if (depth > 16) return null;
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (Array.isArray(value)) return value.map((item) => safeClone(item, depth + 1));
    if (!isPlainObject(value)) return null;
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key)) continue;
      output[key] = safeClone(item, depth + 1);
    }
    return output;
  }

  function uniqueStrings(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    const output = [];
    for (const item of value) {
      if (typeof item !== 'string') continue;
      const normalized = item.trim();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      output.push(normalized);
    }
    return output;
  }

  function parseMid(value) {
    if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
      value = Number(value.trim());
    }
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  function normalizeUsers(value, diagnostics, label) {
    if (!Array.isArray(value)) return [];
    const byMid = new Map();
    for (let index = 0; index < value.length; index += 1) {
      const raw = value[index];
      if (!isPlainObject(raw)) {
        diagnostics.push({ level: 'warning', code: 'invalid-user', message: `${label}[${index}] 不是对象，已忽略` });
        continue;
      }
      const mid = parseMid(raw.mid);
      if (mid === null) {
        diagnostics.push({ level: 'warning', code: 'invalid-user-mid', message: `${label}[${index}] 的 UID 无效，已忽略` });
        continue;
      }
      const extras = safeClone(raw);
      delete extras.mid;
      delete extras.name;
      const name = typeof raw.name === 'string' ? raw.name.trim() : '';
      byMid.set(mid, { ...extras, mid, ...(name ? { name } : {}) });
    }
    return [...byMid.values()].sort((a, b) => a.mid - b.mid);
  }

  function crc32Text(text) {
    let crc = 0xffffffff;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      if (code > 0x7f) throw new TypeError('CRC32 UID 输入必须是 ASCII 十进制数字');
      crc = ((crc >>> 8) ^ CRC_TABLE[(crc ^ code) & 0xff]) >>> 0;
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function crc32Uid(uid) {
    const parsed = parseMid(uid);
    if (parsed === null) throw new TypeError('UID 必须是正安全整数');
    return crc32Text(String(parsed)).toString(16).padStart(8, '0');
  }

  function normalizeUidHash(value) {
    if (typeof value !== 'string') return null;
    let text = value.trim().toLowerCase();
    if (text.startsWith('0x')) text = text.slice(2);
    if (!/^[0-9a-f]{1,8}$/.test(text)) return null;
    return Number.parseInt(text, 16).toString(16).padStart(8, '0');
  }

  function normalizeHashes(value, diagnostics) {
    if (!Array.isArray(value)) return [];
    const hashes = new Set();
    value.forEach((item, index) => {
      const hash = normalizeUidHash(item);
      if (hash) hashes.add(hash);
      else diagnostics.push({ level: 'warning', code: 'invalid-uid-hash', message: `uidHashes[${index}] 格式无效，已忽略` });
    });
    return [...hashes].sort();
  }

  function validateRegex(pattern) {
    if (typeof pattern !== 'string') return { ok: false, reason: '规则不是字符串' };
    const text = pattern.trim();
    if (!text) return { ok: false, reason: '规则为空' };
    if (text.length > MAX_REGEX_LENGTH) return { ok: false, reason: `规则超过 ${MAX_REGEX_LENGTH} 个字符` };
    if (/\\(?:[1-9]|k<)/u.test(text)) return { ok: false, reason: '原型暂不允许反向引用' };
    if (/\(\?<([=!])/u.test(text)) return { ok: false, reason: '原型暂不允许后行断言' };
    if (/(?:\.\*|\.\+).*(?:\.\*|\.\+)/u.test(text)) return { ok: false, reason: '包含多个高风险通配重复结构' };
    if (/\((?:\\.|\[[^\]]*\]|[^()])*[+*](?:\\.|\[[^\]]*\]|[^()])*\)\s*(?:[+*]|\{\d*,?\d*\})/u.test(text)) {
      return { ok: false, reason: '包含嵌套重复量词，可能导致灾难性回溯' };
    }
    try {
      return { ok: true, pattern: text, regexp: new RegExp(text, 'iu') };
    } catch (error) {
      return { ok: false, reason: `无法编译：${error.message}` };
    }
  }

  function normalizeConfig(rawInput) {
    const diagnostics = [];
    if (!isPlainObject(rawInput)) throw new FormatError('配置根节点必须是对象');
    const sanitized = safeClone(rawInput);
    const nestedReply = isPlainObject(sanitized.replyPurify) ? sanitized.replyPurify : null;
    if (nestedReply && !Array.isArray(nestedReply.mutedUsers)) {
      throw new FormatError('replyPurify 缺少 mutedUsers 列表');
    }
    if (!nestedReply && !Array.isArray(sanitized.mutedUsers)) {
      throw new FormatError('缺少 mutedUsers 列表');
    }

    const base = nestedReply ? { ...sanitized, ...nestedReply } : { ...sanitized };
    delete base.replyPurify;
    const sourceVersion = Number.isInteger(base.version) ? base.version : null;
    if (sourceVersion !== null && sourceVersion > FORMAT_VERSION) {
      diagnostics.push({ level: 'warning', code: 'future-version', message: `文件版本 ${sourceVersion} 高于当前支持的 ${FORMAT_VERSION}，已尽力解析` });
    }

    const assistantRaw = isPlainObject(base.danmakuAssistant) ? base.danmakuAssistant : Object.create(null);
    const rulesRaw = isPlainObject(base.danmakuRules) ? base.danmakuRules : Object.create(null);
    const uploaderRaw = isPlainObject(base.uploaderRules) ? base.uploaderRules : Object.create(null);
    const extensionRaw = isPlainObject(base.browserExtension) ? base.browserExtension : Object.create(null);
    const adFilterRaw = isPlainObject(extensionRaw.adFilter) ? extensionRaw.adFilter : Object.create(null);

    const config = {
      ...base,
      schema: SCHEMA,
      version: FORMAT_VERSION,
      mutedUsers: normalizeUsers(base.mutedUsers, diagnostics, 'mutedUsers'),
      aiFilterLevel: typeof base.aiFilterLevel === 'string' ? base.aiFilterLevel : 'off',
      trustedAiUsers: normalizeUsers(base.trustedAiUsers || [], diagnostics, 'trustedAiUsers'),
      markedUsers: normalizeUsers(base.markedUsers || [], diagnostics, 'markedUsers'),
      centerMode: typeof base.centerMode === 'string' ? base.centerMode : 'expanded',
      replyKeywordPattern: typeof base.replyKeywordPattern === 'string' ? base.replyKeywordPattern : '',
      danmakuAssistant: {
        ...assistantRaw,
        version: 1,
        absoluteRules: uniqueStrings(assistantRaw.absoluteRules),
        gentleRules: uniqueStrings(assistantRaw.gentleRules),
        blockDateStamps: assistantRaw.blockDateStamps === true,
        blockTimeStamps: assistantRaw.blockTimeStamps === true,
        blockPeopleCounts: assistantRaw.blockPeopleCounts === true,
        blockShortCheckIns: assistantRaw.blockShortCheckIns === true,
      },
      danmakuRules: {
        ...rulesRaw,
        keywords: uniqueStrings(rulesRaw.keywords),
        regex: uniqueStrings(rulesRaw.regex),
        uidHashes: normalizeHashes(rulesRaw.uidHashes, diagnostics),
      },
      uploaderRules: {
        ...uploaderRaw,
        version: UPLOADER_RULES_VERSION,
        users: normalizeUsers(uploaderRaw.users || [], diagnostics, 'uploaderRules.users'),
      },
      browserExtension: {
        ...extensionRaw,
        version: EXTENSION_CONFIG_VERSION,
        enabled: extensionRaw.enabled !== false,
        hideHomepageCarousel: extensionRaw.hideHomepageCarousel !== false,
        homepagePagedMode: extensionRaw.homepagePagedMode !== false,
        videoPageDomEnhancements: extensionRaw.videoPageDomEnhancements === true,
        adFilter: {
          ...adFilterRaw,
          enabled: adFilterRaw.enabled !== false,
          homepage: adFilterRaw.homepage !== false,
          dynamic: adFilterRaw.dynamic !== false,
          video: adFilterRaw.video !== false,
          remoteKeywordsEnabled: adFilterRaw.remoteKeywordsEnabled !== false,
          customKeywords: uniqueStrings(adFilterRaw.customKeywords),
        },
      },
    };

    return { config, diagnostics };
  }

  function parseConfigText(text) {
    let raw;
    try {
      raw = JSON.parse(text);
    } catch (error) {
      throw new FormatError(`JSON 无法解析：${error.message}`);
    }
    return normalizeConfig(raw);
  }

  function buildRuntimeRules(configInput, supplemental = {}) {
    const { config, diagnostics } = normalizeConfig(configInput);
    const mutedUidHashes = new Set(config.mutedUsers.map((user) => crc32Uid(user.mid)));
    const legacyUidHashes = new Set();
    for (const hash of config.danmakuRules.uidHashes) {
      if (!mutedUidHashes.has(hash)) legacyUidHashes.add(hash);
    }
    const regex = [];
    const disabledRegex = [];
    config.danmakuRules.regex.forEach((pattern, index) => {
      const result = validateRegex(pattern);
      if (result.ok) regex.push(result.pattern);
      else {
        const entry = { index, pattern, reason: result.reason };
        disabledRegex.push(entry);
        diagnostics.push({ level: 'warning', code: 'disabled-regex', message: `正则“${pattern}”已停用：${result.reason}` });
      }
    });
    const adFilter = config.browserExtension.adFilter;
    const remoteAdKeywords = adFilter.remoteKeywordsEnabled ? uniqueStrings(supplemental.adKeywords) : [];
    const adKeywords = uniqueStrings([...remoteAdKeywords, ...adFilter.customKeywords]);
    return {
      enabled: config.browserExtension.enabled,
      mutedUidHashes: [...mutedUidHashes],
      legacyUidHashes: [...legacyUidHashes],
      absoluteRules: config.danmakuAssistant.absoluteRules,
      gentleRules: config.danmakuAssistant.gentleRules,
      formatRules: {
        dateStamp: config.danmakuAssistant.blockDateStamps,
        timeStamp: config.danmakuAssistant.blockTimeStamps,
        peopleCount: config.danmakuAssistant.blockPeopleCounts,
        shortCheckIn: config.danmakuAssistant.blockShortCheckIns,
      },
      keywords: config.danmakuRules.keywords,
      regex,
      disabledRegex,
      blockedUploaders: config.uploaderRules.users,
      adFilter: {
        enabled: adFilter.enabled,
        homepage: adFilter.homepage,
        dynamic: adFilter.dynamic,
        video: adFilter.video,
        keywords: adKeywords,
      },
      diagnostics,
    };
  }

  function compileRuntimeMatcher(runtime, onDiagnostic) {
    const muted = new Set(runtime.mutedUidHashes || []);
    const legacy = new Set(runtime.legacyUidHashes || []);
    const gentle = new Set(runtime.gentleRules || []);
    const absolute = runtime.absoluteRules || [];
    const keywords = runtime.keywords || [];
    const compiled = (runtime.regex || []).map((pattern) => ({ pattern, regexp: new RegExp(pattern, 'iu'), disabled: false }));
    const emit = typeof onDiagnostic === 'function' ? onDiagnostic : () => {};

    return function matchDanmaku(content, rawHash) {
      if (!runtime.enabled || typeof content !== 'string') return null;
      const hash = normalizeUidHash(rawHash || '');
      if (hash && muted.has(hash)) return { kind: 'uid', reason: '账号屏蔽名单' };
      if (hash && legacy.has(hash)) return { kind: 'uidHash', reason: '历史 UID 哈希规则' };

      const normalized = content.trim();
      for (const rule of absolute) {
        if (normalized.includes(rule)) return { kind: 'absolute', reason: `绝对屏蔽：包含“${rule}”`, rule };
      }
      if (gentle.has(normalized)) return { kind: 'gentle', reason: `温和屏蔽：整条等于“${normalized}”`, rule: normalized };
      if (runtime.formatRules?.dateStamp && FORMAT_PATTERNS.dateStamp.test(normalized)) return { kind: 'dateStamp', reason: '日期/日期打卡格式' };
      if (runtime.formatRules?.timeStamp && FORMAT_PATTERNS.timeStamp.test(normalized)) return { kind: 'timeStamp', reason: '时间打卡格式' };
      if (runtime.formatRules?.peopleCount && FORMAT_PATTERNS.peopleCount.test(normalized)) return { kind: 'peopleCount', reason: '纯人数刷屏格式' };
      if (runtime.formatRules?.shortCheckIn && FORMAT_PATTERNS.shortCheckIn.test(normalized)) return { kind: 'shortCheckIn', reason: '短打卡/考古格式' };
      for (const rule of keywords) {
        if (content.includes(rule)) return { kind: 'keyword', reason: `关键词：包含“${rule}”`, rule };
      }

      if (content.length > MAX_REGEX_INPUT_LENGTH) return null;
      for (const item of compiled) {
        if (item.disabled) continue;
        const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
        try {
          const hit = item.regexp.test(content);
          const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started;
          if (elapsed > SLOW_REGEX_MS) {
            item.disabled = true;
            emit({ level: 'warning', code: 'slow-regex', message: `正则“${item.pattern}”单次匹配耗时 ${elapsed.toFixed(1)}ms，已在本次页面停用` });
          }
          if (hit) return { kind: 'regex', reason: `正则：/${item.pattern}/i`, rule: item.pattern };
        } catch (error) {
          item.disabled = true;
          emit({ level: 'warning', code: 'runtime-regex', message: `正则“${item.pattern}”运行失败并已停用：${error.message}` });
        }
      }
      return null;
    };
  }

  function exportConfig(config) {
    return `${JSON.stringify(normalizeConfig(config).config, null, 2)}\n`;
  }

  function defaultConfig() {
    return normalizeConfig({ mutedUsers: [] }).config;
  }

  class FormatError extends Error {
    constructor(message) {
      super(message);
      this.name = 'FormatError';
    }
  }

  return Object.freeze({
    SCHEMA,
    FORMAT_VERSION,
    MAX_REGEX_LENGTH,
    MAX_REGEX_INPUT_LENGTH,
    FormatError,
    safeClone,
    parseMid,
    crc32Text,
    crc32Uid,
    normalizeUidHash,
    validateRegex,
    normalizeConfig,
    parseConfigText,
    buildRuntimeRules,
    compileRuntimeMatcher,
    exportConfig,
    defaultConfig,
  });
});
