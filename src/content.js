(() => {
  'use strict';

  const MARKER_NAME = '__PBP_CONTENT_DIAGNOSTIC_V1__';
  if (globalThis[MARKER_NAME]?.active) {
    try {
      delete globalThis.PiliPlusPurifyCore;
    } catch (_) {
      // Existing content script remains active.
    }
    return;
  }
  const connection = {
    active: false,
    loadedAt: new Date().toISOString(),
    coreReady: false,
    tokenFound: false,
    bridgeRequests: 0,
    bridgeConnectedAt: null,
    storageReadAt: null,
    rulesSentAt: null,
    rulesReadyAt: null,
    lastPageMessageAt: null,
    domFallbackReady: false,
    failure: null,
  };
  Object.defineProperty(globalThis, MARKER_NAME, { value: connection, configurable: true });

  const Core = globalThis.PiliPlusPurifyCore;
  if (!Core) {
    connection.failure = 'core-missing';
    return;
  }
  connection.active = true;
  connection.coreReady = true;

  const CHANNEL = 'piliplus-purify-browser';
  const TOKEN_META_NAME = 'piliplus-purify-bridge-token';
  const STORAGE_KEY = 'purifyConfig';
  const AD_RULES_KEY = 'adRuleCache';
  const MAX_HITS = 80;
  const MAX_DIAGNOSTICS = 60;
  let token = null;
  let config = Core.defaultConfig();
  let runtime = Core.buildRuntimeRules(config);
  let domMatcher = Core.compileRuntimeMatcher(runtime, recordDiagnostic);
  let senderRequestSeq = 0;
  const pendingSenderRequests = new Map();
  const diagnosticLastSeen = new Map();
  const status = {
    connected: false,
    rulesReady: false,
    segments: 0,
    totalDanmaku: 0,
    blocked: 0,
    reasons: Object.create(null),
    hits: [],
    diagnostics: [],
    counts: Object.create(null),
    layout: {
      hideHomepageCarousel: true,
      preferenceEnabled: true,
      onHomepage: false,
      carouselFound: false,
      hiddenElements: 0,
      emptySlotsHidden: 0,
      lastAppliedAt: null,
    },
    interaction: {
      danmakuMenus: 0,
      danmakuTextRulesAdded: 0,
      danmakuSendersAdded: 0,
      commentButtons: 0,
      commentUsersBlocked: 0,
      commentUsersMarked: 0,
      uploaderButtons: 0,
      uploaderUsersBlocked: 0,
      uploaderCardsHidden: 0,
      uploaderApiDropped: 0,
      adsDomHidden: 0,
      adsApiDropped: 0,
    },
  };

  function post(kind, payload = {}) {
    if (!token) return;
    window.postMessage({ __pbp: true, channel: CHANNEL, direction: 'extension-to-page', token, kind, ...payload }, location.origin);
  }

  function requestBridge() {
    connection.bridgeRequests += 1;
    window.postMessage({ __pbp: true, channel: CHANNEL, direction: 'extension-to-page', kind: 'bridge-request' }, location.origin);
  }

  function recordDiagnostic(entry) {
    if (!entry || typeof entry.message !== 'string') return;
    const key = `${entry.code || 'unknown'}:${entry.message}`;
    const now = Date.now();
    if ((diagnosticLastSeen.get(key) || 0) + 60_000 > now) return;
    diagnosticLastSeen.set(key, now);
    status.diagnostics.unshift({ ...entry, at: new Date(now).toISOString() });
    status.diagnostics.splice(MAX_DIAGNOSTICS);
  }

  function applyNormalizedConfig(normalized, adRuleCache = {}) {
    config = normalized.config;
    normalized.diagnostics.forEach(recordDiagnostic);
    runtime = Core.buildRuntimeRules(config, { adKeywords: adRuleCache.keywords || [] });
    runtime.diagnostics.forEach(recordDiagnostic);
    domMatcher = Core.compileRuntimeMatcher(runtime, recordDiagnostic);
    connection.rulesSentAt = new Date().toISOString();
    post('set-rules', { runtime });
    Promise.resolve().then(recheckDomDanmaku);
    if (typeof window.dispatchEvent === 'function' && typeof Event === 'function') {
      window.dispatchEvent(new Event('pbp-config-changed'));
    }
  }

  async function loadRules() {
    const stored = await chrome.storage.local.get([STORAGE_KEY, AD_RULES_KEY]);
    connection.storageReadAt = new Date().toISOString();
    const normalized = stored[STORAGE_KEY] ? Core.normalizeConfig(stored[STORAGE_KEY]) : { config: Core.defaultConfig(), diagnostics: [] };
    if (!stored[STORAGE_KEY]) await chrome.storage.local.set({ [STORAGE_KEY]: normalized.config });
    applyNormalizedConfig(normalized, stored[AD_RULES_KEY]);
  }

  async function mutateConfig(mutator) {
    const stored = await chrome.storage.local.get([STORAGE_KEY, AD_RULES_KEY]);
    const current = stored[STORAGE_KEY] ? Core.normalizeConfig(stored[STORAGE_KEY]).config : Core.defaultConfig();
    const draft = Core.safeClone(current);
    const outcome = mutator(draft);
    const normalized = Core.normalizeConfig(draft);
    applyNormalizedConfig(normalized, stored[AD_RULES_KEY]);
    await chrome.storage.local.set({ [STORAGE_KEY]: normalized.config });
    return { config: normalized.config, outcome };
  }

  function requestDanmakuSender(content, currentMs) {
    if (!token || typeof content !== 'string' || !content.trim()) return Promise.resolve(null);
    const id = ++senderRequestSeq;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (pendingSenderRequests.delete(id)) resolve(null);
      }, 800);
      pendingSenderRequests.set(id, { resolve, timer });
      post('resolve-danmaku-sender', { id, content: content.trim(), currentMs });
    });
  }

  function acquireToken() {
    const meta = document.querySelector(`meta[name="${TOKEN_META_NAME}"]`);
    if (!meta || !/^[0-9a-f]{32}$/u.test(meta.content)) return false;
    token = meta.content;
    meta.remove();
    status.connected = true;
    connection.tokenFound = true;
    connection.bridgeConnectedAt = new Date().toISOString();
    connection.failure = null;
    loadRules().catch((error) => recordDiagnostic({ level: 'error', code: 'load-rules', message: `读取规则失败：${error.message}` }));
    return true;
  }

  window.addEventListener('message', (event) => {
    const packet = event.data;
    if (event.source !== window || packet?.__pbp !== true || packet.channel !== CHANNEL || packet.direction !== 'page-to-extension' || packet.token !== token) return;
    connection.lastPageMessageAt = new Date().toISOString();
    if (packet.kind === 'rules-ready') {
      status.rulesReady = true;
      connection.rulesReadyAt = new Date().toISOString();
      status.counts = packet.counts || Object.create(null);
    } else if (packet.kind === 'segment-result') {
      status.segments += 1;
      status.totalDanmaku += Number(packet.total) || 0;
      status.blocked += Number(packet.dropped) || 0;
      for (const hit of packet.hits || []) {
        const reasonKey = hit.kind || 'unknown';
        status.reasons[reasonKey] = (status.reasons[reasonKey] || 0) + 1;
        status.hits.unshift({ ...hit, source: 'data', at: new Date().toISOString() });
      }
      status.hits.splice(MAX_HITS);
    } else if (packet.kind === 'diagnostic') {
      recordDiagnostic(packet.entry);
    } else if (packet.kind === 'content-filter-result') {
      status.interaction.uploaderApiDropped += Number(packet.uploaderDropped) || 0;
      status.interaction.adsApiDropped += Number(packet.adsDropped) || 0;
    } else if (packet.kind === 'danmaku-sender-result') {
      const pending = pendingSenderRequests.get(packet.id);
      if (pending) {
        pendingSenderRequests.delete(packet.id);
        clearTimeout(pending.timer);
        pending.resolve(packet.result || null);
      }
    }
  });

  if (!acquireToken()) {
    const tokenObserver = new MutationObserver(() => {
      if (acquireToken()) tokenObserver.disconnect();
    });
    tokenObserver.observe(document, { childList: true, subtree: true });
    requestBridge();
    setTimeout(() => {
      if (!token) requestBridge();
    }, 500);
    setTimeout(() => {
      tokenObserver.disconnect();
      if (!token) {
        connection.failure = 'bridge-timeout';
        recordDiagnostic({ level: 'error', code: 'bridge-timeout', message: '页面数据层桥接超时，已仅启用 DOM 兜底' });
      }
    }, 3000);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes[STORAGE_KEY] || changes[AD_RULES_KEY])) {
      loadRules().catch((error) => recordDiagnostic({ level: 'error', code: 'reload-rules', message: `更新规则失败：${error.message}` }));
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.kind === 'get-status') {
      sendResponse({ ...status, enabled: runtime.enabled, connection: { ...connection } });
      return false;
    }
    if (message?.kind === 'reset-stats') {
      status.segments = 0;
      status.totalDanmaku = 0;
      status.blocked = 0;
      status.reasons = Object.create(null);
      status.hits = [];
      status.diagnostics = [];
      for (const key of Object.keys(status.interaction)) status.interaction[key] = 0;
      sendResponse({ ok: true });
      return false;
    }
    if (message?.kind === 'reload-rules') {
      loadRules().then(() => sendResponse({ ok: true }), (error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    if (message?.kind === 'reconnect-bridge') {
      const alreadyConnected = Boolean(token);
      if (!alreadyConnected) requestBridge();
      sendResponse({ ok: true, alreadyConnected });
      return false;
    }
    return false;
  });

  const DOM_SELECTOR = '.bili-danmaku-x-dm, .bilibili-player-video-danmaku .danmaku-item, .bpx-player-dm-wrap .bili-dm';
  function inspectDomNode(node, force = false) {
    if (node instanceof Text) node = node.parentElement;
    if (!(node instanceof Element)) return;
    const candidates = node.matches(DOM_SELECTOR) ? [node] : [...node.querySelectorAll(DOM_SELECTOR)];
    for (const element of candidates) {
      const content = (element.textContent || '').trim();
      if (!force && element.dataset.pbpCheckedText === content) continue;
      element.dataset.pbpCheckedText = content;
      if (element.dataset.pbpBlocked === '1') {
        element.style.removeProperty('display');
        delete element.dataset.pbpBlocked;
      }
      const match = content ? domMatcher(content, '') : null;
      if (!match) continue;
      element.style.setProperty('display', 'none', 'important');
      element.dataset.pbpBlocked = '1';
      status.blocked += 1;
      status.reasons[match.kind] = (status.reasons[match.kind] || 0) + 1;
      status.hits.unshift({ content, progress: null, reason: match.reason, kind: match.kind, source: 'dom', at: new Date().toISOString() });
      status.hits.splice(MAX_HITS);
    }
  }

  function recheckDomDanmaku() {
    if (!document.documentElement) return;
    inspectDomNode(document.documentElement, true);
  }

  function startDomFallback() {
    if (!document.documentElement) {
      requestAnimationFrame(startDomFallback);
      return;
    }
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'characterData') inspectDomNode(record.target);
        for (const node of record.addedNodes) inspectDomNode(node);
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    connection.domFallbackReady = true;
  }
  startDomFallback();

  const interactionApi = Object.freeze({
    DOM_SELECTOR,
    getConfig: () => config,
    getAdFilter: () => runtime.adFilter || { enabled: false, keywords: [] },
    requestDanmakuSender,
    record(name, delta = 1) {
      if (Object.hasOwn(status.interaction, name)) status.interaction[name] += delta;
    },
    setLayoutStatus(next) {
      if (!next || typeof next !== 'object') return;
      status.layout = {
        ...status.layout,
        hideHomepageCarousel: next.hideHomepageCarousel === true,
        preferenceEnabled: next.preferenceEnabled === true,
        onHomepage: next.onHomepage === true,
        carouselFound: next.carouselFound === true,
        hiddenElements: Number(next.hiddenElements) || 0,
        emptySlotsHidden: Number(next.emptySlotsHidden) || 0,
        lastAppliedAt: new Date().toISOString(),
      };
    },
    async addDanmakuTextRule(content, absolute) {
      const value = String(content || '').trim();
      if (!value) return false;
      const result = await mutateConfig((draft) => {
        const key = absolute ? 'absoluteRules' : 'gentleRules';
        const rules = draft.danmakuAssistant[key];
        if (rules.includes(value)) return false;
        rules.push(value);
        return true;
      });
      if (result.outcome) status.interaction.danmakuTextRulesAdded += 1;
      return result.outcome;
    },
    async removeDanmakuTextRule(content, absolute) {
      const value = String(content || '').trim();
      const result = await mutateConfig((draft) => {
        const key = absolute ? 'absoluteRules' : 'gentleRules';
        const before = draft.danmakuAssistant[key].length;
        draft.danmakuAssistant[key] = draft.danmakuAssistant[key].filter((item) => item !== value);
        return draft.danmakuAssistant[key].length !== before;
      });
      return result.outcome;
    },
    async addUidHash(rawHash) {
      const hash = Core.normalizeUidHash(rawHash || '');
      if (!hash) return false;
      const result = await mutateConfig((draft) => {
        if (draft.danmakuRules.uidHashes.includes(hash)) return false;
        draft.danmakuRules.uidHashes.push(hash);
        return true;
      });
      if (result.outcome) status.interaction.danmakuSendersAdded += 1;
      return result.outcome;
    },
    async removeUidHash(rawHash) {
      const hash = Core.normalizeUidHash(rawHash || '');
      if (!hash) return false;
      const result = await mutateConfig((draft) => {
        const before = draft.danmakuRules.uidHashes.length;
        draft.danmakuRules.uidHashes = draft.danmakuRules.uidHashes.filter((item) => Core.normalizeUidHash(item) !== hash);
        return draft.danmakuRules.uidHashes.length !== before;
      });
      return result.outcome;
    },
    async addMutedUser(mid, name = '') {
      const parsed = Core.parseMid(mid);
      if (parsed === null) return false;
      const result = await mutateConfig((draft) => {
        if (draft.mutedUsers.some((user) => Core.parseMid(user.mid) === parsed)) return false;
        draft.mutedUsers.push({ mid: parsed, ...(String(name).trim() ? { name: String(name).trim() } : {}) });
        return true;
      });
      if (result.outcome) status.interaction.commentUsersBlocked += 1;
      return result.outcome;
    },
    async removeMutedUser(mid) {
      const parsed = Core.parseMid(mid);
      if (parsed === null) return false;
      const result = await mutateConfig((draft) => {
        const before = draft.mutedUsers.length;
        draft.mutedUsers = draft.mutedUsers.filter((user) => Core.parseMid(user.mid) !== parsed);
        return draft.mutedUsers.length !== before;
      });
      return result.outcome;
    },
    async toggleMarkedUser(mid, name = '') {
      const parsed = Core.parseMid(mid);
      if (parsed === null) return null;
      const result = await mutateConfig((draft) => {
        const index = draft.markedUsers.findIndex((user) => Core.parseMid(user.mid) === parsed);
        if (index >= 0) {
          draft.markedUsers.splice(index, 1);
          return false;
        }
        draft.markedUsers.push({ mid: parsed, ...(String(name).trim() ? { name: String(name).trim() } : {}) });
        return true;
      });
      if (result.outcome) status.interaction.commentUsersMarked += 1;
      return result.outcome;
    },
    isUploaderBlocked(mid) {
      const parsed = Core.parseMid(mid);
      return parsed !== null && config.uploaderRules.users.some((user) => Core.parseMid(user.mid) === parsed);
    },
    async addBlockedUploader(mid, name = '') {
      const parsed = Core.parseMid(mid);
      if (parsed === null) return false;
      const result = await mutateConfig((draft) => {
        if (draft.uploaderRules.users.some((user) => Core.parseMid(user.mid) === parsed)) return false;
        draft.uploaderRules.users.push({ mid: parsed, ...(String(name).trim() ? { name: String(name).trim() } : {}) });
        return true;
      });
      if (result.outcome) status.interaction.uploaderUsersBlocked += 1;
      return result.outcome;
    },
    async removeBlockedUploader(mid) {
      const parsed = Core.parseMid(mid);
      if (parsed === null) return false;
      const result = await mutateConfig((draft) => {
        const before = draft.uploaderRules.users.length;
        draft.uploaderRules.users = draft.uploaderRules.users.filter((user) => Core.parseMid(user.mid) !== parsed);
        return draft.uploaderRules.users.length !== before;
      });
      return result.outcome;
    },
    recheckDomDanmaku,
  });
  Object.defineProperty(globalThis, 'PiliPlusPurifyContentApi', { value: interactionApi, configurable: true });
})();
