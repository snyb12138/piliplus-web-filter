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
    bridgeTransport: 'postMessage',
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
  const STORAGE_KEY = 'purifyConfig';
  const AD_RULES_KEY = 'adRuleCache';
  const MAX_HITS = 80;
  const MAX_DIAGNOSTICS = 60;
  let token = null;
  let config = Core.defaultConfig();
  let runtime = Core.buildRuntimeRules(config);
  let domMatcher = Core.compileRuntimeMatcher(runtime, recordDiagnostic);
  let senderRequestSeq = 0;
  let homepageBatchRequestSeq = 0;
  let pendingHomepageInitialBatch = null;
  const pendingSenderRequests = new Map();
  const pendingHomepageBatchRequests = new Map();
  const diagnosticLastSeen = new Map();
  const commentsByRpid = new Map();
  const accountsByMid = new Map();
  const elementsByRpid = new Map();
  let lastCommentCatalogRequestAt = 0;
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
      gridCount: 0,
      gridItems: 0,
      visibleGridItems: 0,
      firstRowOffsetSpread: 0,
      maxItemMarginTop: 0,
      pagedMode: true,
      pageSize: 22,
      gridSlots: 24,
      pageVisible: 0,
      pageOverflowHidden: 0,
      pagePendingHidden: 0,
      pageReady: false,
      loadAnchorsSuppressed: 0,
      nativeRefreshButtons: 0,
      statsPanelMounted: false,
      refreshSettling: false,
      inactiveGridsIgnored: 0,
      customBatchActive: false,
      customBatchRendered: 0,
      nativeSlotsSuppressed: 0,
      initialBatchLoading: false,
      initialBatchAttempted: false,
      initialBatchSource: null,
      refreshError: null,
      lastAppliedAt: null,
    },
    interaction: {
      danmakuMenus: 0,
      danmakuTextRulesAdded: 0,
      danmakuSendersAdded: 0,
      commentButtons: 0,
      commentReplyButtons: 0,
      commentUsersBlocked: 0,
      commentUsersMarked: 0,
      commentScanBatches: 0,
      commentRootsScanned: 0,
      commentApplyRuns: 0,
      commentApplyCoalesced: 0,
      commentPanelRenders: 0,
      commentPanelRenderSkips: 0,
      uploaderButtons: 0,
      uploaderUsersBlocked: 0,
      uploaderCardsHidden: 0,
      uploaderApiDropped: 0,
      adsDomHidden: 0,
      adsApiDropped: 0,
      routeScanDeferrals: 0,
      homepageRefreshes: 0,
      homepageRefreshFailures: 0,
      homepageInitialBatchRenders: 0,
      homepageCachedBatchRenders: 0,
      videoPageInteractionDeferrals: 0,
    },
    compatibility: {
      videoPageDomEnhancements: false,
      videoPageCommentActions: true,
      videoPageUploaderActions: false,
      videoPageAdDomFallback: false,
    },
    commentCatalog: {
      routeKey: `${location.origin}${location.pathname}`,
      comments: 0,
      mainComments: 0,
      replies: 0,
      accounts: 0,
      mountedElements: 0,
      pending: 0,
      batches: 0,
      itemsReceived: 0,
      retries: 0,
      pruned: 0,
      routeResets: 0,
      staleBatches: 0,
      lastReason: null,
      lastRequestedAt: null,
      lastUpdatedAt: null,
      failure: null,
    },
    commentFold: {
      activeHidden: 0,
      revealedRpids: 0,
      hidden: 0,
      restored: 0,
      routeResets: 0,
      lastAppliedAt: null,
    },
    commentScoring: {
      scored: 0,
      pureMention: 0,
      shortComments: 0,
      emoteOnly: 0,
      autoHidden: 0,
      pendingComments: 0,
      pendingAccounts: 0,
      dismissedAccounts: 0,
      panelMounted: false,
      routeResets: 0,
      lastAppliedAt: null,
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
    status.compatibility.videoPageDomEnhancements = config.browserExtension.videoPageDomEnhancements === true;
    status.compatibility.videoPageAdDomFallback = config.browserExtension.videoPageDomEnhancements === true;
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

  function requestHomepageBatch() {
    if (!token) return Promise.reject(new Error('页面数据桥尚未连接'));
    const id = ++homepageBatchRequestSeq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!pendingHomepageBatchRequests.delete(id)) return;
        reject(new Error('推荐换批请求超时'));
      }, 12_000);
      pendingHomepageBatchRequests.set(id, { resolve, reject, timer });
      post('request-homepage-batch', { id });
    });
  }

  function currentCommentRoute() {
    return `${location.origin}${location.pathname}`;
  }

  function updateCommentCatalogStatus() {
    status.commentCatalog.comments = commentsByRpid.size;
    status.commentCatalog.mainComments = 0;
    status.commentCatalog.replies = 0;
    for (const comment of commentsByRpid.values()) {
      if (comment.isReply) status.commentCatalog.replies += 1;
      else status.commentCatalog.mainComments += 1;
    }
    status.commentCatalog.accounts = accountsByMid.size;
    status.commentCatalog.mountedElements = elementsByRpid.size;
  }

  function removeCommentRecord(rpid) {
    const existing = commentsByRpid.get(rpid);
    commentsByRpid.delete(rpid);
    elementsByRpid.delete(rpid);
    if (!existing) return;
    const account = accountsByMid.get(existing.mid);
    if (!account) return;
    account.rpids.delete(rpid);
    if (!account.rpids.size) accountsByMid.delete(existing.mid);
  }

  function clearCommentCatalog(routeKey, countReset = true) {
    commentsByRpid.clear();
    accountsByMid.clear();
    elementsByRpid.clear();
    status.commentCatalog.routeKey = routeKey || currentCommentRoute();
    status.commentCatalog.pending = 0;
    status.commentCatalog.failure = null;
    status.commentCatalog.lastUpdatedAt = new Date().toISOString();
    if (countReset) status.commentCatalog.routeResets += 1;
    updateCommentCatalogStatus();
  }

  function ensureCommentCatalogRoute(routeKey = currentCommentRoute()) {
    if (status.commentCatalog.routeKey === routeKey) return false;
    clearCommentCatalog(routeKey, true);
    return true;
  }

  function pruneCommentCatalog() {
    ensureCommentCatalogRoute();
    let pruned = 0;
    for (const [rpid, element] of elementsByRpid) {
      if (element?.isConnected) continue;
      removeCommentRecord(rpid);
      pruned += 1;
    }
    status.commentCatalog.pruned += pruned;
    updateCommentCatalogStatus();
    return pruned;
  }

  function acceptCommentCatalog(packet) {
    const activeRoute = currentCommentRoute();
    ensureCommentCatalogRoute(activeRoute);
    if (packet.routeKey !== activeRoute) {
      status.commentCatalog.staleBatches += 1;
      return;
    }
    status.commentCatalog.batches += 1;
    status.commentCatalog.lastReason = typeof packet.meta?.reason === 'string' ? packet.meta.reason : null;
    status.commentCatalog.pending = Math.max(0, Number(packet.meta?.pending) || 0);
    status.commentCatalog.retries = Math.max(status.commentCatalog.retries, Number(packet.meta?.retries) || 0);
    status.commentCatalog.pruned = Math.max(status.commentCatalog.pruned, Number(packet.meta?.pruned) || 0);
    status.commentCatalog.failure = null;
    const acceptedRpids = [];
    const changedRpids = [];
    for (const item of Array.isArray(packet.items) ? packet.items : []) {
      const rpid = typeof item?.rpid === 'string' && /^\d+$/u.test(item.rpid) ? item.rpid : null;
      const mid = typeof item?.mid === 'string' && /^\d+$/u.test(item.mid) ? item.mid : null;
      if (!rpid || !mid) continue;
      const previous = commentsByRpid.get(rpid);
      if (previous && previous.mid !== mid) {
        const previousAccount = accountsByMid.get(previous.mid);
        previousAccount?.rpids.delete(rpid);
        if (previousAccount && !previousAccount.rpids.size) accountsByMid.delete(previous.mid);
      }
      const comment = Object.freeze({
        rpid,
        root: typeof item.root === 'string' ? item.root : '0',
        mid,
        uname: String(item.uname || ''),
        avatar: String(item.avatar || ''),
        sign: String(item.sign || ''),
        level: Math.max(0, Number(item.level) || 0),
        verify: Number.isFinite(Number(item.verify)) ? Number(item.verify) : -1,
        vip: Math.max(0, Number(item.vip) || 0),
        text: String(item.text || ''),
        mentions: Array.isArray(item.mentions) ? item.mentions : [],
        emotes: Array.isArray(item.emotes) ? item.emotes.map((token) => String(token || '')).filter(Boolean) : [],
        pictureCount: Math.max(0, Number(item.pictureCount) || 0),
        ctime: Math.max(0, Number(item.ctime) || 0),
        like: Math.max(0, Number(item.like) || 0),
        isReply: item.isReply === true,
      });
      const sameMentions = previous?.mentions?.length === comment.mentions.length &&
        comment.mentions.every((mention, index) => {
          const old = previous.mentions[index];
          return old?.mid === mention.mid && old?.name === mention.name;
        });
      const sameEmotes = previous?.emotes?.length === comment.emotes.length &&
        comment.emotes.every((token, index) => previous.emotes[index] === token);
      const unchanged = previous &&
        previous.root === comment.root && previous.mid === comment.mid &&
        previous.uname === comment.uname && previous.avatar === comment.avatar &&
        previous.sign === comment.sign && previous.level === comment.level &&
        previous.verify === comment.verify && previous.vip === comment.vip &&
        previous.text === comment.text && sameMentions && sameEmotes &&
        previous.pictureCount === comment.pictureCount && previous.ctime === comment.ctime &&
        previous.like === comment.like && previous.isReply === comment.isReply;
      commentsByRpid.set(rpid, unchanged ? previous : comment);
      let account = accountsByMid.get(mid);
      if (!account) {
        account = { mid, name: comment.uname, rpids: new Set() };
        accountsByMid.set(mid, account);
      } else if (comment.uname) {
        account.name = comment.uname;
      }
      account.rpids.add(rpid);
      acceptedRpids.push(rpid);
      if (!unchanged) changedRpids.push(rpid);
    }
    status.commentCatalog.itemsReceived += acceptedRpids.length;
    status.commentCatalog.lastUpdatedAt = new Date().toISOString();
    updateCommentCatalogStatus();
    if (changedRpids.length && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent('pbp-comment-catalog-updated', { detail: { rpids: changedRpids } }));
    }
  }

  function requestCommentCatalog(reason = 'dom-mutation', force = false) {
    ensureCommentCatalogRoute();
    pruneCommentCatalog();
    if (!token) return false;
    const now = Date.now();
    if (!force && now - lastCommentCatalogRequestAt < 300) return false;
    lastCommentCatalogRequestAt = now;
    status.commentCatalog.lastRequestedAt = new Date(now).toISOString();
    post('request-comment-catalog', { reason: String(reason || 'unknown') });
    return true;
  }

  function registerCommentElement(rpid, element) {
    const normalized = String(rpid || '').trim();
    if (!/^\d+$/u.test(normalized) || !(element instanceof Element)) return false;
    ensureCommentCatalogRoute();
    if (elementsByRpid.get(normalized) === element) return false;
    elementsByRpid.set(normalized, element);
    updateCommentCatalogStatus();
    return true;
  }

  function acquireToken(candidate) {
    if (!/^[0-9a-f]{32}$/u.test(candidate || '')) return false;
    if (token === candidate) return true;
    if (token) return false;
    token = candidate;
    status.connected = true;
    connection.tokenFound = true;
    connection.bridgeConnectedAt = new Date().toISOString();
    connection.failure = null;
    loadRules().catch((error) => recordDiagnostic({ level: 'error', code: 'load-rules', message: `读取规则失败：${error.message}` }));
    return true;
  }

  window.addEventListener('message', (event) => {
    const packet = event.data;
    if (event.source !== window || packet?.__pbp !== true || packet.channel !== CHANNEL || packet.direction !== 'page-to-extension') return;
    if (packet.kind === 'bridge-token' && acquireToken(packet.token)) {
      connection.lastPageMessageAt = new Date().toISOString();
      return;
    }
    if (!token || packet.token !== token) return;
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
    } else if (packet.kind === 'homepage-batch-result') {
      const pending = pendingHomepageBatchRequests.get(packet.id);
      if (pending) {
        pendingHomepageBatchRequests.delete(packet.id);
        clearTimeout(pending.timer);
        if (packet.error) pending.reject(new Error(packet.error));
        else pending.resolve(Array.isArray(packet.items) ? packet.items : []);
      }
    } else if (packet.kind === 'homepage-initial-batch') {
      pendingHomepageInitialBatch = {
        routeKey: String(packet.routeKey || ''),
        items: Array.isArray(packet.items) ? packet.items : [],
      };
      window.dispatchEvent(new CustomEvent('pbp-homepage-initial-batch'));
    } else if (packet.kind === 'comment-catalog-reset') {
      if (packet.routeKey !== currentCommentRoute()) {
        status.commentCatalog.staleBatches += 1;
      } else if (status.commentCatalog.routeKey !== packet.routeKey) {
        clearCommentCatalog(packet.routeKey, true);
      }
    } else if (packet.kind === 'comment-catalog') {
      acceptCommentCatalog(packet);
    }
  });

  requestBridge();
  setTimeout(() => {
    if (!token) requestBridge();
  }, 500);
  setTimeout(() => {
    if (!token) {
      connection.failure = 'bridge-timeout';
      recordDiagnostic({ level: 'error', code: 'bridge-timeout', message: '页面数据层桥接超时，已仅启用 DOM 兜底' });
    }
  }, 3000);

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
    getStatusSnapshot: () => ({
      connected: status.connected,
      rulesReady: status.rulesReady,
      blocked: status.blocked,
      counts: { ...status.counts },
      interaction: { ...status.interaction },
      commentCatalog: { ...status.commentCatalog },
      commentFold: { ...status.commentFold },
      commentScoring: { ...status.commentScoring },
    }),
    requestDanmakuSender,
    requestHomepageBatch,
    takeHomepageInitialBatch(routeKey = `${location.origin}${location.pathname}`) {
      if (!pendingHomepageInitialBatch || pendingHomepageInitialBatch.routeKey !== routeKey) return [];
      const items = pendingHomepageInitialBatch.items;
      pendingHomepageInitialBatch = null;
      return items;
    },
    requestCommentCatalog,
    resetCommentCatalogForRoute(routeKey = currentCommentRoute()) {
      return ensureCommentCatalogRoute(routeKey);
    },
    registerCommentElement,
    pruneCommentCatalog,
    getCommentCatalogRecord(rpid) {
      return commentsByRpid.get(String(rpid || '')) || null;
    },
    getMountedCommentRpidsByMid(mid) {
      pruneCommentCatalog();
      const account = accountsByMid.get(String(mid || ''));
      if (!account) return [];
      return [...account.rpids].filter((rpid) => elementsByRpid.get(rpid)?.isConnected);
    },
    getMountedCommentRecords() {
      pruneCommentCatalog();
      const records = [];
      for (const [rpid, element] of elementsByRpid) {
        const comment = commentsByRpid.get(rpid);
        if (comment && element?.isConnected) records.push({ ...comment, element });
      }
      return records;
    },
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
        gridCount: Number(next.gridCount) || 0,
        gridItems: Number(next.gridItems) || 0,
        visibleGridItems: Number(next.visibleGridItems) || 0,
        firstRowOffsetSpread: Number(next.firstRowOffsetSpread) || 0,
        maxItemMarginTop: Number(next.maxItemMarginTop) || 0,
        pagedMode: next.pagedMode === true,
        pageSize: Number(next.pageSize) || 22,
        gridSlots: Number(next.gridSlots) || 24,
        pageVisible: Number(next.pageVisible) || 0,
        pageOverflowHidden: Number(next.pageOverflowHidden) || 0,
        pagePendingHidden: Number(next.pagePendingHidden) || 0,
        pageReady: next.pageReady === true,
        loadAnchorsSuppressed: Number(next.loadAnchorsSuppressed) || 0,
        nativeRefreshButtons: Number(next.nativeRefreshButtons) || 0,
        statsPanelMounted: next.statsPanelMounted === true,
        refreshSettling: next.refreshSettling === true,
        inactiveGridsIgnored: Number(next.inactiveGridsIgnored) || 0,
        customBatchActive: next.customBatchActive === true,
        customBatchRendered: Number(next.customBatchRendered) || 0,
        nativeSlotsSuppressed: Number(next.nativeSlotsSuppressed) || 0,
        refreshError: typeof next.refreshError === 'string' && next.refreshError ? next.refreshError : null,
        lastAppliedAt: new Date().toISOString(),
      };
    },
    setCommentFoldStatus(next) {
      if (!next || typeof next !== 'object') return;
      status.commentFold = {
        activeHidden: Math.max(0, Number(next.activeHidden) || 0),
        revealedRpids: Math.max(0, Number(next.revealedRpids) || 0),
        hidden: Math.max(0, Number(next.hidden) || 0),
        restored: Math.max(0, Number(next.restored) || 0),
        routeResets: Math.max(0, Number(next.routeResets) || 0),
        lastAppliedAt: new Date().toISOString(),
      };
    },
    setCommentScoringStatus(next) {
      if (!next || typeof next !== 'object') return;
      status.commentScoring = {
        scored: Math.max(0, Number(next.scored) || 0),
        pureMention: Math.max(0, Number(next.pureMention) || 0),
        shortComments: Math.max(0, Number(next.shortComments) || 0),
        emoteOnly: Math.max(0, Number(next.emoteOnly) || 0),
        autoHidden: Math.max(0, Number(next.autoHidden) || 0),
        pendingComments: Math.max(0, Number(next.pendingComments) || 0),
        pendingAccounts: Math.max(0, Number(next.pendingAccounts) || 0),
        dismissedAccounts: Math.max(0, Number(next.dismissedAccounts) || 0),
        panelMounted: next.panelMounted === true,
        routeResets: Math.max(0, Number(next.routeResets) || 0),
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
