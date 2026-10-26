(() => {
  'use strict';
  const Core = globalThis.PiliPlusPurifyCore;
  const Ui = globalThis.PiliPlusPurifyUi;
  const ids = ['enabled', 'hideHomepageCarousel', 'homepagePagedMode', 'videoPageDomEnhancements', 'adFilterEnabled', 'adHomepage', 'adDynamic', 'adVideo', 'adRemoteKeywords', 'adCustomKeywords', 'syncAdRules', 'adRuleStatus', 'mutedUsers', 'uploaderUsers', 'uidHashes', 'absoluteRules', 'gentleRules', 'keywords', 'regex', 'blockDateStamps', 'blockTimeStamps', 'blockPeopleCounts', 'blockShortCheckIns', 'importFile', 'exportFile', 'exportBlackMids', 'diagnostics', 'message', 'save'];
  const elements = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
  let config;

  const lines = (value) => value.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean);

  function usersToText(users) {
    return users.map((user) => `${user.mid}${user.name ? `\t${user.name}` : ''}`).join('\n');
  }

  function parseUsers(text, existing) {
    const old = new Map(existing.map((user) => [user.mid, user]));
    return lines(text).map((line, index) => {
      const match = /^(\d+)(?:\s+(.+))?$/u.exec(line);
      if (!match) throw new Core.FormatError(`账号名单第 ${index + 1} 行格式错误`);
      const mid = Core.parseMid(match[1]);
      if (mid === null) throw new Core.FormatError(`账号名单第 ${index + 1} 行 UID 无效`);
      const previous = old.get(mid) || {};
      const { mid: _oldMid, name: _oldName, ...extras } = previous;
      const name = (match[2] || '').trim();
      return { ...extras, mid, ...(name ? { name } : {}) };
    });
  }

  function renderDiagnostics(entries) {
    elements.diagnostics.replaceChildren();
    if (!entries.length) {
      const item = document.createElement('li');
      item.className = 'muted';
      item.textContent = '暂无诊断';
      elements.diagnostics.append(item);
      return;
    }
    for (const entry of entries) {
      const item = document.createElement('li');
      item.textContent = entry.message;
      elements.diagnostics.append(item);
    }
  }

  function render() {
    elements.enabled.checked = config.browserExtension.enabled;
    elements.hideHomepageCarousel.checked = config.browserExtension.hideHomepageCarousel;
    elements.homepagePagedMode.checked = config.browserExtension.homepagePagedMode;
    elements.videoPageDomEnhancements.checked = config.browserExtension.videoPageDomEnhancements;
    const adFilter = config.browserExtension.adFilter;
    elements.adFilterEnabled.checked = adFilter.enabled;
    elements.adHomepage.checked = adFilter.homepage;
    elements.adDynamic.checked = adFilter.dynamic;
    elements.adVideo.checked = adFilter.video;
    elements.adRemoteKeywords.checked = adFilter.remoteKeywordsEnabled;
    elements.adCustomKeywords.value = adFilter.customKeywords.join('\n');
    elements.mutedUsers.value = usersToText(config.mutedUsers);
    elements.uploaderUsers.value = usersToText(config.uploaderRules.users);
    elements.uidHashes.value = config.danmakuRules.uidHashes.join('\n');
    elements.absoluteRules.value = config.danmakuAssistant.absoluteRules.join('\n');
    elements.gentleRules.value = config.danmakuAssistant.gentleRules.join('\n');
    elements.keywords.value = config.danmakuRules.keywords.join('\n');
    elements.regex.value = config.danmakuRules.regex.join('\n');
    elements.blockDateStamps.checked = config.danmakuAssistant.blockDateStamps;
    elements.blockTimeStamps.checked = config.danmakuAssistant.blockTimeStamps;
    elements.blockPeopleCounts.checked = config.danmakuAssistant.blockPeopleCounts;
    elements.blockShortCheckIns.checked = config.danmakuAssistant.blockShortCheckIns;
    renderDiagnostics(Core.buildRuntimeRules(config).diagnostics);
  }

  function collect() {
    return {
      ...config,
      mutedUsers: parseUsers(elements.mutedUsers.value, config.mutedUsers),
      uploaderRules: {
        ...config.uploaderRules,
        users: parseUsers(elements.uploaderUsers.value, config.uploaderRules.users),
      },
      danmakuAssistant: {
        ...config.danmakuAssistant,
        absoluteRules: lines(elements.absoluteRules.value),
        gentleRules: lines(elements.gentleRules.value),
        blockDateStamps: elements.blockDateStamps.checked,
        blockTimeStamps: elements.blockTimeStamps.checked,
        blockPeopleCounts: elements.blockPeopleCounts.checked,
        blockShortCheckIns: elements.blockShortCheckIns.checked,
      },
      danmakuRules: {
        ...config.danmakuRules,
        keywords: lines(elements.keywords.value),
        regex: lines(elements.regex.value),
        uidHashes: lines(elements.uidHashes.value),
      },
      browserExtension: {
        ...config.browserExtension,
        enabled: elements.enabled.checked,
        hideHomepageCarousel: elements.hideHomepageCarousel.checked,
        homepagePagedMode: elements.homepagePagedMode.checked,
        videoPageDomEnhancements: elements.videoPageDomEnhancements.checked,
        adFilter: {
          ...config.browserExtension.adFilter,
          enabled: elements.adFilterEnabled.checked,
          homepage: elements.adHomepage.checked,
          dynamic: elements.adDynamic.checked,
          video: elements.adVideo.checked,
          remoteKeywordsEnabled: elements.adRemoteKeywords.checked,
          customKeywords: lines(elements.adCustomKeywords.value),
        },
      },
    };
  }

  async function save() {
    try {
      const result = await Ui.writeConfig(collect());
      config = result.config;
      render();
      Ui.setMessage(elements.message, `已保存并应用${result.diagnostics.length ? `，有 ${result.diagnostics.length} 条诊断` : ''}`, 'ok');
    } catch (error) {
      Ui.setMessage(elements.message, error.message, 'error');
    }
  }

  elements.save.addEventListener('click', save);
  elements.importFile.addEventListener('change', async () => {
    const file = elements.importFile.files?.[0];
    if (!file) return;
    try {
      const result = await Ui.importFile(file);
      config = result.config;
      render();
      Ui.setMessage(elements.message, `导入成功${result.diagnostics.length ? `，有 ${result.diagnostics.length} 条诊断` : ''}`, 'ok');
    } catch (error) {
      Ui.setMessage(elements.message, error.message, 'error');
    } finally {
      elements.importFile.value = '';
    }
  });
  elements.exportFile.addEventListener('click', () => {
    try {
      Ui.downloadConfig(collect());
    } catch (error) {
      Ui.setMessage(elements.message, error.message, 'error');
    }
  });
  elements.exportBlackMids.addEventListener('click', () => {
    try {
      Ui.downloadUploaderMids(collect());
    } catch (error) {
      Ui.setMessage(elements.message, error.message, 'error');
    }
  });

  async function renderAdRuleStatus() {
    const stored = await chrome.storage.local.get('adRuleCache');
    const rules = stored.adRuleCache;
    elements.adRuleStatus.textContent = Array.isArray(rules?.keywords)
      ? `${rules.source === 'remote' ? '远程' : '内置'}词库 ${rules.version || ''} · ${rules.keywords.length} 条 · ${rules.syncedAt || '未知时间'}`
      : '尚未同步，后台将使用内置词库';
  }

  elements.syncAdRules.addEventListener('click', async () => {
    elements.syncAdRules.disabled = true;
    try {
      const result = await chrome.runtime.sendMessage({ kind: 'sync-ad-rules' });
      await renderAdRuleStatus();
      Ui.setMessage(elements.message, result?.ok ? '广告词库同步成功' : `远程同步失败，已使用${result?.cached ? '缓存' : '内置'}词库：${result?.error || '未知错误'}`, result?.ok ? 'ok' : 'error');
    } finally {
      elements.syncAdRules.disabled = false;
    }
  });

  Ui.readConfig().then((result) => {
    config = result.config;
    render();
    renderAdRuleStatus();
  }).catch((error) => Ui.setMessage(elements.message, error.message, 'error'));
})();
