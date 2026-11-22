import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { createLanguagesSection } from '@/entrypoints/options/languages-section';
import {
  INVALID_SERVER_URL_MESSAGE,
  SERVER_URL_INPUT_ID,
  TOKEN_INPUT_ID,
  createServerSection,
  describeConnection,
} from '@/entrypoints/options/server-section';
import { createSettingsSaver, type SettingsSaver } from '@/entrypoints/options/settings-saver';
import { NO_SITES_TEXT, createSitesSection } from '@/entrypoints/options/sites-section';
import { createTranslationSection } from '@/entrypoints/options/translation-section';
import type { ServerStatus } from '@/utils/server-status';
import {
  createDefaultSettings,
  loadSettings,
  saveSettings,
  setSiteEnabled,
  updateSite,
  type Settings,
} from '@/utils/settings';

const ONLINE: ServerStatus = { state: 'online', gpuName: 'RTX 3050', modelsLoaded: true };

let saver: SettingsSaver;

beforeEach(() => {
  fakeBrowser.reset();
  vi.restoreAllMocks();
  document.body.replaceChildren();
  saver = createSettingsSaver({ onStateChange: () => undefined });
});

function mount(element: HTMLElement): HTMLElement {
  document.body.append(element);
  return element;
}

function find<T extends Element = HTMLElement>(container: ParentNode, selector: string): T {
  const element = container.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Nothing matches ${selector}.`);
  }
  return element;
}

/** Changes a field the way typing does, then leaves it (which saves at once). */
function typeAndLeave(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input'));
  input.dispatchEvent(new Event('change'));
}

function answerServerChecks(status: ServerStatus): void {
  fakeBrowser.runtime.onMessage.addListener(
    (_message: unknown, _sender: unknown, sendResponse: (response: unknown) => void) => {
      sendResponse(status);
      return true;
    },
  );
}

async function savedSettings(): Promise<Settings> {
  return loadSettings();
}

describe('describeConnection', () => {
  it.each<[Parameters<typeof describeConnection>[0], string, string]>([
    [{ state: 'not-tested' }, 'neutral', 'Não testado'],
    [{ state: 'checking' }, 'neutral', 'Verificando…'],
    [ONLINE, 'success', 'Conectado · RTX 3050 · modelos carregados'],
    [{ state: 'online', gpuName: null, modelsLoaded: false }, 'success', 'Conectado · modelos não carregados'],
    [{ state: 'offline' }, 'danger', 'Servidor não encontrado'],
    [{ state: 'unauthorized' }, 'danger', 'Token recusado'],
    [{ state: 'no-permission' }, 'danger', 'Acesso não autorizado'],
    [{ state: 'error', reason: 'HTTP 500' }, 'danger', 'Erro: HTTP 500'],
  ])('maps %o to a %s pill "%s"', (connection, tone, text) => {
    expect(describeConnection(connection)).toEqual({ tone, text });
  });
});

describe('createServerSection', () => {
  it('rejects an address that is not http(s) and keeps the saved one', async () => {
    const section = mount(createServerSection(createDefaultSettings(), saver));
    const input = find<HTMLInputElement>(section, `#${SERVER_URL_INPUT_ID}`);

    typeAndLeave(input, 'ftp://192.168.0.10');
    await saver.flush();

    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(section.textContent).toContain(INVALID_SERVER_URL_MESSAGE);
    expect((await savedSettings()).serverUrl).toBe(createDefaultSettings().serverUrl);
  });

  it('saves a valid address without the trailing slash', async () => {
    const section = mount(createServerSection(createDefaultSettings(), saver));
    const input = find<HTMLInputElement>(section, `#${SERVER_URL_INPUT_ID}`);

    typeAndLeave(input, ' http://192.168.0.10:8000/ ');
    await saver.flush();

    expect((await savedSettings()).serverUrl).toBe('http://192.168.0.10:8000');
    expect(input.value).toBe('http://192.168.0.10:8000');
    expect(input.hasAttribute('aria-invalid')).toBe(false);
  });

  it('saves the token without surrounding spaces and can show it', async () => {
    const section = mount(createServerSection(createDefaultSettings(), saver));
    const input = find<HTMLInputElement>(section, `#${TOKEN_INPUT_ID}`);
    const showButton = find<HTMLButtonElement>(section, `button[aria-controls="${TOKEN_INPUT_ID}"]`);

    typeAndLeave(input, '  segredo-local\n');
    await saver.flush();
    expect((await savedSettings()).token).toBe('segredo-local');

    expect(input.type).toBe('password');
    showButton.click();
    expect(input.type).toBe('text');
    expect(showButton.getAttribute('aria-pressed')).toBe('true');
    expect(showButton.textContent).toBe('Ocultar');
  });

  it('tests the local server without asking for a permission', async () => {
    answerServerChecks(ONLINE);
    const request = vi.spyOn(fakeBrowser.permissions, 'request');
    const section = mount(createServerSection(createDefaultSettings(), saver));

    find<HTMLButtonElement>(section, '.button--primary').click();

    await vi.waitFor(() =>
      expect(find(section, '.connection-status').textContent).toBe('Conectado · RTX 3050 · modelos carregados'),
    );
    expect(request).not.toHaveBeenCalled();
  });

  it('asks for a host permission for a server on the network and shows a refusal', async () => {
    // The fake browser types this method with its callback overload, which returns void.
    const request = vi.spyOn(fakeBrowser.permissions, 'request').mockResolvedValue(false as never);
    const section = mount(createServerSection(createDefaultSettings(), saver));
    find<HTMLInputElement>(section, `#${SERVER_URL_INPUT_ID}`).value = 'http://192.168.0.10:8000';

    find<HTMLButtonElement>(section, '.button--primary').click();

    expect(request).toHaveBeenCalledWith({ origins: ['http://192.168.0.10/*'] });
    await vi.waitFor(() => expect(find(section, '.connection-status').textContent).toBe('Acesso não autorizado'));
  });

  it('does not test an invalid address and moves the focus to it', () => {
    const request = vi.spyOn(fakeBrowser.permissions, 'request');
    const section = mount(createServerSection(createDefaultSettings(), saver));
    const input = find<HTMLInputElement>(section, `#${SERVER_URL_INPUT_ID}`);
    input.value = 'not an address';

    find<HTMLButtonElement>(section, '.button--primary').click();

    expect(request).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
    expect(find(section, '.connection-status').textContent).toBe('Não testado');
  });
});

describe('createSitesSection', () => {
  function settingsWithSites(): Settings {
    let settings = createDefaultSettings();
    settings = setSiteEnabled(settings, 'outro-leitor.exemplo', true);
    settings = setSiteEnabled(settings, 'leitor.exemplo', true);
    settings = updateSite(settings, 'desligado.exemplo', { images: true });
    return settings;
  }

  function hosts(section: HTMLElement): Array<string | null> {
    return [...section.querySelectorAll('tbody tr')].map((row) => row.getAttribute('data-host'));
  }

  it('lists the enabled sites by name, with an empty state when there is none', () => {
    const empty = mount(createSitesSection(createDefaultSettings(), saver).element);
    expect(find(empty, '.sites-empty').hidden).toBe(false);
    expect(empty.textContent).toContain(NO_SITES_TEXT);

    const section = mount(createSitesSection(settingsWithSites(), saver).element);
    expect(hosts(section)).toEqual(['leitor.exemplo', 'outro-leitor.exemplo']);
    expect(find(section, '.sites-empty').hidden).toBe(true);
    expect(find(section, '[aria-label="Imagens em leitor.exemplo"]').getAttribute('aria-checked')).toBe('true');
    expect(find(section, '[aria-label="Texto em leitor.exemplo"]').getAttribute('aria-checked')).toBe('false');
  });

  it('saves the switches and the source language of a site', async () => {
    await saveSettings(settingsWithSites());
    const section = mount(createSitesSection(settingsWithSites(), saver).element);

    find<HTMLButtonElement>(section, '[aria-label="Texto em leitor.exemplo"]').click();
    const select = find<HTMLSelectElement>(section, '[aria-label="Idioma de origem em leitor.exemplo"]');
    select.value = 'ja';
    select.dispatchEvent(new Event('change'));
    await saver.flush();

    const site = (await savedSettings()).sites['leitor.exemplo'];
    expect(site?.text).toBe(true);
    expect(site?.sourceLanguage).toBe('ja');
  });

  it('removes a site and moves the focus to the next row', async () => {
    await saveSettings(settingsWithSites());
    const section = mount(createSitesSection(settingsWithSites(), saver).element);

    find<HTMLButtonElement>(section, '[aria-label="Remover leitor.exemplo"]').click();
    await saver.flush();

    expect(hosts(section)).toEqual(['outro-leitor.exemplo']);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Remover outro-leitor.exemplo');
    expect((await savedSettings()).sites['leitor.exemplo']).toBeUndefined();
  });

  it('follows changes made elsewhere and keeps the existing rows', () => {
    const sitesSection = createSitesSection(settingsWithSites(), saver);
    const section = mount(sitesSection.element);
    const existingRow = find(section, 'tr[data-host="leitor.exemplo"]');

    sitesSection.update(setSiteEnabled(settingsWithSites(), 'novo.exemplo', true));

    expect(hosts(section)).toEqual(['leitor.exemplo', 'novo.exemplo', 'outro-leitor.exemplo']);
    expect(find(section, 'tr[data-host="leitor.exemplo"]')).toBe(existingRow);
  });
});

describe('createTranslationSection and createLanguagesSection', () => {
  it('saves the translation preferences', async () => {
    const section = mount(createTranslationSection(createDefaultSettings(), saver).element);
    const onomatopoeia = find<HTMLButtonElement>(section, '[aria-label="Traduzir onomatopeias"]');

    expect(onomatopoeia.getAttribute('aria-checked')).toBe('false');
    onomatopoeia.click();
    await saver.flush();

    expect((await savedSettings()).translateOnomatopoeia).toBe(true);
    expect(section.textContent).not.toContain('glossário');
  });

  it('saves the target and the default source language', async () => {
    const section = mount(createLanguagesSection(createDefaultSettings(), saver).element);
    const [target, source] = section.querySelectorAll('select');
    if (target === undefined || source === undefined) {
      throw new Error('The languages section must have two selects.');
    }

    target.value = 'es';
    target.dispatchEvent(new Event('change'));
    source.value = 'ko';
    source.dispatchEvent(new Event('change'));
    await saver.flush();

    const saved = await savedSettings();
    expect(saved.targetLanguage).toBe('es');
    expect(saved.defaultSourceLanguage).toBe('ko');
  });
});
