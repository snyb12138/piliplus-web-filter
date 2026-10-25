(() => {
  'use strict';

  const CACHE_KEY = 'adRuleCache';
  const ALARM_NAME = 'pbp-sync-ad-rules';
  const REMOTE_URL = 'https://raw.githubusercontent.com/snyb12138/piliplus-web-filter/main/config/ad-keywords.json';

  function normalizeRules(raw, source) {
    const keywords = Array.isArray(raw?.keywords)
      ? [...new Set(raw.keywords.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean))]
      : [];
    if (!keywords.length) throw new Error('广告词库为空或格式无效');
    return {
      version: typeof raw.version === 'string' ? raw.version : 'unknown',
      keywords,
      source,
      syncedAt: new Date().toISOString(),
    };
  }

  async function loadBundledRules() {
    const response = await fetch(chrome.runtime.getURL('config/ad-keywords.json'));
    if (!response.ok) throw new Error(`内置词库读取失败：HTTP ${response.status}`);
    return normalizeRules(await response.json(), 'bundled');
  }

  async function syncAdRules() {
    try {
      const response = await fetch(REMOTE_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const rules = normalizeRules(await response.json(), 'remote');
      await chrome.storage.local.set({ [CACHE_KEY]: rules });
      return { ok: true, rules };
    } catch (error) {
      const existing = (await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY];
      if (Array.isArray(existing?.keywords) && existing.keywords.length) {
        return { ok: false, cached: true, error: error.message, rules: existing };
      }
      const rules = await loadBundledRules();
      await chrome.storage.local.set({ [CACHE_KEY]: rules });
      return { ok: false, cached: false, error: error.message, rules };
    }
  }

  async function ensureAlarm() {
    await chrome.alarms.clear(ALARM_NAME);
    chrome.alarms.create(ALARM_NAME, { delayInMinutes: 1, periodInMinutes: 24 * 60 });
  }

  chrome.runtime.onInstalled.addListener(() => {
    ensureAlarm();
    syncAdRules();
  });
  chrome.runtime.onStartup.addListener(ensureAlarm);
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) syncAdRules();
  });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.kind !== 'sync-ad-rules') return false;
    syncAdRules().then(sendResponse, (error) => sendResponse({ ok: false, error: error.message }));
    return true;
  });
})();
