(() => {
  'use strict';

  const MARKER = '__PBP_INTERACTIONS_V1__';
  if (globalThis[MARKER]) return;
  Object.defineProperty(globalThis, MARKER, { value: true, configurable: true });

  const Api = globalThis.PiliPlusPurifyContentApi;
  if (!Api) return;

  const COMMENT_CONTAINER_SELECTOR = [
    'bili-comment-renderer',
    'bili-comment-reply-renderer',
    'bili-comment-thread-renderer',
    '.root-reply-container',
    '.sub-reply-item',
    '.reply-item',
    '.reply-wrap',
    '.reply-card',
    '.comment-item',
    '.list-item',
    '[data-rpid]',
    '[data-reply-id]',
  ].join(',');
  const COMMENT_REGION_SELECTOR = [
    'bili-comments',
    'bili-comment-thread-renderer',
    '#commentapp',
    '#comment',
    '.comment-container',
    '.comment-wrapper',
    '.reply-list',
    '.bili-comments',
  ].join(',');
  const COMMENT_HOST_SELECTOR = 'bili-comments, bili-comment-thread-renderer, bili-comment-renderer, bili-comment-reply-renderer';
  const UPLOADER_CARD_SELECTOR = [
    'bili-video-card',
    '.bili-video-card',
    '.feed-card',
    '.video-card',
    '.video-page-card-small',
    '.video-list-item',
    '.video-item',
    '.small-item',
    '.rank-item',
    '.search-card',
    '.bili-dyn-item',
    '.dynamic-card-item',
    '[data-video-card]',
  ].join(',');
  const HOMEPAGE_CAROUSEL_SELECTOR = [
    '.container.is-version8 > .recommended-swipe',
    '.recommended-container_floor-aside .container > .recommended-swipe',
    '[class*="recommended-container_"] .container > .recommended-swipe',
  ].join(',');
  const HOMEPAGE_REGION_SELECTOR = [
    '.recommended-container_floor-aside',
    '.recommended-container_overseas',
    '[class*="recommended-container_"]',
  ].join(',');
  const HOMEPAGE_GRID_SELECTOR = [
    '.recommended-container_floor-aside .container',
    '.recommended-container_overseas .container',
    '[class*="recommended-container_"] .container',
  ].join(',');
  const LIST_CONTAINER_SELECTOR = [
    HOMEPAGE_GRID_SELECTOR,
    '.bili-dyn-list__items',
    '.video-page-card',
    '.recommend-list-v1',
  ].join(',');
  const AD_CARD_SELECTOR = [
    '.feed-card',
    '.bili-feed-card',
    '.bili-dyn-item',
    '.dynamic-card-item',
    '.video-card-ad-small',
    '.strip-ad',
  ].join(',');
  const PAGE_CHROME_SELECTOR = [
    'header',
    'nav',
    '#bili-header-container',
    '.bili-header',
    '.mini-header',
    '.international-header',
    '.nav-searchform',
    '[class*="header__bar"]',
    '[class*="header-channel"]',
  ].join(',');
  const VIDEO_CONTENT_REGION_SELECTOR = [
    '#mirror-vdcon',
    '.left-container',
    '.right-container',
    '.video-container-v1',
    '.video-container',
    '.video-page-card',
    '.recommend-list-v1',
  ].join(',');
  const observedRoots = new Set();
  const pendingRoots = new Set();
  const observedListContainers = new WeakSet();
  const commentByContainer = new WeakMap();
  const commentRecords = new Set();
  const uploaderByContainer = new WeakMap();
  const uploaderRecords = new Set();
  const adRecords = new Set();
  let scanScheduled = false;
  let danmakuMenuBusy = false;
  let uiHost;
  let uiRoot;
  let toastTimer;

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function ensureUi() {
    if (uiHost?.isConnected) return uiRoot;
    uiHost = createElement('div');
    uiHost.id = 'pbp-purify-ui-host';
    uiHost.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
    uiRoot = uiHost.attachShadow({ mode: 'open' });
    const style = createElement('style');
    style.textContent = `
      *{box-sizing:border-box}button{font:inherit}
      .backdrop{position:fixed;inset:0;display:grid;place-items:center;background:rgba(0,0,0,.48);pointer-events:auto;padding:20px;color:#202124;font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
      .card{width:min(420px,calc(100vw - 32px));max-height:min(620px,calc(100vh - 40px));overflow:auto;background:#fff;border-radius:14px;box-shadow:0 18px 60px rgba(0,0,0,.32);padding:18px}
      .title{font-size:17px;font-weight:700;margin:0 0 8px}.body{color:#5f6368;white-space:pre-wrap;overflow-wrap:anywhere;margin-bottom:14px}
      .actions{display:grid;gap:8px}.action{width:100%;text-align:left;border:1px solid #e1e4e8;border-radius:10px;background:#fff;color:#202124;padding:10px 12px;cursor:pointer}
      .action:hover{border-color:#fb7299;background:#fff7fa}.action:disabled{cursor:not-allowed;opacity:.48}.action.danger{color:#c02c52}.action-title{font-weight:650}.action-detail{display:block;color:#73777f;font-size:12px;margin-top:2px}
      .cancel{margin-top:10px;width:100%;border:0;background:transparent;color:#73777f;padding:8px;cursor:pointer}
      .toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);display:flex;align-items:center;gap:12px;max-width:min(520px,calc(100vw - 32px));background:#202124;color:#fff;border-radius:10px;padding:10px 14px;box-shadow:0 8px 28px rgba(0,0,0,.3);pointer-events:auto;font:13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif}
      .toast button{border:0;background:transparent;color:#ff9ab7;font-weight:700;cursor:pointer;padding:2px 4px}
      @media(prefers-color-scheme:dark){.card{background:#24262b;color:#f5f6f7}.body,.action-detail{color:#afb3bb}.action{background:#24262b;color:#f5f6f7;border-color:#40434b}.action:hover{background:#33272d}.action.danger{color:#ff92ad}.cancel{color:#afb3bb}}
    `;
    uiRoot.append(style);
    (document.documentElement || document).append(uiHost);
    return uiRoot;
  }

  function showActionSheet({ title, body, actions }) {
    const root = ensureUi();
    root.querySelector('.backdrop')?.remove();
    return new Promise((resolve) => {
      const backdrop = createElement('div', 'backdrop');
      const card = createElement('div', 'card');
      card.setAttribute('role', 'dialog');
      card.setAttribute('aria-modal', 'true');
      card.append(createElement('div', 'title', title), createElement('div', 'body', body));
      const actionList = createElement('div', 'actions');
      const finish = (value) => {
        document.removeEventListener('keydown', onKeyDown, true);
        backdrop.remove();
        resolve(value);
      };
      const onKeyDown = (event) => {
        if (event.key === 'Escape') finish(null);
      };
      for (const action of actions) {
        const button = createElement('button', `action${action.danger ? ' danger' : ''}`);
        button.type = 'button';
        button.disabled = action.disabled === true;
        button.append(createElement('span', 'action-title', action.label));
        if (action.detail) button.append(createElement('span', 'action-detail', action.detail));
        button.addEventListener('click', () => finish(action.id));
        actionList.append(button);
      }
      const cancel = createElement('button', 'cancel', '取消');
      cancel.type = 'button';
      cancel.addEventListener('click', () => finish(null));
      card.append(actionList, cancel);
      backdrop.append(card);
      backdrop.addEventListener('click', (event) => {
        if (event.target === backdrop) finish(null);
      });
      root.append(backdrop);
      document.addEventListener('keydown', onKeyDown, true);
      actionList.querySelector('button:not(:disabled)')?.focus();
    });
  }

  function showToast(message, undo) {
    const root = ensureUi();
    root.querySelector('.toast')?.remove();
    clearTimeout(toastTimer);
    const toast = createElement('div', 'toast');
    toast.append(createElement('span', '', message));
    if (typeof undo === 'function') {
      const button = createElement('button', '', '撤销');
      button.type = 'button';
      button.addEventListener('click', async () => {
        clearTimeout(toastTimer);
        button.disabled = true;
        try {
          await undo();
          toast.firstElementChild.textContent = '已撤销';
          setTimeout(() => toast.remove(), 900);
        } catch (error) {
          toast.firstElementChild.textContent = `撤销失败：${error.message}`;
        }
      });
      toast.append(button);
    }
    root.append(toast);
    toastTimer = setTimeout(() => toast.remove(), 6500);
  }

  function installDanmakuPointerStyle() {
    if (document.getElementById('pbp-danmaku-pointer-style')) return;
    const style = createElement('style');
    style.id = 'pbp-danmaku-pointer-style';
    style.textContent = `${Api.DOM_SELECTOR}{pointer-events:auto!important;cursor:pointer!important}`;
    (document.head || document.documentElement).append(style);
  }

  function installLayoutStyle() {
    if (document.getElementById('pbp-layout-style')) return;
    const style = createElement('style');
    style.id = 'pbp-layout-style';
    style.textContent = `
      html[data-pbp-hide-home-carousel="1"] .container.is-version8 > .recommended-swipe,
      html[data-pbp-hide-home-carousel="1"] .recommended-container_floor-aside .container > .recommended-swipe,
      html[data-pbp-hide-home-carousel="1"] [class*="recommended-container_"] .container > .recommended-swipe{
        display:none!important;
      }
      html[data-pbp-hide-home-carousel="1"] .recommended-container_floor-aside .container.is-version8,
      html[data-pbp-hide-home-carousel="1"] .recommended-container_floor-aside .container:has(> .recommended-swipe),
      html[data-pbp-hide-home-carousel="1"] [class*="recommended-container_"] .container.is-version8,
      html[data-pbp-hide-home-carousel="1"] [class*="recommended-container_"] .container:has(> .recommended-swipe){
        grid-auto-flow:row dense!important;
      }
      html[data-pbp-hide-home-carousel="1"] .recommended-container_floor-aside .container.is-version8 > :is(.feed-card,.bili-feed-card),
      html[data-pbp-hide-home-carousel="1"] .recommended-container_floor-aside .container:has(> .recommended-swipe) > :is(.feed-card,.bili-feed-card),
      html[data-pbp-hide-home-carousel="1"] [class*="recommended-container_"] .container.is-version8 > :is(.feed-card,.bili-feed-card),
      html[data-pbp-hide-home-carousel="1"] [class*="recommended-container_"] .container:has(> .recommended-swipe) > :is(.feed-card,.bili-feed-card){
        grid-area:auto!important;
        grid-column:auto!important;
        grid-row:auto!important;
      }
      html[data-pbp-compact-home-grid="1"] [class*="recommended-container_"] .container > .feed-card:empty,
      html[data-pbp-compact-home-grid="1"] [class*="recommended-container_"] .container > .bili-feed-card:empty{
        display:none!important;
      }
    `;
    (document.head || document.documentElement).append(style);
  }

  function applyLayoutPreferences() {
    const isHomepage = isHomepageLocation();
    const extension = Api.getConfig().browserExtension;
    const enabled = isHomepage && extension.enabled !== false && extension.hideHomepageCarousel !== false;
    const compactGrid = isHomepage && extension.enabled !== false;
    document.documentElement.toggleAttribute('data-pbp-hide-home-carousel', enabled);
    if (enabled) document.documentElement.setAttribute('data-pbp-hide-home-carousel', '1');
    document.documentElement.toggleAttribute('data-pbp-compact-home-grid', compactGrid);
    if (compactGrid) document.documentElement.setAttribute('data-pbp-compact-home-grid', '1');
    document.documentElement.removeAttribute('data-pbp-video-ad-filter');
    let count = 0;
    try {
      count = document.querySelectorAll(HOMEPAGE_CAROUSEL_SELECTOR).length;
    } catch (_) {
      // Keep layout filtering fail-open if Bilibili changes selector parsing.
    }
    Api.setLayoutStatus({
      hideHomepageCarousel: enabled,
      preferenceEnabled: extension.hideHomepageCarousel !== false,
      onHomepage: isHomepage,
      carouselFound: count > 0,
      hiddenElements: enabled ? count : 0,
      emptySlotsHidden: compactHomepageGrid(),
    });
  }

  function restoreAdCard(container) {
    if (container.dataset?.pbpAdHidden !== '1') return;
    const previous = container.dataset.pbpAdPreviousDisplay || '';
    if (previous) container.style.setProperty('display', previous);
    else container.style.removeProperty('display');
    delete container.dataset.pbpAdHidden;
    delete container.dataset.pbpAdPreviousDisplay;
    if (container.dataset.pbpBlockedUploader === '1' || container.dataset.pbpEmptyFeedSlot === '1') {
      container.style.setProperty('display', 'none', 'important');
    }
  }

  function hideAdCard(container) {
    const target = findHomepageGridItem(container);
    if (target.dataset.pbpAdHidden === '1') return;
    target.dataset.pbpAdPreviousDisplay = target.style.getPropertyValue('display');
    target.dataset.pbpAdHidden = '1';
    target.style.setProperty('display', 'none', 'important');
    adRecords.add(target);
    Api.record('adsDomHidden');
  }

  function hasAdMarker(card) {
    if (card.matches('.video-card-ad-small,.strip-ad,[data-ad="true"],[data-is-ad="1"]')) return true;
    if (card.querySelector('.bili-video-card__info--ad,.bili-video-card__stats--ad,.ad-report,[class*="ad-tag"],[class*="advert"]')) return true;
    const links = [...card.querySelectorAll('a[href]')];
    if (links.some((link) => /(?:cm\.bilibili\.com|bilibili\.com\/blackboard\/)/iu.test(link.href || ''))) return true;
    const labels = [...card.querySelectorAll('span,small,i')].slice(0, 30);
    return labels.some((label) => /^(?:广告|推广)$/u.test((label.textContent || '').trim()));
  }

  function isPageChromeElement(element) {
    return Boolean(closestAcrossRoots(element, PAGE_CHROME_SELECTOR));
  }

  function isVideoAdCard(card) {
    if (!(card instanceof Element) || !card.matches('.video-card-ad-small,.strip-ad')) return false;
    if (isPageChromeElement(card)) return false;
    return Boolean(closestAcrossRoots(card, VIDEO_CONTENT_REGION_SELECTOR));
  }

  function dynamicKeywordHit(card, keywords) {
    if (!card.matches('.bili-dyn-item,.dynamic-card-item')) return false;
    if (card.querySelector('[class*="goods"],[class*="shop"],[data-type="goods"]')) return true;
    const text = (card.textContent || '').trim();
    return text && keywords.some((keyword) => keyword && text.includes(keyword));
  }

  function scanAdRoot(root) {
    const rules = Api.getAdFilter();
    if (!rules.enabled) return;
    let cards = [];
    try {
      if (root instanceof Element && root.matches(AD_CARD_SELECTOR)) cards.push(root);
      cards.push(...root.querySelectorAll(AD_CARD_SELECTOR));
    } catch (_) {
      return;
    }
    const homepage = isHomepageLocation();
    for (const card of cards) {
      if ((homepage && rules.homepage !== false && hasAdMarker(card)) ||
          (rules.dynamic !== false && dynamicKeywordHit(card, rules.keywords || [])) ||
          (rules.video !== false && isVideoAdCard(card))) {
        hideAdCard(card);
      }
    }
  }

  function refreshDomAds() {
    for (const card of [...adRecords]) {
      if (!card.isConnected) adRecords.delete(card);
      else restoreAdCard(card);
    }
    for (const root of observedRoots) scanAdRoot(root);
  }

  function isHomepageLocation() {
    return location.hostname === 'www.bilibili.com' && /^(?:\/(?:zh-(?:Hans|CN))?)?\/?$/u.test(location.pathname);
  }

  function isHomepageGrid(element) {
    if (!(element instanceof Element) || !element.matches('.container')) return false;
    if (!closestAcrossRoots(element, HOMEPAGE_REGION_SELECTOR)) return false;
    if (element.matches('.is-version8')) return true;
    for (const child of element.children) {
      if (child.matches('.recommended-swipe,.feed-card,.bili-feed-card')) return true;
    }
    return false;
  }

  function findHomepageGrid(container) {
    let node = container;
    while (node) {
      if (isHomepageGrid(node)) return node;
      if (node.parentElement) {
        node = node.parentElement;
        continue;
      }
      const root = node.getRootNode?.();
      node = root instanceof ShadowRoot ? root.host : null;
    }
    return null;
  }

  function homepageGrids() {
    let candidates = [];
    try {
      candidates = [...document.querySelectorAll(HOMEPAGE_GRID_SELECTOR)];
    } catch (_) {
      return [];
    }
    return candidates.filter(isHomepageGrid);
  }

  function findHomepageGridItem(container) {
    if (!(container instanceof Element)) return container;
    const grid = findHomepageGrid(container);
    if (!grid) return container;
    let item = container;
    while (item.parentElement && item.parentElement !== grid) item = item.parentElement;
    return item.parentElement === grid ? item : container;
  }

  function restoreEmptyFeedSlot(container) {
    if (container.dataset?.pbpEmptyFeedSlot !== '1') return;
    const previous = container.dataset.pbpEmptyPreviousDisplay || '';
    if (previous) container.style.setProperty('display', previous);
    else container.style.removeProperty('display');
    delete container.dataset.pbpEmptyFeedSlot;
    delete container.dataset.pbpEmptyPreviousDisplay;
    if (container.dataset.pbpBlockedUploader === '1' || container.dataset.pbpAdHidden === '1') container.style.setProperty('display', 'none', 'important');
  }

  function compactHomepageGrid() {
    const isHomepage = isHomepageLocation();
    if (!isHomepage || Api.getConfig().browserExtension.enabled === false) return 0;
    let hidden = 0;
    const grids = homepageGrids();
    for (const grid of grids) {
      for (const item of grid.children) {
        if (!(item instanceof Element) || item.matches('.recommended-swipe')) continue;
        const isFeedCard = item.matches('.feed-card,.bili-feed-card');
        const isEmpty = isFeedCard && item.childElementCount === 0 && !(item.textContent || '').trim();
        if (isEmpty) {
          if (item.dataset.pbpEmptyFeedSlot !== '1') {
            item.dataset.pbpEmptyPreviousDisplay = item.style.getPropertyValue('display');
            item.dataset.pbpEmptyFeedSlot = '1';
            item.style.setProperty('display', 'none', 'important');
          }
          hidden += 1;
        } else {
          restoreEmptyFeedSlot(item);
        }
      }
    }
    return hidden;
  }

  function findDanmakuElement(event) {
    for (const item of event.composedPath?.() || []) {
      if (item instanceof Element && item.matches(Api.DOM_SELECTOR)) return item;
    }
    for (const item of document.elementsFromPoint?.(event.clientX, event.clientY) || []) {
      if (item.matches?.(Api.DOM_SELECTOR)) return item;
    }
    return null;
  }

  function currentVideoMs() {
    const videos = [...document.querySelectorAll('video')];
    const video = videos.find((item) => !item.paused && item.readyState > 0) || videos.find((item) => item.readyState > 0);
    return video && Number.isFinite(video.currentTime) ? video.currentTime * 1000 : null;
  }

  async function handleDanmakuClick(event) {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || danmakuMenuBusy) return;
    const element = findDanmakuElement(event);
    if (!element || element.dataset.pbpBlocked === '1') return;
    const content = (element.textContent || '').trim();
    if (!content) return;
    event.preventDefault();
    event.stopPropagation();
    danmakuMenuBusy = true;
    try {
      const sender = await Api.requestDanmakuSender(content, currentVideoMs());
      const current = Api.getConfig();
      const gentleExists = current.danmakuAssistant.gentleRules.includes(content);
      const absoluteExists = current.danmakuAssistant.absoluteRules.includes(content);
      const senderHash = sender?.found && !sender.ambiguous ? sender.midHash : null;
      const senderExists = senderHash ? current.danmakuRules.uidHashes.includes(senderHash) : false;
      const senderDetail = senderHash
        ? (senderExists ? '该发送者哈希已在规则中' : `仅保存匿名 midHash ${senderHash}`)
        : (sender?.ambiguous ? `同文案附近对应 ${sender.candidates} 条记录，无法唯一确定` : '当前弹幕没有可用的发送者映射');
      Api.record('danmakuMenus');
      const action = await showActionSheet({
        title: '屏蔽这条弹幕',
        body: content,
        actions: [
          { id: 'gentle', label: gentleExists ? '已在温和屏蔽中' : '加入温和屏蔽', detail: '仅屏蔽内容完全相同的弹幕（推荐）', disabled: gentleExists },
          { id: 'absolute', label: absoluteExists ? '已在绝对屏蔽中' : '加入绝对屏蔽', detail: '屏蔽所有包含这段文字的弹幕', disabled: absoluteExists },
          { id: 'sender', label: senderExists ? '发送者已屏蔽' : '屏蔽弹幕发送者', detail: senderDetail, disabled: !senderHash || senderExists, danger: true },
        ],
      });
      if (action === 'gentle' || action === 'absolute') {
        const absolute = action === 'absolute';
        const added = await Api.addDanmakuTextRule(content, absolute);
        if (!added) return showToast('该规则已存在');
        element.style.setProperty('display', 'none', 'important');
        element.dataset.pbpBlocked = '1';
        showToast(absolute ? '已加入绝对屏蔽' : '已加入温和屏蔽', async () => {
          await Api.removeDanmakuTextRule(content, absolute);
          element.style.removeProperty('display');
          delete element.dataset.pbpBlocked;
          Api.recheckDomDanmaku();
        });
      } else if (action === 'sender') {
        const added = await Api.addUidHash(senderHash);
        if (!added) return showToast('该发送者已在屏蔽规则中');
        element.style.setProperty('display', 'none', 'important');
        element.dataset.pbpBlocked = '1';
        showToast('已屏蔽该弹幕发送者', async () => {
          await Api.removeUidHash(senderHash);
          element.style.removeProperty('display');
          delete element.dataset.pbpBlocked;
        });
      }
    } finally {
      danmakuMenuBusy = false;
    }
  }

  function parseSpaceMid(anchor) {
    try {
      const url = new URL(anchor.href || anchor.getAttribute('href') || '', location.href);
      if (url.hostname !== 'space.bilibili.com') return null;
      const match = /^\/(\d+)(?:\/|$)/u.exec(url.pathname);
      if (!match) return null;
      const mid = Number(match[1]);
      return Number.isSafeInteger(mid) && mid > 0 ? mid : null;
    } catch (_) {
      return null;
    }
  }

  function closestAcrossRoots(start, selector) {
    let node = start;
    while (node) {
      if (node instanceof Element && node.matches(selector)) return node;
      if (node.parentElement) {
        node = node.parentElement;
        continue;
      }
      const root = node.getRootNode?.();
      node = root instanceof ShadowRoot ? root.host : null;
    }
    return null;
  }

  function nameScore(anchor) {
    const descriptor = `${typeof anchor.className === 'string' ? anchor.className : ''} ${anchor.getAttribute('data-usercard-mid') || ''} ${anchor.getAttribute('aria-label') || ''}`;
    let score = /(?:user|name|member|author|avatar|nickname)/iu.test(descriptor) ? 10 : 0;
    if ((anchor.textContent || '').trim()) score += 4;
    if (/^(?:回复|@)/u.test((anchor.textContent || '').trim())) score -= 8;
    return score;
  }

  function styleCommentButton(button) {
    button.style.cssText = [
      'display:inline-flex', 'align-items:center', 'justify-content:center', 'vertical-align:middle',
      'margin-left:5px', 'padding:1px 5px', 'min-width:24px', 'height:20px',
      'border:1px solid rgba(251,114,153,.65)', 'border-radius:6px',
      'background:transparent', 'color:#fb7299', 'font:12px/1 system-ui,sans-serif',
      'cursor:pointer', 'pointer-events:auto',
    ].join(';');
  }

  function styleUploaderButton(button) {
    styleCommentButton(button);
    button.style.marginLeft = '6px';
    button.style.borderColor = 'rgba(0,161,214,.65)';
    button.style.color = '#00a1d6';
    button.style.whiteSpace = 'nowrap';
  }

  function restoreCommentContainer(container) {
    if (container.dataset?.pbpMutedComment !== '1') return;
    const previous = container.dataset.pbpPreviousDisplay || '';
    if (previous) container.style.setProperty('display', previous);
    else container.style.removeProperty('display');
    delete container.dataset.pbpMutedComment;
    delete container.dataset.pbpPreviousDisplay;
  }

  function applyMutedComments() {
    const muted = new Set(Api.getConfig().mutedUsers.map((user) => Number(user.mid)));
    for (const record of [...commentRecords]) {
      if (!record.button.isConnected || !record.container.isConnected) {
        commentRecords.delete(record);
        continue;
      }
      if (muted.has(record.mid)) {
        if (record.container.dataset.pbpMutedComment !== '1') {
          record.container.dataset.pbpPreviousDisplay = record.container.style.getPropertyValue('display');
          record.container.dataset.pbpMutedComment = '1';
          record.container.style.setProperty('display', 'none', 'important');
        }
      } else {
        restoreCommentContainer(record.container);
      }
    }
  }

  async function handleCommentAction(record, event) {
    event.preventDefault();
    event.stopPropagation();
    const config = Api.getConfig();
    const muted = config.mutedUsers.some((user) => Number(user.mid) === record.mid);
    const marked = config.markedUsers.some((user) => Number(user.mid) === record.mid);
    const action = await showActionSheet({
      title: record.name || `UID ${record.mid}`,
      body: `UID：${record.mid}`,
      actions: [
        { id: 'mute', label: muted ? '取消评论屏蔽' : '屏蔽此账号的评论', detail: muted ? '恢复显示该账号的评论' : '写入与 PiliPlus 共用的 mutedUsers', danger: !muted },
        { id: 'mark', label: marked ? '从标记库移除' : '加入标记库', detail: '用于之后检查账号行为' },
      ],
    });
    if (action === 'mute') {
      if (muted) {
        await Api.removeMutedUser(record.mid);
        applyMutedComments();
        showToast('已取消评论屏蔽', async () => {
          await Api.addMutedUser(record.mid, record.name);
          applyMutedComments();
        });
      } else {
        const added = await Api.addMutedUser(record.mid, record.name);
        if (!added) return showToast('该账号已在评论屏蔽列表中');
        applyMutedComments();
        showToast('已屏蔽该账号的评论', async () => {
          await Api.removeMutedUser(record.mid);
          applyMutedComments();
        });
      }
    } else if (action === 'mark') {
      const nowMarked = await Api.toggleMarkedUser(record.mid, record.name);
      showToast(nowMarked ? '已加入标记库' : '已从标记库移除', async () => {
        await Api.toggleMarkedUser(record.mid, record.name);
      });
    }
  }

  function scanCommentRoot(root) {
    let anchors;
    try {
      anchors = root instanceof Element && root.matches('a[href*="space.bilibili.com/"]') ? [root] : [];
      anchors.push(...root.querySelectorAll('a[href*="space.bilibili.com/"]'));
    } catch (_) {
      return;
    }
    const grouped = new Map();
    for (const anchor of anchors) {
      const mid = parseSpaceMid(anchor);
      if (!mid) continue;
      const container = closestAcrossRoots(anchor, COMMENT_CONTAINER_SELECTOR);
      const region = closestAcrossRoots(anchor, COMMENT_REGION_SELECTOR);
      if (!container || !region) continue;
      const candidate = { anchor, mid, score: nameScore(anchor) };
      const previous = grouped.get(container);
      if (!previous || candidate.score > previous.score) grouped.set(container, candidate);
    }
    for (const [container, candidate] of grouped) {
      const existing = commentByContainer.get(container);
      if (existing?.button.isConnected) continue;
      if (existing) commentRecords.delete(existing);
      const name = (candidate.anchor.textContent || candidate.anchor.getAttribute('title') || '').trim();
      const button = createElement('button', '', '净化');
      button.type = 'button';
      button.title = '屏蔽其评论或加入标记库';
      button.dataset.pbpCommentAction = '1';
      button.dataset.mid = String(candidate.mid);
      styleCommentButton(button);
      const record = { button, container, mid: candidate.mid, name };
      button.addEventListener('click', (event) => {
        handleCommentAction(record, event).catch((error) => showToast(`评论净化操作失败：${error.message}`));
      });
      candidate.anchor.insertAdjacentElement('afterend', button);
      commentByContainer.set(container, record);
      commentRecords.add(record);
      Api.record('commentButtons');
    }
    applyMutedComments();
  }

  function restoreUploaderCard(container) {
    if (container.dataset?.pbpBlockedUploader !== '1') return;
    const previous = container.dataset.pbpUploaderPreviousDisplay || '';
    if (previous) container.style.setProperty('display', previous);
    else container.style.removeProperty('display');
    delete container.dataset.pbpBlockedUploader;
    delete container.dataset.pbpUploaderPreviousDisplay;
    if (container.dataset.pbpEmptyFeedSlot === '1' || container.dataset.pbpAdHidden === '1') container.style.setProperty('display', 'none', 'important');
  }

  function applyBlockedUploaders() {
    const blocked = new Set(Api.getConfig().uploaderRules.users.map((user) => Number(user.mid)));
    for (const record of [...uploaderRecords]) {
      if (!record.container.isConnected) {
        uploaderRecords.delete(record);
        continue;
      }
      if (blocked.has(record.mid)) {
        if (record.container.dataset.pbpBlockedUploader !== '1') {
          record.container.dataset.pbpUploaderPreviousDisplay = record.container.style.getPropertyValue('display');
          record.container.dataset.pbpBlockedUploader = '1';
          record.container.style.setProperty('display', 'none', 'important');
          Api.record('uploaderCardsHidden');
        }
      } else {
        restoreUploaderCard(record.container);
      }
    }
  }

  async function handleUploaderAction(record, event) {
    event.preventDefault();
    event.stopPropagation();
    const alreadyBlocked = Api.isUploaderBlocked(record.mid);
    const action = await showActionSheet({
      title: record.name || `UID ${record.mid}`,
      body: `UID：${record.mid}`,
      actions: [{
        id: alreadyBlocked ? 'unblock' : 'block',
        label: alreadyBlocked ? '取消屏蔽此 UP 主' : '屏蔽此 UP 主',
        detail: alreadyBlocked ? '恢复页面中该 UP 主的内容' : '隐藏首页、搜索、动态与相关推荐内容',
        danger: !alreadyBlocked,
      }],
    });
    if (action === 'block') {
      const added = await Api.addBlockedUploader(record.mid, record.name);
      if (!added) return showToast('该 UP 主已在屏蔽名单中');
      applyBlockedUploaders();
      showToast(`已屏蔽 ${record.name || `UID ${record.mid}`}`, async () => {
        await Api.removeBlockedUploader(record.mid);
        applyBlockedUploaders();
      });
    } else if (action === 'unblock') {
      await Api.removeBlockedUploader(record.mid);
      applyBlockedUploaders();
      showToast('已取消屏蔽该 UP 主', async () => {
        await Api.addBlockedUploader(record.mid, record.name);
        applyBlockedUploaders();
      });
    }
  }

  function scanUploaderRoot(root) {
    let anchors;
    try {
      anchors = root instanceof Element && root.matches('a[href*="space.bilibili.com/"]') ? [root] : [];
      anchors.push(...root.querySelectorAll('a[href*="space.bilibili.com/"]'));
    } catch (_) {
      return;
    }
    const grouped = new Map();
    for (const anchor of anchors) {
      const mid = parseSpaceMid(anchor);
      if (!mid || closestAcrossRoots(anchor, COMMENT_REGION_SELECTOR) || isPageChromeElement(anchor)) continue;
      const nearestContainer = closestAcrossRoots(anchor, UPLOADER_CARD_SELECTOR);
      if (!nearestContainer) continue;
      const container = findHomepageGridItem(nearestContainer);
      const candidate = { anchor, mid, score: nameScore(anchor) };
      const previous = grouped.get(container);
      if (!previous || candidate.score > previous.score) grouped.set(container, candidate);
    }
    for (const [container, candidate] of grouped) {
      const existing = uploaderByContainer.get(container);
      if (existing?.button.isConnected && existing.mid === candidate.mid) continue;
      if (existing) {
        existing.button.remove();
        uploaderRecords.delete(existing);
        restoreUploaderCard(container);
      }
      const name = (candidate.anchor.textContent || candidate.anchor.getAttribute('title') || '').trim();
      const button = createElement('button', '', '屏蔽UP');
      button.type = 'button';
      button.title = '隐藏此 UP 主发布或投稿的内容';
      button.dataset.pbpUploaderAction = '1';
      button.dataset.mid = String(candidate.mid);
      styleUploaderButton(button);
      const record = { button, container, mid: candidate.mid, name };
      button.addEventListener('click', (event) => {
        handleUploaderAction(record, event).catch((error) => showToast(`UP 主屏蔽操作失败：${error.message}`));
      });
      candidate.anchor.insertAdjacentElement('afterend', button);
      uploaderByContainer.set(container, record);
      uploaderRecords.add(record);
      Api.record('uploaderButtons');
    }
    applyBlockedUploaders();
  }

  function discoverShadowRoots(node) {
    if (!(node instanceof Element || node instanceof Document || node instanceof ShadowRoot)) return;
    if (node instanceof Element && node.shadowRoot) observeRoot(node.shadowRoot);
    let hosts = [];
    try {
      hosts = [...node.querySelectorAll(COMMENT_HOST_SELECTOR)];
    } catch (_) {
      return;
    }
    for (const host of hosts) if (host.shadowRoot) observeRoot(host.shadowRoot);
  }

  function observeListContainer(container) {
    if (!(container instanceof Element) || observedListContainers.has(container)) return;
    if (container.matches(HOMEPAGE_GRID_SELECTOR) && !isHomepageGrid(container)) return;
    observedListContainers.add(container);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          discoverShadowRoots(node);
          discoverListContainers(node);
          scheduleContentScan(node);
        }
      }
    });
    observer.observe(container, { childList: true });
  }

  function discoverListContainers(node) {
    if (!(node instanceof Element || node instanceof Document || node instanceof ShadowRoot)) return;
    if (node instanceof Element && node.matches(LIST_CONTAINER_SELECTOR)) observeListContainer(node);
    let containers = [];
    try {
      containers = [...node.querySelectorAll(LIST_CONTAINER_SELECTOR)];
    } catch (_) {
      return;
    }
    for (const container of containers) observeListContainer(container);
  }

  function scheduleContentScan(root = document) {
    pendingRoots.add(root);
    if (scanScheduled) return;
    scanScheduled = true;
    requestAnimationFrame(() => {
      scanScheduled = false;
      const roots = [...pendingRoots];
      pendingRoots.clear();
      for (const root of roots) {
        scanCommentRoot(root);
        scanUploaderRoot(root);
        scanAdRoot(root);
      }
      applyLayoutPreferences();
    });
  }

  function observeRoot(root) {
    if (observedRoots.has(root)) return;
    observedRoots.add(root);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          discoverShadowRoots(node);
          discoverListContainers(node);
          scheduleContentScan(node);
        }
      }
    });
    observer.observe(root, { childList: true, subtree: true });
    discoverShadowRoots(root);
    discoverListContainers(root);
    scheduleContentScan(root);
  }

  function startInteractions() {
    if (!document.documentElement || document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startInteractions, { once: true });
      return;
    }
    installDanmakuPointerStyle();
    installLayoutStyle();
    applyLayoutPreferences();
    document.addEventListener('click', (event) => {
      handleDanmakuClick(event).catch((error) => showToast(`弹幕净化操作失败：${error.message}`));
    }, true);
    observeRoot(document);
    setInterval(() => {
      discoverShadowRoots(document);
      discoverListContainers(document);
    }, 10_000);
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.purifyConfig) {
        setTimeout(() => {
          scheduleContentScan(document);
          applyMutedComments();
          applyBlockedUploaders();
          applyLayoutPreferences();
          refreshDomAds();
        }, 50);
      }
    });
    window.addEventListener('pbp-config-changed', () => {
      applyLayoutPreferences();
      applyMutedComments();
      applyBlockedUploaders();
      refreshDomAds();
    });
  }

  startInteractions();
})();
