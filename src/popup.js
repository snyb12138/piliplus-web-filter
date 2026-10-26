(() => {
  'use strict';

  const Core = globalThis.PiliPlusPurifyCore;
  const Ui = globalThis.PiliPlusPurifyUi;
  const ids = [
    'enabled', 'statusDot', 'statusText', 'resetStats', 'segments', 'total', 'blocked',
    'ruleSummary', 'importFile', 'exportFile', 'openOptions', 'message', 'hits',
    'diagnosticCount', 'diagnoseConnection', 'reconnectPage', 'diagnosisCard',
    'diagnosisSummary', 'diagnosisList', 'copyDiagnosis', 'interactionSummary', 'layoutSummary',
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
  const TARGET_URL = /^https?:\/\/(?:[^/.]+\.)*bilibili\.com(?::\d+)?\//iu;
  const HOST_PATTERN = '*://*.bilibili.com/*';
  let config;
  let activeTabId = null;
  let activeTabUrl = '';
  let latestDiagnosis = null;

  function renderSummary() {
    const runtime = Core.buildRuntimeRules(config);
    const totalTextRules = runtime.absoluteRules.length + runtime.gentleRules.length + runtime.keywords.length + runtime.regex.length;
    elements.ruleSummary.textContent = `评论账号 ${runtime.mutedUidHashes.length} · UP 主 ${runtime.blockedUploaders.length} · 自定义广告词 ${runtime.adFilter?.keywords?.length || 0} · 历史哈希 ${runtime.legacyUidHashes.length} · 文本规则 ${totalTextRules} · 停用正则 ${runtime.disabledRegex.length}`;
  }

  function renderStatus(status) {
    if (!status) {
      elements.statusText.textContent = TARGET_URL.test(activeTabUrl) ? '当前页面未连接（可运行诊断）' : '当前页面不是 B 站页面';
      elements.statusDot.className = 'status-dot warn';
      return;
    }
    if (!status.enabled) {
      elements.statusText.textContent = '过滤已暂停';
      elements.statusDot.className = 'status-dot';
    } else if (!status.connected) {
      const failure = status.connection?.failure;
      elements.statusText.textContent = failure === 'bridge-timeout' ? '隔离脚本已加载，数据桥接超时' : '仅 DOM 兜底可用';
      elements.statusDot.className = 'status-dot warn';
    } else {
      elements.statusText.textContent = status.rulesReady ? '数据层过滤已就绪' : '页面已连接，规则加载中';
      elements.statusDot.className = `status-dot ${status.rulesReady ? 'ok' : 'warn'}`;
    }
    elements.segments.textContent = status.segments || 0;
    elements.total.textContent = status.totalDanmaku || 0;
    elements.blocked.textContent = status.blocked || 0;
    elements.diagnosticCount.textContent = status.diagnostics?.length ? `诊断 ${status.diagnostics.length}` : '';
    const interaction = status.interaction || {};
    elements.interactionSummary.textContent = `净化助手：广告 ${Number(interaction.adsDomHidden || 0) + Number(interaction.adsApiDropped || 0)} · 弹幕操作 ${interaction.danmakuMenus || 0} · 评论按钮 ${interaction.commentButtons || 0} · UP按钮 ${interaction.uploaderButtons || 0} · 隐藏投稿 ${Number(interaction.uploaderCardsHidden || 0) + Number(interaction.uploaderApiDropped || 0)} · 新增屏蔽 ${Number(interaction.danmakuTextRulesAdded || 0) + Number(interaction.danmakuSendersAdded || 0) + Number(interaction.commentUsersBlocked || 0) + Number(interaction.uploaderUsersBlocked || 0)}`;
    const layout = status.layout || {};
    const compacted = Number(layout.emptySlotsHidden) || 0;
    const compactedText = compacted ? ` · 已回收 ${compacted} 个空槽` : '';
    const pageText = layout.pagedMode
      ? ` · 固定页 ${layout.pageVisible || 0}/${layout.pageSize || 24}${layout.pageReady ? ' 已就绪' : ' 补充中'}`
      : '';
    elements.layoutSummary.textContent = !layout.preferenceEnabled
      ? '首页推广轮播：保留显示'
      : (!layout.onHomepage
        ? '首页推广轮播：隐藏规则已开启（当前非首页）'
        : (layout.carouselFound ? `首页推广轮播：已隐藏 ${layout.hiddenElements || 1} 个组件${compactedText}${pageText}` : `首页推广轮播：规则已开启，当前页未发现组件${compactedText}${pageText}`));
    elements.hits.replaceChildren();
    const hits = status.hits || [];
    if (!hits.length) {
      const item = document.createElement('li');
      item.className = 'muted';
      item.textContent = '暂无命中';
      elements.hits.append(item);
      return;
    }
    for (const hit of hits.slice(0, 12)) {
      const item = document.createElement('li');
      const text = document.createElement('div');
      text.className = 'hit-text';
      text.textContent = hit.content;
      const meta = document.createElement('div');
      meta.className = 'hit-meta';
      const progress = Number.isFinite(hit.progress) ? `${Math.floor(hit.progress / 60000)}:${String(Math.floor(hit.progress / 1000) % 60).padStart(2, '0')} · ` : '';
      meta.textContent = `${progress}${hit.reason} · ${hit.source === 'dom' ? 'DOM兜底' : '数据层'}`;
      item.append(text, meta);
      elements.hits.append(item);
    }
  }

  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    activeTabId = tab?.id ?? null;
    activeTabUrl = tab?.url || '';
    return tab || null;
  }

  async function queryPageStatus() {
    await getActiveTab();
    if (!activeTabId || !TARGET_URL.test(activeTabUrl)) {
      renderStatus(null);
      return null;
    }
    try {
      const status = await chrome.tabs.sendMessage(activeTabId, { kind: 'get-status' });
      renderStatus(status);
      return status;
    } catch (_) {
      renderStatus(null);
      return null;
    }
  }

  async function probeWorld(world) {
    if (!activeTabId) return { error: '没有活动标签页' };
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: activeTabId },
        world,
        func: () => ({
          href: `${location.origin}${location.pathname}`,
          readyState: document.readyState,
          content: globalThis.__PBP_CONTENT_DIAGNOSTIC_V1__ ? { ...globalThis.__PBP_CONTENT_DIAGNOSTIC_V1__ } : null,
          main: globalThis.__PBP_MAIN_DIAGNOSTIC_V1__ ? { ...globalThis.__PBP_MAIN_DIAGNOSTIC_V1__ } : null,
        }),
      });
      return results?.[0]?.result || { error: '探针没有返回结果' };
    } catch (error) {
      return { error: error.message };
    }
  }

  function check(key, label, state, detail) {
    return { key, label, state, detail };
  }

  function cleanPageUrl(raw) {
    try {
      const url = new URL(raw);
      return `${url.origin}${url.pathname}`;
    } catch (_) {
      return raw || '';
    }
  }

  async function runConnectionDiagnostic() {
    elements.diagnosisCard.classList.remove('hidden');
    elements.diagnosisSummary.textContent = '正在检查…';
    elements.diagnosisList.replaceChildren();
    elements.copyDiagnosis.disabled = true;
    const tab = await getActiveTab();
    const target = Boolean(tab?.id && TARGET_URL.test(tab.url || ''));
    let hostAccess = false;
    let permissionError = null;
    try {
      hostAccess = await chrome.permissions.contains({ origins: [HOST_PATTERN] });
    } catch (error) {
      permissionError = error.message;
    }

    let contentStatus = null;
    let messageError = null;
    if (tab?.id && target) {
      try {
        contentStatus = await chrome.tabs.sendMessage(tab.id, { kind: 'get-status' });
      } catch (error) {
        messageError = error.message;
      }
    }
    const [isolatedProbe, mainProbe] = target
      ? await Promise.all([probeWorld('ISOLATED'), probeWorld('MAIN')])
      : [{ error: '非目标页面' }, { error: '非目标页面' }];
    const contentMarker = isolatedProbe.content || null;
    const mainMarker = mainProbe.main || null;
    const checks = [
      check('tab', '活动标签页', tab?.id ? 'pass' : 'fail', tab?.id ? cleanPageUrl(tab.url) : '未找到活动标签页'),
      check('url', 'URL 匹配', target ? 'pass' : 'fail', target ? '属于 bilibili.com' : '仅支持 HTTP(S) 的 bilibili.com 页面'),
      check('permission', '站点权限', hostAccess ? 'pass' : 'fail', permissionError || (hostAccess ? HOST_PATTERN : 'Chrome 未授予声明的 B 站主机权限')),
      check('content', '隔离脚本', contentMarker?.active ? 'pass' : 'fail', contentMarker ? (contentMarker.failure || `已加载于 ${contentMarker.loadedAt}`) : (isolatedProbe.error || '未发现运行标记')),
      check('message', '扩展通信', contentStatus ? 'pass' : 'fail', contentStatus ? 'content script 已响应弹窗' : (messageError || '没有响应')),
      check('main', 'MAIN 脚本', mainMarker?.active ? 'pass' : 'fail', mainMarker ? (mainMarker.failure || `已加载于 ${mainMarker.loadedAt}`) : (mainProbe.error || '未发现运行标记')),
      check('bridge', '令牌桥接', contentStatus?.connected ? 'pass' : 'fail', contentStatus?.connected ? `连接于 ${contentStatus.connection?.bridgeConnectedAt || '未知时间'}` : (contentStatus?.connection?.failure || '隔离脚本与 MAIN world 尚未建立连接')),
      check('rules', '规则下发', contentStatus?.rulesReady ? 'pass' : 'fail', contentStatus?.rulesReady ? `就绪于 ${contentStatus.connection?.rulesReadyAt || '未知时间'}` : 'MAIN world 尚未确认规则'),
      check('hooks', '请求钩子', mainMarker?.fetchHookInstalled && mainMarker?.xhrHookInstalled ? 'pass' : (mainMarker?.fetchHookInstalled ? 'warn' : 'fail'), mainMarker ? `Fetch=${Boolean(mainMarker.fetchHookInstalled)}，XHR=${Boolean(mainMarker.xhrHookInstalled)}` : '无法检查'),
    ];
    latestDiagnosis = {
      schema: 'piliplus-purify-browser-connection-diagnostic',
      version: 1,
      generatedAt: new Date().toISOString(),
      extensionVersion: chrome.runtime.getManifest().version,
      userAgent: navigator.userAgent,
      tab: { id: tab?.id ?? null, url: cleanPageUrl(tab?.url || '') },
      checks,
      contentStatus,
      isolatedProbe,
      mainProbe,
    };
    renderDiagnosis(checks);
    elements.copyDiagnosis.disabled = false;
    return latestDiagnosis;
  }

  function renderDiagnosis(checks) {
    elements.diagnosisList.replaceChildren();
    for (const item of checks) {
      const row = document.createElement('li');
      const icon = document.createElement('span');
      icon.className = `diagnosis-icon ${item.state}`;
      icon.textContent = item.state === 'pass' ? '✓' : (item.state === 'warn' ? '!' : '×');
      const label = document.createElement('strong');
      label.textContent = item.label;
      const detail = document.createElement('span');
      detail.className = 'diagnosis-detail';
      detail.textContent = item.detail;
      row.append(icon, label, detail);
      elements.diagnosisList.append(row);
    }
    const failed = checks.filter((item) => item.state === 'fail');
    elements.diagnosisSummary.textContent = failed.length ? `发现 ${failed.length} 个失败阶段；复制诊断后可直接发给开发者。` : '连接链路检查通过。';
  }

  async function reconnectPage() {
    elements.reconnectPage.disabled = true;
    Ui.setMessage(elements.message, '正在重新注入并建立连接…');
    try {
      const tab = await getActiveTab();
      if (!tab?.id || !TARGET_URL.test(tab.url || '')) throw new Error('当前标签页不是 B 站页面');
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        files: ['src/core.js', 'src/page-core.js', 'src/page-main.js'],
      });
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'ISOLATED',
        files: ['src/content-core.js', 'src/content.js', 'src/interactions.js'],
      });
      try {
        await chrome.tabs.sendMessage(tab.id, { kind: 'reconnect-bridge' });
      } catch (_) {
        // The following diagnostic will report the exact failed stage.
      }
      await new Promise((resolve) => setTimeout(resolve, 700));
      const status = await queryPageStatus();
      await runConnectionDiagnostic();
      Ui.setMessage(elements.message, status?.rulesReady ? '重新连接成功' : '重新连接未完全成功，请复制诊断结果', status?.rulesReady ? 'ok' : 'error');
    } catch (error) {
      Ui.setMessage(elements.message, `重新连接失败：${error.message}`, 'error');
      await runConnectionDiagnostic().catch(() => {});
    } finally {
      elements.reconnectPage.disabled = false;
    }
  }

  async function init() {
    const result = await Ui.readConfig();
    config = result.config;
    elements.enabled.checked = config.browserExtension.enabled;
    renderSummary();
    await queryPageStatus();
  }

  elements.enabled.addEventListener('change', async () => {
    config.browserExtension.enabled = elements.enabled.checked;
    config = (await Ui.writeConfig(config)).config;
    Ui.setMessage(elements.message, elements.enabled.checked ? '过滤已启用' : '过滤已暂停', 'ok');
    renderSummary();
  });

  elements.importFile.addEventListener('change', async () => {
    const file = elements.importFile.files?.[0];
    if (!file) return;
    try {
      const result = await Ui.importFile(file);
      config = result.config;
      elements.enabled.checked = config.browserExtension.enabled;
      renderSummary();
      Ui.setMessage(elements.message, `导入成功${result.diagnostics.length ? `，有 ${result.diagnostics.length} 条诊断` : ''}`, 'ok');
    } catch (error) {
      Ui.setMessage(elements.message, error.message, 'error');
    } finally {
      elements.importFile.value = '';
    }
  });

  elements.exportFile.addEventListener('click', () => Ui.downloadConfig(config));
  elements.openOptions.addEventListener('click', () => chrome.runtime.openOptionsPage());
  elements.diagnoseConnection.addEventListener('click', () => runConnectionDiagnostic().catch((error) => Ui.setMessage(elements.message, `诊断失败：${error.message}`, 'error')));
  elements.reconnectPage.addEventListener('click', reconnectPage);
  elements.copyDiagnosis.addEventListener('click', async () => {
    if (!latestDiagnosis) return;
    try {
      await navigator.clipboard.writeText(`${JSON.stringify(latestDiagnosis, null, 2)}\n`);
      Ui.setMessage(elements.message, '诊断信息已复制', 'ok');
    } catch (error) {
      Ui.setMessage(elements.message, `复制失败：${error.message}`, 'error');
    }
  });
  elements.resetStats.addEventListener('click', async () => {
    if (!activeTabId) return;
    try {
      await chrome.tabs.sendMessage(activeTabId, { kind: 'reset-stats' });
      await queryPageStatus();
    } catch (_) {
      Ui.setMessage(elements.message, '当前页面无法接收请求', 'error');
    }
  });

  init().catch((error) => Ui.setMessage(elements.message, error.message, 'error'));
})();
