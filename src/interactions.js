(() => {
  'use strict';

  const MARKER = '__PBP_INTERACTIONS_V1__';
  if (globalThis[MARKER]) return;
  Object.defineProperty(globalThis, MARKER, { value: true, configurable: true });

  const Api = globalThis.PiliPlusPurifyContentApi;
  const CommentScoring = globalThis.PiliPlusPurifyCommentScoring;
  if (!Api || !CommentScoring) return;

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
  const COMMENT_HOST_SELECTOR = 'bili-comments, bili-comment-thread-renderer, bili-comment-renderer, bili-comment-replies-renderer, bili-comment-reply-renderer';
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
    '.floor-single-card',
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
  const hiddenComments = new Map();
  const revealedRpids = new Set();
  const pendingCommentAccounts = new Map();
  const dismissedCandidateMids = new Set();
  const commentHideStats = {
    hidden: 0,
    restored: 0,
    routeResets: 0,
  };
  const commentScoringStats = {
    routeResets: 0,
  };
  let commentScoringCurrent = {
    scored: 0,
    pureMention: 0,
    shortComments: 0,
    emoteOnly: 0,
    pendingComments: 0,
  };
  const uploaderByContainer = new WeakMap();
  const uploaderRecords = new Set();
  const adRecords = new Set();
  const ROUTE_SETTLE_MS = 1500;
  const INCREMENTAL_SCAN_DELAY_MS = 80;
  const HOMEPAGE_AUTOFILL_DELAY_MS = 1200;
  const HOMEPAGE_GRID_SLOTS = 24;
  const HOMEPAGE_VIDEO_SLOTS = 22;
  const FEEDBACK_URL = 'https://github.com/snyb12138/piliplus-web-filter/issues';
  let scanScheduled = false;
  let scanTimer = null;
  let activeRoute = `${location.origin}${location.pathname}${location.search}`;
  let routeHoldUntil = 0;
  let videoInteractionHoldUntil = 0;
  let danmakuMenuBusy = false;
  let homepageRefreshReloading = false;
  let homepageAutofillTimer = null;
  let homepageRefreshError = null;
  let uiHost;
  let uiRoot;
  let toastTimer;
  let commentSidePanel;

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
      .comment-side{position:fixed;right:12px;top:148px;width:184px;display:grid;gap:8px;pointer-events:auto;font:13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--text1,#18191c)}
      .comment-side:has(details[open]){width:min(310px,calc(100vw - 24px))}.comment-side details{border:1px solid var(--line_regular,#e3e5e7);border-radius:10px;background:var(--bg1,#fff);box-shadow:0 6px 22px rgba(0,0,0,.12);overflow:hidden}
      .comment-side summary{display:flex;align-items:center;justify-content:space-between;gap:8px;list-style:none;padding:9px 11px;cursor:pointer;font-weight:650;color:var(--text1,#18191c);user-select:none}.comment-side summary::-webkit-details-marker{display:none}.comment-side summary::after{content:'›';font-size:18px;color:#9499a0;transform:rotate(90deg)}.comment-side details[open] summary::after{transform:rotate(-90deg)}
      .side-list{display:grid;gap:7px;max-height:min(42vh,420px);overflow:auto;padding:0 9px 9px}.side-empty{padding:4px 2px 7px;color:var(--text3,#9499a0)}.side-item{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:5px 8px;align-items:center;padding:8px;border-radius:8px;background:var(--bg2,#f6f7f8)}.side-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}.side-meta{grid-column:1/-1;color:var(--text3,#9499a0);font-size:11px;overflow-wrap:anywhere}.side-actions{display:flex;gap:5px}.side-actions button{border:0;border-radius:6px;padding:4px 7px;background:var(--bg3,#e3e5e7);color:var(--text2,#61666d);cursor:pointer}.side-actions button.primary{background:#00aeec;color:#fff}.side-more{padding:4px 2px;color:var(--text3,#9499a0);font-size:11px}
      @media(prefers-color-scheme:dark){.card{background:#24262b;color:#f5f6f7}.body,.action-detail{color:#afb3bb}.action{background:#24262b;color:#f5f6f7;border-color:#40434b}.action:hover{background:#33272d}.action.danger{color:#ff92ad}.cancel{color:#afb3bb}}
      @media(max-width:900px){.comment-side{top:auto;bottom:14px;right:10px}}
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
      html[data-pbp-hide-home-carousel="1"] [data-pbp-home-grid="1"]{
        grid-auto-flow:row dense!important;
      }
      html[data-pbp-hide-home-carousel="1"] [data-pbp-home-grid="1"] > :not(.recommended-swipe){
        grid-area:auto!important;
        grid-column:auto!important;
        grid-row:auto!important;
        order:0!important;
        margin-top:0!important;
        align-self:start!important;
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
      html[data-pbp-home-paged="1"] [data-pbp-home-grid="1"] > [data-pbp-page-overflow="1"],
      html[data-pbp-home-paged="1"] [data-pbp-home-grid="1"] > [data-pbp-page-pending="1"]{
        display:none!important;
      }
      html[data-pbp-home-paged-ready="1"] [data-pbp-home-grid="1"] .load-more-anchor{
        display:none!important;
      }
      html[data-pbp-home-paged="1"] :is(.flexible-roll-btn,.flexible-roll-btn-inner){
        display:none!important;
      }
      html[data-pbp-home-paged="1"] [data-pbp-home-grid="1"] > [data-pbp-native-hidden="1"]{
        display:none!important;
      }
      html[data-pbp-home-paged="1"] [data-pbp-home-grid="1"] > .pbp-home-custom-card{
        display:block!important;
        min-width:0!important;
        overflow:visible!important;
      }
      .pbp-home-custom-cover{position:relative;display:block;overflow:hidden;border-radius:6px;background:#f1f2f3;aspect-ratio:16/9}
      .pbp-home-custom-cover img{display:block;width:100%;height:100%;object-fit:cover;transition:transform .2s ease}
      .pbp-home-custom-cover:hover img{transform:scale(1.025)}
      .pbp-home-custom-duration{position:absolute;right:6px;bottom:5px;padding:1px 5px;border-radius:4px;background:rgba(0,0,0,.64);color:#fff;font-size:12px;line-height:18px}
      .pbp-home-custom-info{padding-top:9px;min-width:0}
      .pbp-home-custom-title{display:-webkit-box;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:2;min-height:44px;color:var(--text1,#18191c);font-size:15px;line-height:22px;text-decoration:none}
      .pbp-home-custom-title:hover{color:#00aeec}
      .pbp-home-custom-meta{display:flex;align-items:center;gap:8px;margin-top:4px;min-width:0;color:var(--text3,#9499a0);font-size:13px;line-height:20px}
      .pbp-home-custom-owner{overflow:hidden;min-width:0;color:inherit;text-overflow:ellipsis;white-space:nowrap;text-decoration:none}
      .pbp-home-custom-owner:hover{color:#00aeec}
      .pbp-home-custom-stat{flex:none;white-space:nowrap}
      html[data-pbp-home-paged="1"] [data-pbp-home-grid="1"] > [data-pbp-home-stats="1"]{
        display:flex!important;
        grid-column:span 2!important;
        grid-row:auto!important;
        align-self:stretch!important;
        min-width:0!important;
        min-height:172px;
        padding:18px 20px!important;
        border:1px solid rgba(0,0,0,.08);
        border-radius:12px;
        background:rgba(255,255,255,.96);
        color:#18191c;
        box-shadow:0 2px 10px rgba(0,0,0,.04);
        flex-direction:column;
        justify-content:space-between;
        gap:14px;
        box-sizing:border-box;
      }
      [data-pbp-home-stats="1"] .pbp-stats-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
      [data-pbp-home-stats="1"] .pbp-stats-title{font-size:16px;font-weight:700}
      [data-pbp-home-stats="1"] .pbp-stats-state{font-size:12px;color:#00aeec}
      [data-pbp-home-stats="1"] .pbp-stats-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
      [data-pbp-home-stats="1"] .pbp-stat{min-width:0;padding:10px;border-radius:9px;background:rgba(0,174,236,.07)}
      [data-pbp-home-stats="1"] .pbp-stat-value{display:block;font-size:20px;font-weight:750;line-height:1.2;color:#00aeec}
      [data-pbp-home-stats="1"] .pbp-stat-label{display:block;margin-top:3px;font-size:12px;white-space:nowrap;color:#61666d}
      [data-pbp-home-stats="1"] .pbp-stats-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:12px;color:#9499a0}
      [data-pbp-home-stats="1"] .pbp-stats-links{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
      [data-pbp-home-stats="1"] .pbp-stats-link{border:0;background:transparent;color:#00aeec;padding:0;cursor:pointer;text-decoration:none;font:inherit}
      [data-pbp-home-stats="1"] .pbp-stats-link:hover{text-decoration:underline}
      html[class*="dark"] [data-pbp-home-stats="1"]{border-color:rgba(255,255,255,.08);background:rgba(31,33,36,.96);color:#f1f2f3;box-shadow:none}
      html[class*="dark"] [data-pbp-home-stats="1"] .pbp-stat{background:rgba(0,174,236,.12)}
      html[class*="dark"] [data-pbp-home-stats="1"] .pbp-stat-label{color:#a2a7ae}
      :is(html[class*="dark"],html[data-theme="dark"],html[theme="dark"],body[class*="dark"]) .pbp-home-custom-title{color:var(--text1,#f1f2f3)}
      :is(html[class*="dark"],html[data-theme="dark"],html[theme="dark"],body[class*="dark"]) .pbp-home-custom-meta{color:var(--text3,#a2a7ae)}
      @media(prefers-color-scheme:dark){
        .pbp-home-custom-title{color:var(--text1,#f1f2f3)}
        .pbp-home-custom-meta{color:var(--text3,#a2a7ae)}
        [data-pbp-home-stats="1"]{border-color:rgba(255,255,255,.08)!important;background:rgba(31,33,36,.96)!important;color:#f1f2f3!important;box-shadow:none!important}
        [data-pbp-home-stats="1"] .pbp-stat{background:rgba(0,174,236,.12)!important}
        [data-pbp-home-stats="1"] .pbp-stat-label{color:#a2a7ae!important}
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
    const emptySlotsHidden = compactHomepageGrid();
    const page = applyHomepagePageLimit();
    const grid = inspectHomepageGridLayout();
    Api.setLayoutStatus({
      hideHomepageCarousel: enabled,
      preferenceEnabled: extension.hideHomepageCarousel !== false,
      onHomepage: isHomepage,
      carouselFound: count > 0,
      hiddenElements: enabled ? count : 0,
      emptySlotsHidden,
      gridCount: grid.gridCount,
      gridItems: grid.gridItems,
      visibleGridItems: grid.visibleGridItems,
      firstRowOffsetSpread: grid.firstRowOffsetSpread,
      maxItemMarginTop: grid.maxItemMarginTop,
      pagedMode: page.enabled,
      pageSize: HOMEPAGE_VIDEO_SLOTS,
      gridSlots: HOMEPAGE_GRID_SLOTS,
      pageVisible: page.visible,
      pageOverflowHidden: page.overflowHidden,
      pagePendingHidden: page.pendingHidden,
      pageReady: page.ready,
      loadAnchorsSuppressed: page.loadAnchorsSuppressed,
      nativeRefreshButtons: page.nativeRefreshButtons,
      statsPanelMounted: page.statsPanelMounted,
      refreshSettling: page.refreshSettling,
      inactiveGridsIgnored: page.inactiveGridsIgnored,
      customBatchActive: page.customBatchActive,
      customBatchRendered: page.customBatchRendered,
      nativeSlotsSuppressed: page.nativeSlotsSuppressed,
      refreshError: page.refreshError,
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
    if (card.matches('.floor-single-card')) return true;
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

  function isVideoPageLocation() {
    return location.hostname === 'www.bilibili.com' && /^\/(?:zh-(?:Hans|CN)\/)?video\//u.test(location.pathname);
  }

  function videoAdDomFallbackAllowed() {
    return !isVideoPageLocation() || Api.getConfig().browserExtension.videoPageDomEnhancements === true;
  }

  function scanAdRoot(root) {
    if (!videoAdDomFallbackAllowed()) return;
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
      if (isHomepageGrid(node)) {
        node.dataset.pbpHomeGrid = '1';
        return node;
      }
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
    return candidates.filter(isHomepageGrid).map((grid) => {
      grid.dataset.pbpHomeGrid = '1';
      return grid;
    });
  }

  function isNativelyVisible(element) {
    if (!(element instanceof Element) || element.hidden || element.getAttribute('aria-hidden') === 'true') return false;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number.parseFloat(style.opacity || '1') <= 0.01) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 2 && rect.height > 2;
  }

  function activeHomepageGrid(grids = homepageGrids()) {
    let best = null;
    let bestScore = -1;
    for (let index = 0; index < grids.length; index += 1) {
      const grid = grids[index];
      if (!isNativelyVisible(grid)) continue;
      let visibleVideos = 0;
      for (const item of grid.children) {
        if (item.matches?.('[data-pbp-home-stats],.recommended-swipe,.load-more-anchor')) continue;
        if (isNativelyVisible(item) && isHomepageVideoItem(item)) visibleVideos += 1;
      }
      // Prefer the grid with the most actually rendered videos. A later grid
      // wins ties because Bilibili appends the replacement grid after the old one.
      const score = visibleVideos * 1000 + index;
      if (score >= bestScore) {
        best = grid;
        bestScore = score;
      }
    }
    return best;
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

  function isHomepageVideoItem(item) {
    if (!(item instanceof Element)) return false;
    if (item.matches('.recommended-swipe,.load-more-anchor,script,style')) return false;
    return Boolean(item.querySelector('a[href*="/video/"]'));
  }

  function homepageRuleCount() {
    const config = Api.getConfig();
    return (config.mutedUsers?.length || 0) +
      (config.uploaderRules?.users?.length || 0) +
      (config.danmakuRules?.uidHashes?.length || 0) +
      (config.danmakuRules?.keywords?.length || 0) +
      (config.danmakuRules?.regex?.length || 0) +
      (config.danmakuAssistant?.absoluteRules?.length || 0) +
      (config.danmakuAssistant?.gentleRules?.length || 0);
  }

  function updateHomepageStatsPanel(panel) {
    const snapshot = Api.getStatusSnapshot();
    const interaction = snapshot.interaction || {};
    const ads = Number(interaction.adsDomHidden || 0) + Number(interaction.adsApiDropped || 0);
    const uploaders = Number(interaction.uploaderCardsHidden || 0) + Number(interaction.uploaderApiDropped || 0);
    const danmaku = Number(snapshot.blocked || 0);
    const total = ads + uploaders + danmaku;
    const values = { total, ads, uploaders, rules: homepageRuleCount() };
    for (const [key, value] of Object.entries(values)) {
      const target = panel.querySelector(`[data-pbp-stat="${key}"]`);
      if (target) target.textContent = String(value);
    }
    const state = panel.querySelector('[data-pbp-stats-state]');
    if (state) state.textContent = snapshot.connected && snapshot.rulesReady ? '过滤已就绪' : '规则连接中';
  }

  function ensureHomepageStatsPanel(enabled, grid) {
    const panels = [...document.querySelectorAll('[data-pbp-home-stats="1"]')];
    const existing = panels.find((panel) => panel.parentElement === grid) || panels[0];
    if (!enabled) {
      panels.forEach((panel) => panel.remove());
      return false;
    }
    if (!grid) return false;
    let panel = existing;
    if (!panel || panel.parentElement !== grid) {
      panels.forEach((candidate) => candidate.remove());
      panel = createElement('section', 'pbp-home-stats');
      panel.dataset.pbpHomeStats = '1';
      panel.setAttribute('aria-label', 'PiliPlus 净化统计');
      const head = createElement('div', 'pbp-stats-head');
      head.append(createElement('span', 'pbp-stats-title', '净化统计'));
      const state = createElement('span', 'pbp-stats-state', '规则连接中');
      state.dataset.pbpStatsState = '1';
      head.append(state);
      const metrics = createElement('div', 'pbp-stats-grid');
      for (const [key, label] of [['total', '本次已屏蔽'], ['ads', '广告与推广'], ['uploaders', 'UP 投稿'], ['rules', '规则库']]) {
        const metric = createElement('div', 'pbp-stat');
        const value = createElement('span', 'pbp-stat-value', '0');
        value.dataset.pbpStat = key;
        metric.append(value, createElement('span', 'pbp-stat-label', label));
        metrics.append(metric);
      }
      const foot = createElement('div', 'pbp-stats-foot');
      foot.append(createElement('span', '', 'PiliPlus Web Filter'));
      const links = createElement('div', 'pbp-stats-links');
      const options = createElement('button', 'pbp-stats-link', '管理规则');
      options.type = 'button';
      options.addEventListener('click', () => chrome.runtime.openOptionsPage());
      const feedback = createElement('a', 'pbp-stats-link', '问题反馈 · GitHub Issues');
      feedback.href = FEEDBACK_URL;
      feedback.target = '_blank';
      feedback.rel = 'noopener noreferrer';
      feedback.title = FEEDBACK_URL;
      links.append(options, feedback);
      foot.append(links);
      panel.append(head, metrics, foot);
      grid.append(panel);
    }
    updateHomepageStatsPanel(panel);
    return true;
  }

  function formatHomepageDuration(rawSeconds) {
    const total = Math.max(0, Math.floor(Number(rawSeconds) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    return hours > 0
      ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      : `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  function formatHomepageCount(raw) {
    const value = Math.max(0, Number(raw) || 0);
    if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(value >= 1_000_000_000 ? 0 : 1)}亿`;
    if (value >= 10_000) return `${(value / 10_000).toFixed(value >= 100_000 ? 0 : 1)}万`;
    return String(Math.floor(value));
  }

  function normalizeHomepageImage(raw) {
    const value = String(raw || '');
    return value.startsWith('//') ? `https:${value}` : value;
  }

  function createHomepageVideoCard(item) {
    const bvid = String(item?.bvid || '').trim();
    if (!/^BV[0-9A-Za-z]+$/u.test(bvid)) return null;
    const card = createElement('article', 'feed-card pbp-home-custom-card');
    card.dataset.pbpCustomVideo = bvid;
    const videoUrl = `https://www.bilibili.com/video/${bvid}/`;
    const cover = createElement('a', 'pbp-home-custom-cover');
    cover.href = videoUrl;
    const image = createElement('img');
    image.src = normalizeHomepageImage(item.pic);
    image.alt = String(item.title || '视频封面');
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    cover.append(image, createElement('span', 'pbp-home-custom-duration', formatHomepageDuration(item.duration)));
    const info = createElement('div', 'pbp-home-custom-info');
    const title = createElement('a', 'pbp-home-custom-title', String(item.title || '未命名视频'));
    title.href = videoUrl;
    title.title = String(item.title || '');
    const meta = createElement('div', 'pbp-home-custom-meta');
    const ownerMid = Math.max(0, Number(item?.owner?.mid) || 0);
    const owner = createElement('a', 'pbp-home-custom-owner', String(item?.owner?.name || '未知 UP 主'));
    owner.href = ownerMid ? `https://space.bilibili.com/${ownerMid}` : videoUrl;
    owner.title = String(item?.owner?.name || '');
    const stat = createElement('span', 'pbp-home-custom-stat', `${formatHomepageCount(item?.stat?.view)} 播放`);
    meta.append(owner, stat);
    info.append(title, meta);
    card.append(cover, info);
    return card;
  }

  function restoreHomepageNativeCards() {
    for (const item of document.querySelectorAll('[data-pbp-native-hidden="1"]')) {
      item.removeAttribute('data-pbp-native-hidden');
    }
    for (const card of document.querySelectorAll('.pbp-home-custom-card')) card.remove();
  }

  function suppressHomepageNativeGridItems(grid) {
    if (!(grid instanceof Element)) return 0;
    let suppressed = 0;
    for (const item of grid.children) {
      if (!(item instanceof Element) || item.matches('.recommended-swipe,.load-more-anchor,[data-pbp-home-stats],.pbp-home-custom-card,script,style')) continue;
      // Preserve the fixed refresh control if Bilibili ever moves it inside the
      // recommendation grid. Floating refresh controls are hidden separately.
      if (item.matches('.feed-roll-btn,button.roll-btn') || item.querySelector('.feed-roll-btn,button.roll-btn')) continue;
      item.dataset.pbpNativeHidden = '1';
      suppressed += 1;
    }
    return suppressed;
  }

  function renderHomepageBatch(items) {
    const grid = activeHomepageGrid();
    if (!grid) throw new Error('没有找到首页推荐网格');
    const cards = items.slice(0, HOMEPAGE_VIDEO_SLOTS).map(createHomepageVideoCard).filter(Boolean);
    if (!cards.length) throw new Error('换批结果中没有可渲染的视频');
    for (const old of grid.querySelectorAll(':scope > .pbp-home-custom-card')) old.remove();
    suppressHomepageNativeGridItems(grid);
    const panel = grid.querySelector(':scope > [data-pbp-home-stats="1"]');
    const fragment = document.createDocumentFragment();
    cards.forEach((card) => fragment.append(card));
    grid.insertBefore(fragment, panel || null);
    grid.dataset.pbpCustomBatch = '1';
    return cards.length;
  }

  async function refreshHomepageBatch({ automatic = false } = {}) {
    if (homepageRefreshReloading || !isHomepageLocation()) return;
    homepageRefreshReloading = true;
    homepageRefreshError = null;
    document.documentElement.setAttribute('data-pbp-home-refreshing', '1');
    applyLayoutPreferences();
    try {
      const items = await Api.requestHomepageBatch();
      const rendered = renderHomepageBatch(items);
      Api.record('homepageRefreshes');
      if (!automatic) showToast(`已换一批：显示 ${rendered} 个视频`);
    } catch (error) {
      homepageRefreshError = error.message;
      Api.record('homepageRefreshFailures');
      if (!document.querySelector('.pbp-home-custom-card')) restoreHomepageNativeCards();
      showToast(`首页换批失败：${error.message}`);
    } finally {
      homepageRefreshReloading = false;
      document.documentElement.removeAttribute('data-pbp-home-refreshing');
      scheduleContentScan(document);
      applyLayoutPreferences();
    }
  }

  function scheduleHomepageAutofill(enabled, visible) {
    if (!enabled || visible >= HOMEPAGE_VIDEO_SLOTS || homepageRefreshReloading || document.querySelector('.pbp-home-custom-card')) {
      clearTimeout(homepageAutofillTimer);
      homepageAutofillTimer = null;
      return;
    }
    if (homepageAutofillTimer !== null) return;
    homepageAutofillTimer = setTimeout(() => {
      homepageAutofillTimer = null;
      if (!isHomepageLocation() || Api.getConfig().browserExtension.homepagePagedMode === false) return;
      const grid = activeHomepageGrid();
      const usable = grid ? [...grid.children].filter((item) => isHomepageVideoItem(item) && isNativelyVisible(item)).length : 0;
      if (usable < HOMEPAGE_VIDEO_SLOTS) refreshHomepageBatch({ automatic: true });
    }, HOMEPAGE_AUTOFILL_DELAY_MS);
  }

  function clearHomepagePageMarkers() {
    for (const item of document.querySelectorAll('[data-pbp-page-overflow],[data-pbp-page-pending]')) {
      item.removeAttribute('data-pbp-page-overflow');
      item.removeAttribute('data-pbp-page-pending');
    }
  }

  function applyHomepagePageLimit() {
    const extension = Api.getConfig().browserExtension;
    const enabled = isHomepageLocation() && extension.enabled !== false && extension.homepagePagedMode !== false;
    if (!enabled && document.querySelector('[data-pbp-native-hidden="1"],.pbp-home-custom-card')) restoreHomepageNativeCards();
    document.documentElement.toggleAttribute('data-pbp-home-paged', enabled);
    if (enabled) document.documentElement.setAttribute('data-pbp-home-paged', '1');
    clearHomepagePageMarkers();
    const grids = homepageGrids();
    const activeGrid = enabled ? activeHomepageGrid(grids) : null;
    const statsPanelMounted = ensureHomepageStatsPanel(enabled, activeGrid);
    const refreshSettling = enabled && homepageRefreshReloading;
    const customBatchActive = Boolean(enabled && activeGrid?.querySelector(':scope > .pbp-home-custom-card'));
    const nativeSlotsSuppressed = customBatchActive ? suppressHomepageNativeGridItems(activeGrid) : 0;
    let visible = 0;
    let overflowHidden = 0;
    let pendingHidden = 0;
    if (enabled && activeGrid) {
      for (const item of activeGrid.children) {
        if (!(item instanceof Element) || item.matches('.recommended-swipe,.load-more-anchor,[data-pbp-home-stats],script,style')) continue;
        if (item.dataset.pbpAdHidden === '1' || item.dataset.pbpBlockedUploader === '1' || item.dataset.pbpEmptyFeedSlot === '1') continue;
        if (isHomepageVideoItem(item) && isNativelyVisible(item)) {
          if (visible < HOMEPAGE_VIDEO_SLOTS) visible += 1;
          else if (!refreshSettling) {
            item.dataset.pbpPageOverflow = '1';
            overflowHidden += 1;
          }
        } else if (!refreshSettling && item.matches('.feed-card,.bili-feed-card') && isNativelyVisible(item)) {
          item.dataset.pbpPagePending = '1';
          pendingHidden += 1;
        }
      }
    }
    const ready = enabled && !refreshSettling && visible >= HOMEPAGE_VIDEO_SLOTS && statsPanelMounted;
    document.documentElement.toggleAttribute('data-pbp-home-paged-ready', ready);
    if (ready) document.documentElement.setAttribute('data-pbp-home-paged-ready', '1');
    const loadAnchors = enabled ? document.querySelectorAll('[data-pbp-home-grid="1"] .load-more-anchor').length : 0;
    const nativeRefreshButtons = enabled
      ? document.querySelectorAll('.feed-roll-btn,button.roll-btn,.flexible-roll-btn,.flexible-roll-btn-inner').length
      : 0;
    const customBatchRendered = activeGrid
      ? activeGrid.querySelectorAll(':scope > .pbp-home-custom-card').length
      : 0;
    scheduleHomepageAutofill(enabled, visible);
    return {
      enabled,
      visible,
      overflowHidden,
      pendingHidden,
      ready,
      loadAnchorsSuppressed: ready ? loadAnchors : 0,
      nativeRefreshButtons,
      statsPanelMounted,
      refreshSettling,
      inactiveGridsIgnored: Math.max(0, grids.length - (activeGrid ? 1 : 0)),
      customBatchActive: customBatchRendered > 0,
      customBatchRendered,
      nativeSlotsSuppressed,
      refreshError: homepageRefreshError,
    };
  }

  function handleHomepageRefreshClick(event) {
    if (!isHomepageLocation() || Api.getConfig().browserExtension.homepagePagedMode === false) return;
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest('.feed-roll-btn');
    if (!button || target.closest('.flexible-roll-btn,.flexible-roll-btn-inner')) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (homepageRefreshReloading) return;
    refreshHomepageBatch().catch((error) => showToast(`首页换批失败：${error.message}`));
  }

  function inspectHomepageGridLayout() {
    const grids = homepageGrids();
    let gridItems = 0;
    let visibleGridItems = 0;
    let firstRowOffsetSpread = 0;
    let maxItemMarginTop = 0;
    for (const grid of grids) {
      const visible = [];
      for (const item of [...grid.children].slice(0, 48)) {
        if (!(item instanceof Element) || item.matches('.recommended-swipe')) continue;
        gridItems += 1;
        const style = getComputedStyle(item);
        maxItemMarginTop = Math.max(maxItemMarginTop, Number.parseFloat(style.marginTop) || 0);
        const rect = item.getBoundingClientRect();
        if (style.display === 'none' || style.visibility === 'hidden' || rect.width <= 0 || rect.height <= 0) continue;
        visibleGridItems += 1;
        visible.push(rect);
      }
      const columns = new Set(visible.map((rect) => Math.round(rect.x))).size;
      if (columns > 1 && visible.length >= columns) {
        const firstRow = visible.slice(0, columns).map((rect) => rect.y);
        firstRowOffsetSpread = Math.max(firstRowOffsetSpread, Math.round(Math.max(...firstRow) - Math.min(...firstRow)));
      }
    }
    return {
      gridCount: grids.length,
      gridItems,
      visibleGridItems,
      firstRowOffsetSpread,
      maxItemMarginTop: Math.round(maxItemMarginTop),
    };
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

  function sidePanelDetails(title, count, open) {
    const details = createElement('details');
    details.open = open;
    const summary = createElement('summary');
    summary.append(createElement('span', '', title), createElement('span', '', String(count)));
    const list = createElement('div', 'side-list');
    details.append(summary, list);
    return { details, list };
  }

  function sidePanelItem(name, meta) {
    const item = createElement('div', 'side-item');
    item.append(createElement('div', 'side-name', name), createElement('div', 'side-meta', meta));
    const actions = createElement('div', 'side-actions');
    item.insertBefore(actions, item.lastElementChild);
    return { item, actions };
  }

  function updateCommentScoringStatus() {
    let autoHidden = 0;
    for (const entry of hiddenComments.values()) {
      if (entry.kind === 'pureMention' && entry.renderer?.isConnected) autoHidden += 1;
    }
    Api.setCommentScoringStatus({
      ...commentScoringCurrent,
      autoHidden,
      pendingAccounts: pendingCommentAccounts.size,
      dismissedAccounts: dismissedCandidateMids.size,
      panelMounted: commentSidePanel?.isConnected === true,
      ...commentScoringStats,
    });
  }

  function renderCommentSidePanel() {
    if (!isVideoPageLocation()) {
      commentSidePanel?.remove();
      commentSidePanel = null;
      updateCommentScoringStatus();
      return;
    }
    const root = ensureUi();
    const blockedOpen = commentSidePanel?.querySelector('[data-pbp-side-blocked]')?.open === true;
    const pendingOpen = commentSidePanel?.querySelector('[data-pbp-side-pending]')?.open === true;
    if (!commentSidePanel?.isConnected) {
      commentSidePanel = createElement('aside', 'comment-side');
      commentSidePanel.setAttribute('aria-label', '评论净化名单');
      root.append(commentSidePanel);
    }
    commentSidePanel.replaceChildren();
    const mutedUsers = Api.getConfig().mutedUsers || [];
    const mutedMids = new Set(mutedUsers.map((user) => Number(user.mid)));
    const autoHiddenGroups = new Map();
    for (const entry of hiddenComments.values()) {
      if (entry.kind !== 'pureMention' || !entry.renderer?.isConnected || mutedMids.has(entry.mid)) continue;
      let group = autoHiddenGroups.get(entry.mid);
      if (!group) {
        group = { mid: entry.mid, name: entry.name, entries: [] };
        autoHiddenGroups.set(entry.mid, group);
      }
      group.entries.push(entry);
    }
    const blocked = sidePanelDetails('已屏蔽', mutedUsers.length + autoHiddenGroups.size, blockedOpen);
    blocked.details.dataset.pbpSideBlocked = '1';
    if (!mutedUsers.length && !autoHiddenGroups.size) blocked.list.append(createElement('div', 'side-empty', '暂无已隐藏评论或屏蔽账号'));
    for (const user of mutedUsers.slice(0, 100)) {
      const mid = Number(user.mid);
      const row = sidePanelItem(user.name || `UID ${mid}`, `账号屏蔽 · UID ${mid}`);
      const restore = createElement('button', '', '恢复');
      restore.type = 'button';
      restore.addEventListener('click', async (event) => {
        event.stopPropagation();
        revealCommentsForMid(mid);
        await Api.removeMutedUser(mid);
        applyMutedComments();
        showToast('已恢复该账号在本页的评论，并移出屏蔽名单');
      });
      row.actions.append(restore);
      blocked.list.append(row.item);
    }
    if (mutedUsers.length > 100) blocked.list.append(createElement('div', 'side-more', `另有 ${mutedUsers.length - 100} 个账号，请在扩展设置中管理`));
    for (const group of [...autoHiddenGroups.values()].slice(0, Math.max(0, 100 - mutedUsers.length))) {
      const row = sidePanelItem(group.name || `UID ${group.mid}`, `自动隐藏 ${group.entries.length} 条纯 @ 评论 · UID ${group.mid}`);
      const restore = createElement('button', '', '恢复');
      restore.type = 'button';
      restore.addEventListener('click', (event) => {
        event.stopPropagation();
        for (const entry of group.entries) {
          revealedRpids.add(entry.rpid);
          restoreHiddenComment(entry.rpid);
        }
        updateCommentFoldStatus();
        renderCommentSidePanel();
        showToast(`已恢复 ${group.entries.length} 条评论`);
      });
      row.actions.append(restore);
      blocked.list.append(row.item);
    }

    const pendingEntries = [...pendingCommentAccounts.values()];
    const pending = sidePanelDetails('待屏蔽', pendingEntries.length, pendingOpen);
    pending.details.dataset.pbpSidePending = '1';
    if (!pendingEntries.length) pending.list.append(createElement('div', 'side-empty', '暂无短评论、纯表情或多重纯 @ 候选'));
    for (const candidate of pendingEntries.slice(0, 100)) {
      const reasons = [...candidate.reasons].join('、');
      const row = sidePanelItem(candidate.name || `UID ${candidate.mid}`, `${candidate.comments.size} 条候选 · ${reasons} · UID ${candidate.mid}`);
      const ignore = createElement('button', '', '忽略');
      ignore.type = 'button';
      ignore.addEventListener('click', (event) => {
        event.stopPropagation();
        dismissedCandidateMids.add(String(candidate.mid));
        pendingCommentAccounts.delete(String(candidate.mid));
        renderCommentSidePanel();
        updateCommentScoringStatus();
      });
      const block = createElement('button', 'primary', '屏蔽');
      block.type = 'button';
      block.addEventListener('click', async (event) => {
        event.stopPropagation();
        clearRevealedCommentsForMid(candidate.mid);
        const added = await Api.addMutedUser(candidate.mid, candidate.name);
        if (!added) return showToast('该账号已在评论屏蔽列表中');
        pendingCommentAccounts.delete(String(candidate.mid));
        applyMutedComments();
        showToast('已确认屏蔽该账号', async () => {
          await Api.removeMutedUser(candidate.mid);
          applyMutedComments();
        });
      });
      row.actions.append(ignore, block);
      pending.list.append(row.item);
    }
    if (pendingEntries.length > 100) pending.list.append(createElement('div', 'side-more', `另有 ${pendingEntries.length - 100} 个当前页面候选`));
    commentSidePanel.append(blocked.details, pending.details);
    updateCommentScoringStatus();
  }

  function restoreCommentContainer(container) {
    if (container.dataset?.pbpMutedComment !== '1') return;
    const previous = container.dataset.pbpPreviousDisplay || '';
    if (previous) container.style.setProperty('display', previous);
    else container.style.removeProperty('display');
    delete container.dataset.pbpMutedComment;
    delete container.dataset.pbpPreviousDisplay;
  }

  function updateCommentFoldStatus() {
    let activeHidden = 0;
    for (const entry of hiddenComments.values()) if (entry.renderer?.isConnected) activeHidden += 1;
    Api.setCommentFoldStatus({
      activeHidden,
      revealedRpids: revealedRpids.size,
      ...commentHideStats,
    });
  }

  function commentRenderer(record) {
    if (record.renderer instanceof Element) return record.renderer;
    return record.container;
  }

  function restoreHiddenComment(rpid) {
    const key = String(rpid || '');
    const entry = hiddenComments.get(key);
    if (!entry) return false;
    hiddenComments.delete(key);
    if (entry.renderer instanceof Element) restoreCommentContainer(entry.renderer);
    commentHideStats.restored += 1;
    return true;
  }

  function clearCommentFoldState(routeReset = false) {
    for (const rpid of [...hiddenComments.keys()]) restoreHiddenComment(rpid);
    cleanupHiddenComments();
    revealedRpids.clear();
    pendingCommentAccounts.clear();
    dismissedCandidateMids.clear();
    commentScoringCurrent = { scored: 0, pureMention: 0, shortComments: 0, emoteOnly: 0, pendingComments: 0 };
    commentSidePanel?.remove();
    commentSidePanel = null;
    if (routeReset) {
      commentHideStats.routeResets += 1;
      commentScoringStats.routeResets += 1;
    }
    updateCommentFoldStatus();
    updateCommentScoringStatus();
  }

  function cleanupHiddenComments() {
    for (const [rpid, entry] of [...hiddenComments]) {
      if (entry.renderer?.isConnected) continue;
      hiddenComments.delete(rpid);
    }
  }

  function hideCommentRenderer(record, renderer, kind) {
    const rpid = String(record.rpid || '');
    if (!(renderer instanceof Element)) return false;
    const previous = /^\d+$/u.test(rpid) ? hiddenComments.get(rpid) : null;
    if (previous?.renderer !== renderer && previous?.renderer?.isConnected) restoreCommentContainer(previous.renderer);
    if (renderer.dataset.pbpMutedComment !== '1') {
      renderer.dataset.pbpPreviousDisplay = renderer.style.getPropertyValue('display');
      renderer.dataset.pbpMutedComment = '1';
    }
    renderer.style.setProperty('display', 'none', 'important');
    if (/^\d+$/u.test(rpid)) {
      hiddenComments.set(rpid, {
        rpid,
        renderer,
        kind,
        mid: Number(record.mid),
        name: String(record.name || ''),
      });
      if (!previous) commentHideStats.hidden += 1;
    }
    return true;
  }

  function applyMutedComments() {
    const muted = new Set(Api.getConfig().mutedUsers.map((user) => Number(user.mid)));
    cleanupHiddenComments();
    pendingCommentAccounts.clear();
    const structuredRpids = new Set();
    let pureMention = 0;
    let shortComments = 0;
    let emoteOnly = 0;
    let pendingComments = 0;
    const mountedComments = Api.getMountedCommentRecords();
    for (const comment of mountedComments) {
      const rpid = String(comment.rpid || '');
      const mid = Number(comment.mid);
      const renderer = comment.element;
      if (!/^\d+$/u.test(rpid) || !Number.isSafeInteger(mid) || !renderer?.isConnected) continue;
      structuredRpids.add(rpid);
      const analysis = CommentScoring.analyzeComment(comment);
      if (analysis.isPureMention) pureMention += 1;
      if (analysis.isShort) shortComments += 1;
      if (analysis.isEmoteOnly) emoteOnly += 1;
      const isMuted = muted.has(mid);
      if (analysis.pendingReview && !isMuted && !dismissedCandidateMids.has(String(mid))) {
        pendingComments += 1;
        let candidate = pendingCommentAccounts.get(String(mid));
        if (!candidate) {
          candidate = { mid, name: comment.uname || '', comments: new Map(), reasons: new Set() };
          pendingCommentAccounts.set(String(mid), candidate);
        } else if (comment.uname) {
          candidate.name = comment.uname;
        }
        for (const reason of analysis.pendingReasons) candidate.reasons.add(reason);
        candidate.comments.set(rpid, {
          rpid,
          mentionCount: analysis.mentionCount,
          text: comment.text,
          reasons: analysis.pendingReasons,
        });
      }
      const shouldHide = isMuted || analysis.isPureMention;
      if (shouldHide && !revealedRpids.has(rpid)) {
        const kind = isMuted ? 'muted' : 'pureMention';
        hideCommentRenderer({ rpid, mid, name: comment.uname }, renderer, kind);
      } else {
        restoreHiddenComment(rpid);
        restoreCommentContainer(renderer);
      }
    }
    for (const record of [...commentRecords]) {
      const renderer = commentRenderer(record);
      if (!record.button.isConnected || !record.container.isConnected || !renderer?.isConnected) {
        commentRecords.delete(record);
        continue;
      }
      if (record.rpid && structuredRpids.has(String(record.rpid))) continue;
      if (muted.has(record.mid)) {
        if (record.rpid && !revealedRpids.has(record.rpid)) {
          hideCommentRenderer(record, renderer, 'muted');
        } else if (!record.rpid) {
          hideCommentRenderer(record, renderer, 'muted');
        } else {
          restoreHiddenComment(record.rpid);
          restoreCommentContainer(renderer);
        }
      } else {
        if (record.rpid) restoreHiddenComment(record.rpid);
        restoreCommentContainer(renderer);
      }
    }
    commentScoringCurrent = {
      scored: mountedComments.length,
      pureMention,
      shortComments,
      emoteOnly,
      pendingComments,
    };
    updateCommentFoldStatus();
    renderCommentSidePanel();
  }

  function clearRevealedCommentsForMid(mid) {
    for (const rpid of Api.getMountedCommentRpidsByMid(mid)) revealedRpids.delete(rpid);
  }

  function revealCommentsForMid(mid) {
    for (const rpid of Api.getMountedCommentRpidsByMid(mid)) {
      revealedRpids.add(rpid);
      restoreHiddenComment(rpid);
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
        revealCommentsForMid(record.mid);
        await Api.removeMutedUser(record.mid);
        applyMutedComments();
        showToast('已取消评论屏蔽', async () => {
          clearRevealedCommentsForMid(record.mid);
          await Api.addMutedUser(record.mid, record.name);
          applyMutedComments();
        });
      } else {
        clearRevealedCommentsForMid(record.mid);
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

  function commentCatalogHost(start) {
    return closestAcrossRoots(start, '[data-pbp-comment-rpid]');
  }

  function registerCommentCatalogElements(root) {
    const elements = [];
    try {
      if (root instanceof Element && root.matches('[data-pbp-comment-rpid]')) elements.push(root);
      if (root instanceof ShadowRoot && root.host.matches('[data-pbp-comment-rpid]')) elements.push(root.host);
      elements.push(...root.querySelectorAll('[data-pbp-comment-rpid]'));
    } catch (_) {
      return;
    }
    for (const element of elements) {
      Api.registerCommentElement(element.getAttribute('data-pbp-comment-rpid'), element);
    }
  }

  function rootContainsCommentHost(root) {
    try {
      if (root instanceof Element && root.matches(COMMENT_HOST_SELECTOR)) return true;
      if (root instanceof ShadowRoot && root.host.matches(COMMENT_HOST_SELECTOR)) return true;
      return Boolean(root.querySelector(COMMENT_HOST_SELECTOR));
    } catch (_) {
      return false;
    }
  }

  function scanCommentRoot(root) {
    registerCommentCatalogElements(root);
    if (rootContainsCommentHost(root)) Api.requestCommentCatalog('dom-scan');
    let anchors;
    try {
      anchors = root instanceof Element && root.matches('a[href*="space.bilibili.com/"]') ? [root] : [];
      anchors.push(...root.querySelectorAll('a[href*="space.bilibili.com/"]'));
    } catch (_) {
      return;
    }
    const grouped = new Map();
    for (const anchor of anchors) {
      const catalogElement = commentCatalogHost(anchor);
      const rpid = catalogElement?.getAttribute('data-pbp-comment-rpid') || null;
      const catalog = rpid ? Api.getCommentCatalogRecord(rpid) : null;
      const catalogMid = Number(catalog?.mid);
      const mid = Number.isSafeInteger(catalogMid) && catalogMid > 0 ? catalogMid : parseSpaceMid(anchor);
      if (!mid) continue;
      const container = closestAcrossRoots(anchor, COMMENT_CONTAINER_SELECTOR);
      const region = closestAcrossRoots(anchor, COMMENT_REGION_SELECTOR);
      if (!container || !region) continue;
      const candidate = {
        anchor,
        mid,
        rpid,
        name: catalog?.uname || '',
        renderer: catalogElement || container,
        score: nameScore(anchor) + (catalog ? 100 : 0),
      };
      const previous = grouped.get(container);
      if (!previous || candidate.score > previous.score) grouped.set(container, candidate);
    }
    for (const [container, candidate] of grouped) {
      const existing = commentByContainer.get(container);
      if (existing?.button.isConnected) {
        existing.mid = candidate.mid;
        existing.rpid = candidate.rpid;
        existing.renderer = candidate.renderer;
        if (candidate.name) existing.name = candidate.name;
        existing.button.dataset.mid = String(candidate.mid);
        if (candidate.rpid) existing.button.dataset.rpid = candidate.rpid;
        continue;
      }
      if (existing) commentRecords.delete(existing);
      const name = candidate.name || (candidate.anchor.textContent || candidate.anchor.getAttribute('title') || '').trim();
      const button = createElement('button', '', '净化');
      button.type = 'button';
      button.title = '屏蔽其评论或加入标记库';
      button.dataset.pbpCommentAction = '1';
      button.dataset.mid = String(candidate.mid);
      if (candidate.rpid) button.dataset.rpid = candidate.rpid;
      styleCommentButton(button);
      const record = { button, container, renderer: candidate.renderer, mid: candidate.mid, name, rpid: candidate.rpid };
      button.addEventListener('click', (event) => {
        handleCommentAction(record, event).catch((error) => showToast(`评论净化操作失败：${error.message}`));
      });
      candidate.anchor.insertAdjacentElement('afterend', button);
      commentByContainer.set(container, record);
      commentRecords.add(record);
      Api.record('commentButtons');
      if (container.matches('bili-comment-reply-renderer,.sub-reply-item,[data-parent-id],[data-parent-rpid]')) {
        Api.record('commentReplyButtons');
      }
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
    // Injecting controls into Bilibili's video recommendation Vue tree causes
    // its SPA header to rehydrate without the navigation bar. Keep uploader
    // actions on homepage/search/dynamic pages; related-video data filtering
    // remains active in MAIN world.
    if (isVideoPageLocation()) return;
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
    if (hosts.length && currentRoute() === activeRoute && Date.now() >= routeHoldUntil) {
      Api.requestCommentCatalog('comment-host-discovered');
    }
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

  function currentRoute() {
    return `${location.origin}${location.pathname}${location.search}`;
  }

  function currentCommentRoute() {
    return `${location.origin}${location.pathname}`;
  }

  function detectRouteChange() {
    const route = currentRoute();
    if (route === activeRoute) return false;
    activeRoute = route;
    routeHoldUntil = Date.now() + ROUTE_SETTLE_MS;
    videoInteractionHoldUntil = isVideoPageLocation() ? Date.now() + ROUTE_SETTLE_MS : 0;
    pendingRoots.clear();
    pendingRoots.add(document);
    clearCommentFoldState(true);
    Api.resetCommentCatalogForRoute(currentCommentRoute());
    Api.record('routeScanDeferrals');
    return true;
  }

  function flushContentScan() {
    scanScheduled = false;
    scanTimer = null;
    if (detectRouteChange()) {
      scheduleContentScan(document);
      return;
    }
    const remaining = Math.max(routeHoldUntil, videoInteractionHoldUntil) - Date.now();
    if (remaining > 0) {
      if (isVideoPageLocation() && videoInteractionHoldUntil > Date.now()) Api.record('videoPageInteractionDeferrals');
      scanScheduled = true;
      scanTimer = setTimeout(flushContentScan, remaining);
      return;
    }
    const roots = [...pendingRoots];
    pendingRoots.clear();
    for (const root of roots) {
      scanCommentRoot(root);
      scanUploaderRoot(root);
      scanAdRoot(root);
    }
    applyLayoutPreferences();
  }

  function scheduleContentScan(root = document) {
    pendingRoots.add(root);
    const routeChanged = detectRouteChange();
    const delay = routeChanged
      ? ROUTE_SETTLE_MS
      : Math.max(INCREMENTAL_SCAN_DELAY_MS, routeHoldUntil - Date.now());
    if (scanScheduled) {
      if (!routeChanged) return;
      clearTimeout(scanTimer);
    }
    scanScheduled = true;
    scanTimer = setTimeout(flushContentScan, delay);
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
    updateCommentFoldStatus();
    if (isVideoPageLocation()) videoInteractionHoldUntil = Date.now() + ROUTE_SETTLE_MS;
    applyLayoutPreferences();
    document.addEventListener('click', (event) => {
      handleDanmakuClick(event).catch((error) => showToast(`弹幕净化操作失败：${error.message}`));
    }, true);
    observeRoot(document);
    Api.requestCommentCatalog('interaction-start', true);
    setInterval(() => {
      discoverShadowRoots(document);
      discoverListContainers(document);
    }, 10_000);
    setInterval(() => {
      if (document.visibilityState === 'hidden' || Date.now() < routeHoldUntil) return;
      const commentRegion = document.querySelector('bili-comments,#commentapp,#comment,.comment-container,.bili-comments');
      if (!commentRegion) return;
      const rect = commentRegion.getBoundingClientRect?.();
      if (rect && rect.bottom < 0) return;
      if (rect && rect.top > (window.innerHeight || 800) * 2) return;
      Api.requestCommentCatalog('visible-fallback', true);
    }, 5_000);
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
    window.addEventListener('pbp-comment-catalog-updated', () => {
      for (const root of observedRoots) scheduleContentScan(root);
    });
  }

  // Register at document_start so the compatibility refresh runs before the
  // site's component handler can start its fixed 10-slot replacement cycle.
  window.addEventListener('click', handleHomepageRefreshClick, true);
  startInteractions();
})();
