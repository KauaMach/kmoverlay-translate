import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  DEFAULT_SERVER_URL,
  createDefaultSettings,
  createSiteSettings,
  getSite,
  listEnabledSites,
  loadSettings,
  normalizeSettings,
  removeSite,
  resolveSourceLanguage,
  saveSettings,
  setSiteEnabled,
  siteHostFromUrl,
  updateSettings,
  updateSite,
  type Settings,
} from '@/utils/settings';

const SETTINGS_STORAGE_KEY = 'settings';

function settingsWith(change: Partial<Settings>): Settings {
  return { ...createDefaultSettings(), ...change };
}

describe('createDefaultSettings', () => {
  it('uses the local server, Brazilian Portuguese and English as defaults', () => {
    expect(createDefaultSettings()).toEqual({
      serverUrl: DEFAULT_SERVER_URL,
      token: '',
      targetLanguage: 'pt-BR',
      defaultSourceLanguage: 'en',
      sites: {},
      translateOnomatopoeia: false,
      usePreviousPageContext: true,
      shrinkOverflowingText: true,
    });
  });

  it('returns a fresh object every time', () => {
    const first = createDefaultSettings();
    const second = createDefaultSettings();
    first.sites['leitor.exemplo'] = createSiteSettings(first);
    first.token = 'changed';

    expect(second).not.toBe(first);
    expect(second.sites).toEqual({});
    expect(second.token).toBe('');
  });
});

describe('normalizeSettings', () => {
  it.each([undefined, null, 'settings', 42, true, [], [1, 2]])('returns the defaults for %j', (raw) => {
    expect(normalizeSettings(raw)).toEqual(createDefaultSettings());
  });

  it('keeps valid stored values', () => {
    const stored: Settings = {
      serverUrl: 'http://192.168.0.10:9000',
      token: 'secret',
      targetLanguage: 'es',
      defaultSourceLanguage: 'ja',
      sites: {
        'leitor.exemplo': { enabled: true, images: false, text: true, sourceLanguage: 'auto' },
      },
      translateOnomatopoeia: true,
      usePreviousPageContext: false,
      shrinkOverflowingText: false,
    };

    expect(normalizeSettings(stored)).toEqual(stored);
  });

  it('fills missing fields with defaults', () => {
    expect(normalizeSettings({ token: 'secret', translateOnomatopoeia: true })).toEqual(
      settingsWith({ token: 'secret', translateOnomatopoeia: true }),
    );
  });

  it('replaces fields of the wrong type or with unknown values', () => {
    const normalized = normalizeSettings({
      serverUrl: 8000,
      token: null,
      targetLanguage: 'klingon',
      defaultSourceLanguage: 'auto',
      sites: 'leitor.exemplo',
      translateOnomatopoeia: 'yes',
      usePreviousPageContext: 0,
      shrinkOverflowingText: null,
    });

    expect(normalized).toEqual(createDefaultSettings());
  });

  it.each(['', '   ', 'not a url', 'ftp://127.0.0.1:8000', 'http://user:pass@127.0.0.1:8000'])(
    'falls back to the default server for the invalid address %j',
    (serverUrl) => {
      expect(normalizeSettings({ serverUrl }).serverUrl).toBe(DEFAULT_SERVER_URL);
    },
  );

  it('stores the server address without a trailing slash', () => {
    expect(normalizeSettings({ serverUrl: ' http://127.0.0.1:8000/ ' }).serverUrl).toBe('http://127.0.0.1:8000');
  });

  it('repairs each site and drops entries that are not objects', () => {
    const normalized = normalizeSettings({
      defaultSourceLanguage: 'ko',
      sites: {
        'partial.exemplo': { enabled: true },
        'garbage.exemplo': { enabled: 'yes', images: 1, text: 'no', sourceLanguage: 'xx' },
        'string.exemplo': 'enabled',
        'null.exemplo': null,
        'array.exemplo': [true],
        '': { enabled: true },
      },
    });

    expect(normalized.sites).toEqual({
      'partial.exemplo': { enabled: true, images: true, text: false, sourceLanguage: 'en' },
      'garbage.exemplo': { enabled: false, images: true, text: false, sourceLanguage: 'en' },
    });
  });

  it('keeps a "__proto__" host as a plain site instead of changing the prototype', () => {
    const raw: unknown = JSON.parse('{"sites": {"__proto__": {"enabled": true}}}');

    const normalized = normalizeSettings(raw);

    expect(Object.getPrototypeOf(normalized.sites)).toBe(Object.prototype);
    expect(getSite(normalized, '__proto__')).toEqual({
      enabled: true,
      images: true,
      text: false,
      sourceLanguage: 'en',
    });
  });
});

describe('setSiteEnabled', () => {
  it('creates a site with images on, text off and the default source language', () => {
    const settings = settingsWith({ defaultSourceLanguage: 'ja' });

    const next = setSiteEnabled(settings, 'leitor.exemplo', true);

    expect(getSite(next, 'leitor.exemplo')).toEqual({
      enabled: true,
      images: true,
      text: false,
      sourceLanguage: 'ja',
    });
  });

  it('keeps the preferences of a site when it is turned off and on again', () => {
    let settings = setSiteEnabled(createDefaultSettings(), 'leitor.exemplo', true);
    settings = updateSite(settings, 'leitor.exemplo', { text: true, images: false, sourceLanguage: 'ko' });

    settings = setSiteEnabled(settings, 'leitor.exemplo', false);
    expect(getSite(settings, 'leitor.exemplo')).toEqual({
      enabled: false,
      images: false,
      text: true,
      sourceLanguage: 'ko',
    });

    settings = setSiteEnabled(settings, 'leitor.exemplo', true);
    expect(getSite(settings, 'leitor.exemplo')).toEqual({
      enabled: true,
      images: false,
      text: true,
      sourceLanguage: 'ko',
    });
  });

  it('does not change the settings it receives', () => {
    const settings = createDefaultSettings();

    setSiteEnabled(settings, 'leitor.exemplo', true);

    expect(settings.sites).toEqual({});
  });

  it('creates a complete site for hostnames that match Object properties', () => {
    for (const host of ['constructor', 'toString', 'hasOwnProperty']) {
      const next = setSiteEnabled(createDefaultSettings(), host, true);

      expect(getSite(next, host)).toEqual({ enabled: true, images: true, text: false, sourceLanguage: 'en' });
    }
  });
});

describe('getSite', () => {
  it('ignores properties inherited from Object', () => {
    const settings = createDefaultSettings();

    expect(getSite(settings, 'constructor')).toBeUndefined();
    expect(getSite(settings, '__proto__')).toBeUndefined();
    expect(getSite(settings, 'toString')).toBeUndefined();
  });
});

describe('updateSite', () => {
  it('creates a site that is turned off', () => {
    const next = updateSite(settingsWith({ defaultSourceLanguage: 'zh' }), 'novo.exemplo', { text: true });

    expect(getSite(next, 'novo.exemplo')).toEqual({
      enabled: false,
      images: true,
      text: true,
      sourceLanguage: 'zh',
    });
  });

  it('changes only the given preferences', () => {
    const settings = setSiteEnabled(createDefaultSettings(), 'leitor.exemplo', true);

    const next = updateSite(settings, 'leitor.exemplo', { sourceLanguage: 'auto' });

    expect(getSite(next, 'leitor.exemplo')).toEqual({
      enabled: true,
      images: true,
      text: false,
      sourceLanguage: 'auto',
    });
    expect(getSite(settings, 'leitor.exemplo')?.sourceLanguage).toBe('en');
  });
});

describe('removeSite', () => {
  it('removes only the given site and keeps the original settings untouched', () => {
    let settings = setSiteEnabled(createDefaultSettings(), 'a.exemplo', true);
    settings = setSiteEnabled(settings, 'b.exemplo', true);

    const next = removeSite(settings, 'a.exemplo');

    expect(Object.keys(next.sites)).toEqual(['b.exemplo']);
    expect(Object.keys(settings.sites)).toEqual(['a.exemplo', 'b.exemplo']);
  });

  it('does nothing for an unknown site', () => {
    const settings = setSiteEnabled(createDefaultSettings(), 'a.exemplo', true);

    expect(removeSite(settings, 'b.exemplo').sites).toEqual(settings.sites);
  });
});

describe('listEnabledSites', () => {
  it('lists only enabled sites, sorted by hostname', () => {
    let settings = setSiteEnabled(createDefaultSettings(), 'zeta.exemplo', true);
    settings = setSiteEnabled(settings, 'alfa.exemplo', true);
    settings = setSiteEnabled(settings, 'meio.exemplo', false);
    settings = updateSite(settings, 'beta.exemplo', { text: true });

    expect(listEnabledSites(settings).map(([host]) => host)).toEqual(['alfa.exemplo', 'zeta.exemplo']);
  });

  it('returns an empty list when nothing is enabled', () => {
    expect(listEnabledSites(createDefaultSettings())).toEqual([]);
  });
});

describe('resolveSourceLanguage', () => {
  it('uses the language chosen for the site', () => {
    const settings = updateSite(createDefaultSettings(), 'leitor.exemplo', { sourceLanguage: 'auto' });

    expect(resolveSourceLanguage(settings, 'leitor.exemplo')).toBe('auto');
  });

  it('falls back to the default source language', () => {
    expect(resolveSourceLanguage(settingsWith({ defaultSourceLanguage: 'ru' }), 'outro.exemplo')).toBe('ru');
    expect(resolveSourceLanguage(createDefaultSettings(), 'constructor')).toBe('en');
  });
});

describe('siteHostFromUrl', () => {
  it.each([
    ['https://leitor.exemplo/capitulo/1?pagina=2#topo', 'leitor.exemplo'],
    ['http://Leitor.Exemplo:8080/', 'leitor.exemplo'],
    ['http://127.0.0.1:3000/', '127.0.0.1'],
  ])('returns the hostname of %s', (url, host) => {
    expect(siteHostFromUrl(url)).toBe(host);
  });

  it.each([
    'chrome://extensions/',
    'about:blank',
    'about:addons',
    'file:///home/kz/hq.html',
    'moz-extension://abc/popup.html',
    'data:text/html,oi',
    'not a url',
    '',
    undefined,
  ])('returns null for %j', (url) => {
    expect(siteHostFromUrl(url)).toBeNull();
  });
});

describe('storage', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('loads the defaults when nothing is stored', async () => {
    await expect(loadSettings()).resolves.toEqual(createDefaultSettings());
  });

  it('loads normalized settings from damaged storage', async () => {
    await fakeBrowser.storage.local.set({ [SETTINGS_STORAGE_KEY]: { token: 42, serverUrl: 'http://10.0.0.2:8000/' } });

    const settings = await loadSettings();

    expect(settings.token).toBe('');
    expect(settings.serverUrl).toBe('http://10.0.0.2:8000');
  });

  it('saves and loads the same settings', async () => {
    const settings = setSiteEnabled(settingsWith({ token: 'secret', targetLanguage: 'en' }), 'leitor.exemplo', true);

    await saveSettings(settings);

    await expect(loadSettings()).resolves.toEqual(settings);
  });

  it('keeps the settings in storage.local', async () => {
    await saveSettings(settingsWith({ token: 'secret' }));

    const stored = await fakeBrowser.storage.local.get(SETTINGS_STORAGE_KEY);
    expect(stored[SETTINGS_STORAGE_KEY]).toMatchObject({ token: 'secret' });
    await expect(fakeBrowser.storage.sync.get(SETTINGS_STORAGE_KEY)).resolves.toEqual({});
  });

  it('updates the stored settings and returns what was saved', async () => {
    const saved = await updateSettings((current) => setSiteEnabled(current, 'leitor.exemplo', true));

    expect(getSite(saved, 'leitor.exemplo')?.enabled).toBe(true);
    await expect(loadSettings()).resolves.toEqual(saved);
  });

  it('applies concurrent updates one after the other', async () => {
    const toggle = (current: Settings): Settings =>
      setSiteEnabled(current, 'leitor.exemplo', !(getSite(current, 'leitor.exemplo')?.enabled ?? false));

    // Run in parallel, both would read "off" and the site would end up on.
    await Promise.all([updateSettings(toggle), updateSettings(toggle)]);

    expect(getSite(await loadSettings(), 'leitor.exemplo')?.enabled).toBe(false);
  });

  it('rejects a failed update without blocking the next ones', async () => {
    const failure = new Error('change failed');

    const failed = updateSettings(() => {
      throw failure;
    });
    const next = updateSettings((current) => ({ ...current, token: 'after' }));

    await expect(failed).rejects.toBe(failure);
    await expect(next).resolves.toMatchObject({ token: 'after' });
    await expect(loadSettings()).resolves.toMatchObject({ token: 'after' });
  });
});
