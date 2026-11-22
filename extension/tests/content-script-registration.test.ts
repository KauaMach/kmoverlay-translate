import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  CONTENT_SCRIPT_FILE,
  CONTENT_SCRIPT_ID,
  desiredMatches,
  injectIntoOpenTabs,
  sitePatterns,
  sitePermissionPattern,
  syncContentScriptRegistration,
} from '@/utils/content-script-registration';
import { createDefaultSettings, saveSettings, setSiteEnabled, type Settings } from '@/utils/settings';

function settingsWith(...hosts: string[]): Settings {
  return hosts.reduce((settings, host) => setSiteEnabled(settings, host, true), createDefaultSettings());
}

// The fake browser does not implement these APIs and types them with their callback overloads.
function mockScripting(registered: unknown[]) {
  return {
    getRegistered: vi.spyOn(fakeBrowser.scripting, 'getRegisteredContentScripts').mockResolvedValue(registered as never),
    register: vi.spyOn(fakeBrowser.scripting, 'registerContentScripts').mockResolvedValue(undefined as never),
    update: vi.spyOn(fakeBrowser.scripting, 'updateContentScripts').mockResolvedValue(undefined as never),
    unregister: vi.spyOn(fakeBrowser.scripting, 'unregisterContentScripts').mockResolvedValue(undefined as never),
  };
}

function grantOrigins(origins: string[]): void {
  vi.spyOn(fakeBrowser.permissions, 'getAll').mockResolvedValue({ origins, permissions: [] } as never);
}

beforeEach(() => {
  fakeBrowser.reset();
  vi.restoreAllMocks();
});

describe('patterns', () => {
  it('covers both protocols of a site and asks for the protocol of the page', () => {
    expect(sitePatterns('leitor.exemplo')).toEqual(['http://leitor.exemplo/*', 'https://leitor.exemplo/*']);
    expect(sitePermissionPattern('https://leitor.exemplo/obra/1')).toBe('https://leitor.exemplo/*');
  });
});

describe('desiredMatches', () => {
  it('runs only on enabled sites whose permission is granted', () => {
    const settings = setSiteEnabled(settingsWith('leitor.exemplo', 'sem-permissao.exemplo', 'desligado.exemplo'), 'desligado.exemplo', false);

    expect(desiredMatches(settings, ['https://leitor.exemplo/*', 'https://desligado.exemplo/*'])).toEqual([
      'https://leitor.exemplo/*',
    ]);
  });

  it('accepts grants that cover several sites', () => {
    const settings = settingsWith('127.0.0.1');

    expect(desiredMatches(settings, ['<all_urls>'])).toEqual(['http://127.0.0.1/*', 'https://127.0.0.1/*']);
    expect(desiredMatches(settings, ['*://127.0.0.1/*'])).toEqual(['http://127.0.0.1/*', 'https://127.0.0.1/*']);
  });
});

describe('syncContentScriptRegistration', () => {
  it('registers the script for the enabled sites', async () => {
    await saveSettings(settingsWith('127.0.0.1'));
    grantOrigins(['http://127.0.0.1/*', 'http://localhost/*']);
    const scripting = mockScripting([]);

    await expect(syncContentScriptRegistration()).resolves.toEqual(['http://127.0.0.1/*']);

    expect(scripting.register).toHaveBeenCalledWith([
      { id: CONTENT_SCRIPT_ID, js: [CONTENT_SCRIPT_FILE], matches: ['http://127.0.0.1/*'], runAt: 'document_idle' },
    ]);
  });

  it('updates an existing registration and removes it when no site is left', async () => {
    await saveSettings(settingsWith('leitor.exemplo'));
    grantOrigins(['https://leitor.exemplo/*']);
    const withSite = mockScripting([{ id: CONTENT_SCRIPT_ID }]);
    await syncContentScriptRegistration();
    expect(withSite.update).toHaveBeenCalledOnce();

    await saveSettings(createDefaultSettings());
    const withoutSite = mockScripting([{ id: CONTENT_SCRIPT_ID }]);
    await expect(syncContentScriptRegistration()).resolves.toEqual([]);
    expect(withoutSite.unregister).toHaveBeenCalledWith({ ids: [CONTENT_SCRIPT_ID] });
  });
});

describe('injectIntoOpenTabs', () => {
  it('starts the script in every open tab of the site, even if one of them fails', async () => {
    vi.spyOn(fakeBrowser.tabs, 'query').mockResolvedValue([{ id: 1 }, { id: 2 }] as never);
    const executeScript = vi
      .spyOn(fakeBrowser.scripting, 'executeScript')
      .mockRejectedValueOnce(new Error('tab closed'))
      .mockResolvedValue([] as never);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await injectIntoOpenTabs(['https://leitor.exemplo/*']);

    expect(executeScript).toHaveBeenCalledTimes(2);
    expect(executeScript).toHaveBeenLastCalledWith({ target: { tabId: 2 }, files: [CONTENT_SCRIPT_FILE] });
    expect(consoleError).toHaveBeenCalledOnce();
  });

  it('does nothing without patterns', async () => {
    const query = vi.spyOn(fakeBrowser.tabs, 'query');

    await injectIntoOpenTabs([]);

    expect(query).not.toHaveBeenCalled();
  });
});
