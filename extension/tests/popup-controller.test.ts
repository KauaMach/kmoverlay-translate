import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  CHECK_FAILED_REASON,
  LOAD_FAILED_MESSAGE,
  OPEN_OPTIONS_FAILED_MESSAGE,
  SAVE_FAILED_MESSAGE,
  SITE_PERMISSION_DENIED_MESSAGE,
  startPopup,
} from '@/entrypoints/popup/controller';
import { CONTROL_IDS } from '@/entrypoints/popup/render';
import type { ContentRequest, PageStatus } from '@/utils/messages';
import type { ServerStatus } from '@/utils/server-status';
import { createDefaultSettings, loadSettings, saveSettings, setSiteEnabled } from '@/utils/settings';

const READER_URL = 'https://leitor.exemplo/capitulo/12';
const READER_HOST = 'leitor.exemplo';
const MINUTE_MS = 60_000;
const ONLINE: ServerStatus = { state: 'online', gpuName: 'RTX 3050', modelsLoaded: true };
const NO_RECEIVER = 'Could not establish connection. Receiving end does not exist.';

let root: HTMLElement;

beforeEach(async () => {
  fakeBrowser.reset();
  vi.restoreAllMocks();
  document.body.replaceChildren();
  root = document.createElement('div');
  document.body.append(root);
  // The fake browser starts without a focused window, and the popup looks for
  // the active tab of the current (focused) window.
  const focusedWindow = await fakeBrowser.windows.create({ focused: true });
  await fakeBrowser.tabs.create({ url: READER_URL, active: true, windowId: focusedWindow?.id });
  // Turning a site on asks for its host permission; the fake browser does not implement it.
  grantSitePermission(true);
});

function grantSitePermission(granted: boolean): ReturnType<typeof vi.spyOn> {
  // The fake browser types this method with its callback overload, which returns void.
  return vi.spyOn(fakeBrowser.permissions, 'request').mockResolvedValue(granted as never);
}

/** Makes the fake background script answer every server check with `status`. */
function answerServerChecks(status: ServerStatus): void {
  fakeBrowser.runtime.onMessage.addListener((_message: unknown, _sender: unknown, sendResponse: (response: unknown) => void) => {
    sendResponse(status);
    return true;
  });
}

/** Makes the active tab answer like a content script, or like a page without one. */
function mockContentScript(handler: (request: ContentRequest) => unknown): ReturnType<typeof vi.fn> {
  const sendMessage = vi.fn(async (_tabId: number, request: ContentRequest) => handler(request));
  vi.spyOn(fakeBrowser.tabs, 'sendMessage').mockImplementation(sendMessage as never);
  return sendMessage;
}

function withoutContentScript(): ReturnType<typeof vi.fn> {
  return mockContentScript(() => {
    throw new Error(NO_RECEIVER);
  });
}

function control<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = root.querySelector<T>(`#${id}`);
  if (element === null) {
    throw new Error(`Control #${id} is not on screen.`);
  }
  return element;
}

function pillText(): string | undefined {
  return root.querySelector('.popup__status')?.textContent ?? undefined;
}

function footerText(): string | null | undefined {
  return root.querySelector('footer')?.textContent;
}

async function enableReaderSite(): Promise<void> {
  await saveSettings(setSiteEnabled(createDefaultSettings(), READER_HOST, true));
}

describe('startPopup: server state', () => {
  it('renders "Verificando…" right away and the connected layout once the server answers', async () => {
    withoutContentScript();
    let respond: (status: ServerStatus) => void = () => undefined;
    fakeBrowser.runtime.onMessage.addListener(
      (_message: unknown, _sender: unknown, sendResponse: (response: unknown) => void) => {
        respond = sendResponse;
        return true;
      },
    );

    const started = startPopup(root);
    await vi.waitFor(() => expect(pillText()).toBe('Verificando…'));
    expect(root.querySelector('.popup__status')?.getAttribute('aria-live')).toBe('polite');
    expect(root.querySelector('.popup__site-host')?.textContent).toBe(READER_HOST);

    respond(ONLINE);
    await started;

    expect(pillText()).toBe('Conectado');
    expect(root.querySelector('.pill--success')).not.toBeNull();
    expect(footerText()).toBe('Servidor local · 127.0.0.1:8000 · RTX 3050');
  });

  it('shows the offline card with the command, the cache notes and the inert site', async () => {
    withoutContentScript();
    answerServerChecks({ state: 'offline' });
    await fakeBrowser.storage.local.set({ lastConnectedAt: Date.now() - 12 * MINUTE_MS });

    await startPopup(root);

    expect(pillText()).toBe('Offline');
    expect(root.querySelector('.popup__problem-title')?.textContent).toBe('Servidor não encontrado');
    expect(root.querySelector('code')?.textContent).toBe('uv run kmoverlay serve');
    expect(root.querySelector('.popup__meanwhile')?.textContent).toContain(
      'Páginas já traduzidas continuam aparecendo, pelo cache.',
    );
    const inertSite = root.querySelector('.popup__site--inert');
    expect(inertSite?.hasAttribute('inert')).toBe(true);
    expect(inertSite?.querySelector('[role="switch"]')?.hasAttribute('disabled')).toBe(true);
    expect(root.querySelector(`#${CONTROL_IDS.sourceLanguage}`)).toBeNull();
    expect(footerText()).toBe('Última conexão há 12 min');
  });

  it('retries the check, keeping the card while it runs', async () => {
    withoutContentScript();
    const statuses: ServerStatus[] = [{ state: 'offline' }, ONLINE];
    const pending: Array<() => void> = [];
    fakeBrowser.runtime.onMessage.addListener(
      (_message: unknown, _sender: unknown, sendResponse: (response: unknown) => void) => {
        const status = statuses.shift();
        pending.push(() => sendResponse(status));
        return true;
      },
    );
    const started = startPopup(root);
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    pending.shift()?.();
    await started;

    control(CONTROL_IDS.retry).click();

    await vi.waitFor(() => expect(pending).toHaveLength(1));
    expect(pillText()).toBe('Verificando…');
    expect(control(CONTROL_IDS.retry).getAttribute('aria-disabled')).toBe('true');
    expect(control(CONTROL_IDS.retry).textContent).toBe('Verificando…');
    pending.shift()?.();
    await vi.waitFor(() => expect(pillText()).toBe('Conectado'));
    expect(root.querySelector('.popup__problem-card')).toBeNull();
  });

  it('shows an error card when the background script cannot run the check', async () => {
    withoutContentScript();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    // No background listener: sending the message fails.
    await startPopup(root);

    expect(pillText()).toBe('Erro');
    expect(root.querySelector('.popup__problem-message')?.textContent).toBe(
      `Resposta inesperada de 127.0.0.1:8000 (${CHECK_FAILED_REASON}).`,
    );
    expect(consoleError).toHaveBeenCalled();
  });
});

describe('startPopup: site settings', () => {
  it('turns the site on and enables the image and text switches', async () => {
    withoutContentScript();
    answerServerChecks(ONLINE);
    await startPopup(root);
    expect(control(CONTROL_IDS.imagesSwitch).hasAttribute('disabled')).toBe(true);
    expect(control<HTMLSelectElement>(CONTROL_IDS.sourceLanguage).disabled).toBe(true);
    expect(root.querySelector('.popup__site-options')?.classList.contains('popup__dimmed')).toBe(true);

    control(CONTROL_IDS.siteSwitch).click();

    await vi.waitFor(() => expect(root.querySelector('.popup__site-subtitle')?.textContent).toBe('Ativo neste site'));
    expect((await loadSettings()).sites[READER_HOST]?.enabled).toBe(true);
    expect(control(CONTROL_IDS.imagesSwitch).hasAttribute('disabled')).toBe(false);
    expect(control<HTMLSelectElement>(CONTROL_IDS.sourceLanguage).disabled).toBe(false);
    expect(root.querySelector('.popup__site-options')?.classList.contains('popup__dimmed')).toBe(false);
    expect(fakeBrowser.permissions.request).toHaveBeenCalledWith({ origins: ['https://leitor.exemplo/*'] });
    expect(root.querySelector<HTMLElement>('[role="alert"]')?.hidden).not.toBe(false);
  });

  it('turns the site off again when the browser permission is refused', async () => {
    withoutContentScript();
    answerServerChecks(ONLINE);
    grantSitePermission(false);
    await startPopup(root);

    control(CONTROL_IDS.siteSwitch).click();

    await vi.waitFor(() =>
      expect(root.querySelector('[role="alert"]')?.textContent).toBe(SITE_PERMISSION_DENIED_MESSAGE),
    );
    await vi.waitFor(async () => expect((await loadSettings()).sites[READER_HOST]?.enabled).toBe(false));
    expect(root.querySelector('.popup__site-subtitle')?.textContent).toBe('Desligado neste site');
  });

  it('keeps keyboard focus on the switch after the popup renders again', async () => {
    withoutContentScript();
    answerServerChecks(ONLINE);
    await startPopup(root);
    const siteSwitch = control(CONTROL_IDS.siteSwitch);
    siteSwitch.focus();

    siteSwitch.click();

    await vi.waitFor(() => expect(control(CONTROL_IDS.siteSwitch)).not.toBe(siteSwitch));
    expect(document.activeElement).toBe(control(CONTROL_IDS.siteSwitch));
  });

  it('saves the image and text preferences', async () => {
    withoutContentScript();
    answerServerChecks(ONLINE);
    await enableReaderSite();
    await startPopup(root);

    control(CONTROL_IDS.imagesSwitch).click();
    control(CONTROL_IDS.textSwitch).click();

    await vi.waitFor(async () => {
      expect((await loadSettings()).sites[READER_HOST]).toMatchObject({ images: false, text: true });
    });
    expect(control(CONTROL_IDS.textSwitch).getAttribute('aria-checked')).toBe('true');
  });

  it('saves the source language of the site and the target language', async () => {
    withoutContentScript();
    answerServerChecks(ONLINE);
    await enableReaderSite();
    await startPopup(root);

    const source = control<HTMLSelectElement>(CONTROL_IDS.sourceLanguage);
    source.value = 'ja';
    source.dispatchEvent(new Event('change'));
    const target = control<HTMLSelectElement>(CONTROL_IDS.targetLanguage);
    target.value = 'es';
    target.dispatchEvent(new Event('change'));

    await vi.waitFor(async () => {
      const settings = await loadSettings();
      expect(settings.sites[READER_HOST]?.sourceLanguage).toBe('ja');
      expect(settings.targetLanguage).toBe('es');
    });
    expect(control<HTMLSelectElement>(CONTROL_IDS.sourceLanguage).value).toBe('ja');
  });

  it('shows a message and the saved value when saving fails', async () => {
    withoutContentScript();
    answerServerChecks(ONLINE);
    await startPopup(root);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(fakeBrowser.storage.local, 'set').mockRejectedValue(new Error('QUOTA_BYTES quota exceeded'));

    control(CONTROL_IDS.siteSwitch).click();

    await vi.waitFor(() => expect(root.querySelector('[role="alert"]')?.textContent).toBe(SAVE_FAILED_MESSAGE));
    expect(root.querySelector<HTMLElement>('[role="alert"]')?.hidden).toBe(false);
    expect(control(CONTROL_IDS.siteSwitch).getAttribute('aria-checked')).toBe('false');
    expect(consoleError).toHaveBeenCalled();
  });

  it('has no switches on pages that cannot be translated', async () => {
    await fakeBrowser.tabs.create({ url: 'chrome://extensions/', active: true });
    const sendMessage = withoutContentScript();
    answerServerChecks(ONLINE);

    await startPopup(root);

    expect(root.querySelector('.popup__site')?.textContent).toBe('Esta página não pode ser traduzida');
    expect(root.querySelector('[role="switch"]')).toBeNull();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe('startPopup: page', () => {
  it('has no page section without a content script', async () => {
    withoutContentScript();
    answerServerChecks(ONLINE);

    await startPopup(root);

    expect(root.querySelector('[role="progressbar"]')).toBeNull();
    expect(root.querySelector(`#${CONTROL_IDS.toggleOriginal}`)).toBeNull();
  });

  it('shows the chapter progress and toggles between original and translation', async () => {
    let pageStatus: PageStatus = { translatedImages: 5, totalImages: 12, showingOriginal: false };
    const sendMessage = mockContentScript((request) => {
      if (request.type === 'toggle-original') {
        pageStatus = { ...pageStatus, showingOriginal: !pageStatus.showingOriginal };
        return undefined;
      }
      return pageStatus;
    });
    answerServerChecks(ONLINE);
    await enableReaderSite();
    await startPopup(root);

    const progress = root.querySelector('[role="progressbar"]');
    expect(progress?.getAttribute('aria-valuenow')).toBe('5');
    expect(progress?.getAttribute('aria-valuemax')).toBe('12');
    expect(root.querySelector<HTMLElement>('.popup__progress-fill')?.style.width).toBe('42%');
    expect(root.querySelector('.popup__chapter-count')?.textContent).toBe('5 de 12 páginas');
    expect(control(CONTROL_IDS.toggleOriginal).textContent).toBe('Mostrar originalAlt+T');
    expect(root.textContent).not.toContain('Capturar área visível');

    control(CONTROL_IDS.toggleOriginal).click();

    await vi.waitFor(() => expect(control(CONTROL_IDS.toggleOriginal).textContent).toBe('Mostrar traduçãoAlt+T'));
    const tabId = sendMessage.mock.calls[0]?.[0];
    expect(sendMessage).toHaveBeenCalledWith(tabId, { type: 'toggle-original' });
  });
});

describe('startPopup: options and failures', () => {
  it('opens the options page from the header and from the problem card', async () => {
    withoutContentScript();
    answerServerChecks({ state: 'unauthorized' });
    const openOptionsPage = vi.spyOn(fakeBrowser.runtime, 'openOptionsPage').mockResolvedValue(undefined);
    await startPopup(root);

    expect(control(CONTROL_IDS.optionsButton).getAttribute('aria-label')).toBe('Opções');
    control(CONTROL_IDS.optionsButton).click();
    control(CONTROL_IDS.openOptions).click();

    expect(openOptionsPage).toHaveBeenCalledTimes(2);
  });

  it('reports when the options page cannot be opened', async () => {
    withoutContentScript();
    answerServerChecks(ONLINE);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(fakeBrowser.runtime, 'openOptionsPage').mockRejectedValue(new Error('No options page'));
    await startPopup(root);

    control(CONTROL_IDS.optionsButton).click();

    await vi.waitFor(() =>
      expect(root.querySelector('[role="alert"]')?.textContent).toBe(OPEN_OPTIONS_FAILED_MESSAGE),
    );
    expect(consoleError).toHaveBeenCalled();
  });

  it('reports when the popup cannot load its data', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(fakeBrowser.tabs, 'query').mockRejectedValue(new Error('tabs unavailable'));

    await startPopup(root);

    expect(root.querySelector('[role="alert"]')?.textContent).toBe(LOAD_FAILED_MESSAGE);
    expect(consoleError).toHaveBeenCalled();
  });
});
