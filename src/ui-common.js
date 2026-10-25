(() => {
  'use strict';
  const Core = globalThis.PiliPlusPurifyCore;
  const STORAGE_KEY = 'purifyConfig';

  async function readConfig() {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    if (!stored[STORAGE_KEY]) {
      const config = Core.defaultConfig();
      await chrome.storage.local.set({ [STORAGE_KEY]: config });
      return { config, diagnostics: [] };
    }
    return Core.normalizeConfig(stored[STORAGE_KEY]);
  }

  async function writeConfig(config) {
    const normalized = Core.normalizeConfig(config);
    await chrome.storage.local.set({ [STORAGE_KEY]: normalized.config });
    return normalized;
  }

  async function importFile(file) {
    const text = await file.text();
    let raw;
    try {
      raw = JSON.parse(text);
    } catch (error) {
      throw new Core.FormatError(`JSON 无法解析：${error.message}`);
    }
    let parsed;
    if (Array.isArray(raw)) {
      const current = await readConfig();
      const candidates = raw.map((mid) => ({ mid }));
      parsed = Core.normalizeConfig({
        ...current.config,
        uploaderRules: {
          ...current.config.uploaderRules,
          users: [...candidates, ...current.config.uploaderRules.users],
        },
      });
      parsed.diagnostics.unshift({
        level: 'info',
        code: 'black-mids-import',
        message: `已合并 PiliPlus blackMids 名单，共 ${parsed.config.uploaderRules.users.length} 个 UP 主`,
      });
    } else {
      parsed = Core.normalizeConfig(raw);
    }
    await chrome.storage.local.set({ [STORAGE_KEY]: parsed.config });
    return parsed;
  }

  function downloadConfig(config) {
    const date = new Date();
    const stamp = [date.getUTCFullYear(), String(date.getUTCMonth() + 1).padStart(2, '0'), String(date.getUTCDate()).padStart(2, '0'), String(date.getUTCHours()).padStart(2, '0'), String(date.getUTCMinutes()).padStart(2, '0'), String(date.getUTCSeconds()).padStart(2, '0')].join('');
    const blob = new Blob([Core.exportConfig(config)], { type: 'application/json;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `piliplus_purify_v4_${stamp}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
  }

  function downloadUploaderMids(config) {
    const normalized = Core.normalizeConfig(config).config;
    const mids = normalized.uploaderRules.users.map((user) => user.mid);
    const blob = new Blob([`${JSON.stringify(mids, null, 2)}\n`], { type: 'application/json;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'blackMids.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
  }

  function setMessage(element, message, type = '') {
    element.textContent = message;
    element.className = `message ${type}`.trim();
  }

  globalThis.PiliPlusPurifyUi = Object.freeze({ STORAGE_KEY, readConfig, writeConfig, importFile, downloadConfig, downloadUploaderMids, setMessage });
})();
