(() => {
  'use strict';

  const MARKER_NAME = '__PBP_MAIN_DIAGNOSTIC_V1__';
  if (globalThis[MARKER_NAME]?.active) {
    try {
      delete globalThis.PiliPlusPurifyCore;
      delete globalThis.PiliPlusPurifyPageCore;
    } catch (_) {
      // Existing hooks remain active; only remove temporary reinjection globals.
    }
    return;
  }
  const diagnostic = {
    active: false,
    loadedAt: new Date().toISOString(),
    coreReady: false,
    bridgeTransport: 'postMessage',
    tokenPublishedAt: null,
    bridgeRequests: 0,
    rulesReceivedAt: null,
    fetchHookInstalled: false,
    xhrHookInstalled: false,
    segmentsSeen: 0,
    catalogEntries: 0,
    catalogTexts: 0,
    senderResolutions: 0,
    uploaderResponsesSeen: 0,
    uploaderItemsDropped: 0,
    adItemsDropped: 0,
    homepageResponsesPassedThrough: 0,
    homepageRequestsExpanded: 0,
    homepageRequestedSize: 0,
    homepageUpstreamSize: 0,
    homepageItemsReturned: 0,
    homepageNonVideoItemsDropped: 0,
    failure: null,
  };
  Object.defineProperty(globalThis, MARKER_NAME, { value: diagnostic, configurable: true });

  const ConfigCore = globalThis.PiliPlusPurifyCore;
  const PageCore = globalThis.PiliPlusPurifyPageCore;
  try {
    delete globalThis.PiliPlusPurifyCore;
    delete globalThis.PiliPlusPurifyPageCore;
  } catch (_) {
    // The captured references remain private to this closure.
  }
  if (!ConfigCore || !PageCore) {
    diagnostic.failure = !ConfigCore && !PageCore ? 'both-cores-missing' : (!ConfigCore ? 'config-core-missing' : 'page-core-missing');
    return;
  }
  diagnostic.active = true;
  diagnostic.coreReady = true;

  const CHANNEL = 'piliplus-purify-browser';
  const tokenBytes = new Uint8Array(16);
  crypto.getRandomValues(tokenBytes);
  const token = [...tokenBytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  let runtime = ConfigCore.buildRuntimeRules(ConfigCore.defaultConfig());
  let matcher = ConfigCore.compileRuntimeMatcher(runtime, emitDiagnostic);
  let rulesReceived = false;
  let resolveFirstRules;
  const firstRules = new Promise((resolve) => { resolveFirstRules = resolve; });
  const MAX_CATALOG_ENTRIES = 12_000;
  const HOMEPAGE_PAGE_SIZE = 24;
  const HOMEPAGE_UPSTREAM_SIZE = 30;
  const danmakuCatalog = [];
  let catalogPage = `${location.origin}${location.pathname}${location.search}`;

  function rememberDanmaku(entries) {
    const currentPage = `${location.origin}${location.pathname}${location.search}`;
    if (currentPage !== catalogPage) {
      catalogPage = currentPage;
      danmakuCatalog.length = 0;
    }
    for (const entry of entries || []) {
      const midHash = ConfigCore.normalizeUidHash(entry.midHash || '');
      if (!midHash || typeof entry.content !== 'string' || !entry.content) continue;
      danmakuCatalog.push({
        content: entry.content,
        progress: Number(entry.progress) || 0,
        midHash,
      });
    }
    if (danmakuCatalog.length > MAX_CATALOG_ENTRIES) {
      danmakuCatalog.splice(0, danmakuCatalog.length - MAX_CATALOG_ENTRIES);
    }
    diagnostic.catalogEntries = danmakuCatalog.length;
    diagnostic.catalogTexts = new Set(danmakuCatalog.map((entry) => entry.content)).size;
  }

  function resolveDanmakuSender(content, currentMs) {
    const candidates = danmakuCatalog.filter((entry) => entry.content === content);
    if (!candidates.length) return { found: false, ambiguous: false, candidates: 0 };
    const target = Number.isFinite(currentMs) ? currentMs : null;
    const ranked = candidates.map((entry) => ({
      ...entry,
      distance: target === null ? Number.POSITIVE_INFINITY : Math.abs(entry.progress - target),
    })).sort((a, b) => a.distance - b.distance);
    const best = ranked[0];
    const near = target === null
      ? ranked
      : ranked.filter((entry) => entry.distance <= best.distance + 500);
    const nearHashes = new Set(near.map((entry) => entry.midHash));
    const allHashes = new Set(ranked.map((entry) => entry.midHash));
    const tooFarAndRepeated = best.distance > 15_000 && allHashes.size > 1;
    if (nearHashes.size > 1 || tooFarAndRepeated) {
      return { found: true, ambiguous: true, candidates: ranked.length };
    }
    diagnostic.senderResolutions += 1;
    return {
      found: true,
      ambiguous: false,
      candidates: ranked.length,
      midHash: best.midHash,
      progress: best.progress,
      distance: Number.isFinite(best.distance) ? best.distance : null,
    };
  }

  function publishToken() {
    post('bridge-token');
    diagnostic.tokenPublishedAt = new Date().toISOString();
  }

  function post(kind, payload = {}) {
    window.postMessage({ __pbp: true, channel: CHANNEL, direction: 'page-to-extension', token, kind, ...payload }, location.origin);
  }

  function emitDiagnostic(entry) {
    post('diagnostic', { entry });
  }

  function isDanmakuResponse(input) {
    try {
      const raw = input instanceof Request ? input.url : String(input);
      const pathname = new URL(raw, location.href).pathname;
      return pathname === '/x/v2/dm/web/seg.so' ||
        pathname === '/x/v2/dm/wbi/web/seg.so' ||
        pathname === '/x/v2/dm/web/history/seg.so';
    } catch (_) {
      return false;
    }
  }

  function classifyJsonResponse(input) {
    try {
      const raw = input instanceof Request ? input.url : String(input);
      const pathname = new URL(raw, location.href).pathname;
      if (pathname === '/x/web-interface/index/top/feed/rcmd' || pathname === '/x/web-interface/wbi/index/top/feed/rcmd') {
        return 'homepage';
      }
      if (pathname.startsWith('/x/polymer/web-dynamic/')) return 'dynamic';
      if ([
        '/x/web-interface/archive/related',
        '/x/web-interface/popular',
        '/x/web-interface/ranking',
        '/x/web-interface/newlist',
        '/x/web-interface/dynamic/region',
      ].includes(pathname) ||
        pathname.startsWith('/x/web-interface/wbi/search/') ||
        pathname.startsWith('/x/web-interface/search/')) return 'content';
      return null;
    } catch (_) {
      return null;
    }
  }

  function getRequestUrl(input) {
    if (input instanceof Request) return input.url;
    return String(input);
  }

  function expandHomepageRequest(input, init) {
    try {
      const url = new URL(getRequestUrl(input), location.href);
      const requestedSize = Math.max(1, Number(url.searchParams.get('ps') || 12));
      diagnostic.homepageRequestedSize = requestedSize;
      diagnostic.homepageUpstreamSize = HOMEPAGE_UPSTREAM_SIZE;
      if (requestedSize >= HOMEPAGE_UPSTREAM_SIZE) return [input, init];
      url.searchParams.set('ps', String(HOMEPAGE_UPSTREAM_SIZE));
      diagnostic.homepageRequestsExpanded += 1;
      const nextInit = init ? { ...init } : {};
      if (!nextInit.credentials || nextInit.credentials === 'same-origin') nextInit.credentials = 'include';
      if (input instanceof Request) return [new Request(url.href, input), nextInit];
      return [url.href, nextInit];
    } catch (_) {
      return [input, init];
    }
  }

  function isRegularHomepageVideo(item) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const goto = String(item.goto || item.card_goto || '').toLowerCase();
    return Boolean(item.bvid) && (!goto || goto === 'av' || goto === 'video');
  }

  async function waitForInitialRules() {
    if (rulesReceived) return;
    await Promise.race([firstRules, new Promise((resolve) => setTimeout(resolve, 600))]);
  }

  async function filterContentResponse(response, kind) {
    const adFilter = runtime.adFilter || {};
    const filterAds = adFilter.enabled !== false &&
      ((kind === 'homepage' && adFilter.homepage !== false) || (kind === 'dynamic' && adFilter.dynamic !== false));
    if (!response.ok || !runtime.enabled || (!runtime.blockedUploaders?.length && !filterAds)) return response;
    try {
      const json = await response.clone().json();
      const blocked = runtime.blockedUploaders.map((user) => user.mid);
      const result = PageCore.filterContentJson(json, blocked, {
        kind,
        filterAds,
        keywords: adFilter.keywords || [],
      });
      diagnostic.uploaderResponsesSeen += 1;
      diagnostic.uploaderItemsDropped += result.uploaderDropped;
      diagnostic.adItemsDropped += result.adsDropped;
      if (!result.uploaderDropped && !result.adsDropped) return response;
      post('content-filter-result', {
        uploaderDropped: result.uploaderDropped,
        adsDropped: result.adsDropped,
        uploaderHits: result.uploaderHits,
        adHits: result.adHits,
      });
      const headers = new Headers(response.headers);
      headers.delete('content-length');
      headers.delete('content-encoding');
      headers.set('content-type', 'application/json; charset=utf-8');
      return new Response(JSON.stringify(result.data), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (error) {
      emitDiagnostic({ level: 'warning', code: 'content-filter-failed', message: `内容数据过滤失败，已放行原响应：${error.message}` });
      return response;
    }
  }

  async function buildHomepagePageResponse(response) {
    if (!response.ok || !runtime.enabled || runtime.homepagePagedMode === false) return response;
    try {
      const json = await response.clone().json();
      if (!Array.isArray(json?.data?.item)) return response;
      const blocked = runtime.blockedUploaders.map((user) => user.mid);
      const adFilter = runtime.adFilter || {};
      const result = PageCore.filterContentJson(json, blocked, {
        kind: 'homepage',
        filterAds: adFilter.enabled !== false && adFilter.homepage !== false,
        keywords: adFilter.keywords || [],
      });
      const items = result.data?.data?.item;
      if (!Array.isArray(items)) return response;
      const videos = items.filter(isRegularHomepageVideo).slice(0, HOMEPAGE_PAGE_SIZE);
      const nonVideoDropped = items.length - items.filter(isRegularHomepageVideo).length;
      result.data.data.item = videos;
      diagnostic.uploaderResponsesSeen += 1;
      diagnostic.uploaderItemsDropped += result.uploaderDropped;
      diagnostic.adItemsDropped += result.adsDropped + nonVideoDropped;
      diagnostic.homepageNonVideoItemsDropped += nonVideoDropped;
      diagnostic.homepageItemsReturned = videos.length;
      post('content-filter-result', {
        uploaderDropped: result.uploaderDropped,
        adsDropped: result.adsDropped + nonVideoDropped,
        uploaderHits: result.uploaderHits,
        adHits: result.adHits,
      });
      const headers = new Headers(response.headers);
      headers.delete('content-length');
      headers.delete('content-encoding');
      headers.set('content-type', 'application/json; charset=utf-8');
      return new Response(JSON.stringify(result.data), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (error) {
      emitDiagnostic({ level: 'warning', code: 'homepage-page-build-failed', message: `首页固定页构建失败，已放行原响应：${error.message}` });
      return response;
    }
  }

  function applyFilter(raw) {
    if (!runtime.enabled) return null;
    diagnostic.segmentsSeen += 1;
    const result = PageCore.filterSegment(raw, matcher);
    rememberDanmaku(result.observed);
    post('segment-result', {
      total: result.total,
      dropped: result.dropped,
      hits: result.hits.slice(0, 20),
    });
    return result;
  }

  const nativeFetch = window.fetch.bind(window);
  window.fetch = function piliplusPurifyFetch(...args) {
    const request = args[0];
    const jsonKind = classifyJsonResponse(request);
    if (jsonKind === 'homepage') {
      diagnostic.homepageResponsesPassedThrough += 1;
      if (!runtime.enabled || runtime.homepagePagedMode === false) return nativeFetch(...args);
      return waitForInitialRules().then(() => {
        const expanded = expandHomepageRequest(args[0], args[1]);
        return nativeFetch(...expanded);
      }).then(buildHomepagePageResponse);
    }
    if (jsonKind) {
      return waitForInitialRules().then(() => nativeFetch(...args)).then((response) => filterContentResponse(response, jsonKind));
    }
    const responsePromise = nativeFetch(...args);
    if (!isDanmakuResponse(request)) return responsePromise;
    return responsePromise.then(async (response) => {
      if (!response.ok || !runtime.enabled) return response;
      try {
        const raw = new Uint8Array(await response.clone().arrayBuffer());
        const result = applyFilter(raw);
        if (!result || result.dropped === 0) return response;
        const headers = new Headers(response.headers);
        headers.delete('content-length');
        headers.set('content-type', 'application/octet-stream');
        return new Response(result.bytes, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      } catch (error) {
        emitDiagnostic({ level: 'warning', code: 'fetch-filter-failed', message: `fetch 弹幕过滤失败，已放行原响应：${error.message}` });
        return response;
      }
    });
  };
  diagnostic.fetchHookInstalled = true;

  const xhrPrototype = XMLHttpRequest.prototype;
  const nativeOpen = xhrPrototype.open;
  const nativeSend = xhrPrototype.send;
  const responseDescriptor = Object.getOwnPropertyDescriptor(xhrPrototype, 'response');

  xhrPrototype.open = function piliplusPurifyOpen(method, url, ...rest) {
    this.__pbpDanmakuResponse = isDanmakuResponse(url);
    return nativeOpen.call(this, method, url, ...rest);
  };

  xhrPrototype.send = function piliplusPurifySend(...args) {
    if (this.__pbpDanmakuResponse && responseDescriptor?.get) {
      try {
        let cachedOriginal = null;
        let cachedFiltered = null;
        Object.defineProperty(this, 'response', {
          configurable: true,
          get() {
            const original = responseDescriptor.get.call(this);
            if (!runtime.enabled || !(original instanceof ArrayBuffer) || original.byteLength < 2) return original;
            if (original === cachedOriginal) return cachedFiltered;
            try {
              const result = applyFilter(new Uint8Array(original));
              cachedOriginal = original;
              cachedFiltered = result?.dropped ? result.bytes.buffer : original;
              return cachedFiltered;
            } catch (error) {
              emitDiagnostic({ level: 'warning', code: 'xhr-filter-failed', message: `XHR 弹幕过滤失败，已放行原响应：${error.message}` });
              return original;
            }
          },
        });
      } catch (error) {
        emitDiagnostic({ level: 'warning', code: 'xhr-hook-failed', message: `XHR 响应钩子安装失败：${error.message}` });
      }
    }
    return nativeSend.apply(this, args);
  };
  diagnostic.xhrHookInstalled = Boolean(responseDescriptor?.get);

  window.addEventListener('message', (event) => {
    const packet = event.data;
    if (event.source !== window || packet?.__pbp !== true || packet.channel !== CHANNEL || packet.direction !== 'extension-to-page') return;
    if (packet.kind === 'bridge-request') {
      diagnostic.bridgeRequests += 1;
      publishToken();
      return;
    }
    if (packet.token !== token) return;
    if (packet.kind === 'set-rules' && packet.runtime && typeof packet.runtime === 'object') {
      runtime = packet.runtime;
      matcher = ConfigCore.compileRuntimeMatcher(runtime, emitDiagnostic);
      if (!rulesReceived) {
        rulesReceived = true;
        resolveFirstRules();
      }
      diagnostic.rulesReceivedAt = new Date().toISOString();
      post('rules-ready', {
        counts: {
          mutedUsers: runtime.mutedUidHashes?.length || 0,
          uidHashes: runtime.legacyUidHashes?.length || 0,
          absolute: runtime.absoluteRules?.length || 0,
          gentle: runtime.gentleRules?.length || 0,
          keywords: runtime.keywords?.length || 0,
          regex: runtime.regex?.length || 0,
          uploaders: runtime.blockedUploaders?.length || 0,
          adKeywords: runtime.adFilter?.keywords?.length || 0,
        },
      });
    } else if (packet.kind === 'resolve-danmaku-sender' && Number.isSafeInteger(packet.id)) {
      const currentMs = typeof packet.currentMs === 'number' && Number.isFinite(packet.currentMs)
        ? packet.currentMs
        : null;
      post('danmaku-sender-result', {
        id: packet.id,
        result: resolveDanmakuSender(packet.content, currentMs),
      });
    }
  });

  publishToken();
})();
