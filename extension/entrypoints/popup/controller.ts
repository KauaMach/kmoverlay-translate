import { browser } from 'wxt/browser';
import { sitePermissionPattern } from '@/utils/content-script-registration';
import { isSiteSourceLanguage, isTargetLanguage } from '@/utils/languages';
import { requestPageStatus, requestServerCheck, sendToContentScript, type PageStatus } from '@/utils/messages';
import { loadLastConnectedAt, type ServerStatus } from '@/utils/server-status';
import {
  loadSettings,
  setSiteEnabled,
  siteHostFromUrl,
  updateSettings,
  updateSite,
  type Settings,
} from '@/utils/settings';
import { createPopupView, type PopupHandlers, type PopupView } from './render';
import { buildPopupViewModel, type PopupServerState } from './view-model';

interface PopupState {
  settings: Settings;
  tabId: number | null;
  tabUrl: string | undefined;
  serverStatus: PopupServerState;
  previousServerStatus: ServerStatus | null;
  lastConnectedAt: number | null;
  pageStatus: PageStatus | null;
}

interface ActiveTab {
  id: number | null;
  url: string | undefined;
}

export const LOAD_FAILED_MESSAGE = 'Não foi possível carregar as configurações. Feche e abra o popup de novo.';
export const SAVE_FAILED_MESSAGE = 'Não foi possível salvar a alteração. Tente de novo.';
export const PAGE_STATUS_FAILED_MESSAGE = 'Não foi possível ler o progresso desta página.';
export const TOGGLE_ORIGINAL_FAILED_MESSAGE = 'Não foi possível alternar entre original e tradução.';
export const OPEN_OPTIONS_FAILED_MESSAGE = 'Não foi possível abrir as opções.';
export const SITE_PERMISSION_DENIED_MESSAGE = 'Sem a permissão do navegador, a extensão não consegue ler as imagens deste site.';
export const SITE_PERMISSION_FAILED_MESSAGE = 'Não foi possível pedir a permissão deste site.';
/** Shown as the reason of the error card when the background script could not run the check. */
export const CHECK_FAILED_REASON = 'falha ao verificar o servidor';
const LOG_PREFIX = 'KMOverlay popup:';

/**
 * Runs the popup inside `root`: loads the settings and the active tab, renders
 * at once with the server being checked, then renders again with the result.
 * Resolves when that first check is over. Failures are logged and shown, never thrown.
 */
export async function startPopup(root: HTMLElement): Promise<void> {
  let state: PopupState | null = null;
  // Settings changes run one after the other so quick clicks never overwrite each other.
  let settingsQueue: Promise<void> = Promise.resolve();

  const render = (): void => {
    if (state !== null) {
      view.render(buildPopupViewModel({ ...state, now: Date.now() }));
    }
  };

  const report = (error: unknown, message: string): void => {
    console.error(LOG_PREFIX, message, error);
    view.showError(message);
  };

  const checkServer = async (): Promise<void> => {
    if (state === null) {
      return;
    }
    const current = state;
    if (current.serverStatus !== 'checking') {
      current.previousServerStatus = current.serverStatus;
    }
    current.serverStatus = 'checking';
    render();
    try {
      current.serverStatus = await requestServerCheck();
    } catch (error) {
      console.error(LOG_PREFIX, 'the server check failed.', error);
      current.serverStatus = { state: 'error', reason: CHECK_FAILED_REASON };
    }
    if (current.serverStatus.state === 'online') {
      // The background script stores this same moment when the server answers.
      current.lastConnectedAt = Date.now();
    }
    render();
  };

  /** Saves a change; `notice` is shown once it is saved (a message shown earlier would be cleared). */
  const changeSettings = (change: (settings: Settings) => Settings, notice?: string): void => {
    settingsQueue = settingsQueue.then(async () => {
      if (state === null) {
        return;
      }
      view.showError(null);
      try {
        state.settings = await updateSettings(change);
      } catch (error) {
        report(error, SAVE_FAILED_MESSAGE);
      }
      // Also after a failure: the switch already flipped itself and must show the saved value again.
      render();
      if (notice !== undefined) {
        view.showError(notice);
      }
    });
  };

  const changeCurrentSite = (change: (settings: Settings, host: string) => Settings, notice?: string): void => {
    const host = siteHostFromUrl(state?.tabUrl);
    if (host !== null) {
      changeSettings((settings) => change(settings, host), notice);
    }
  };

  /**
   * Asks for the host permission of the current site. The content script can
   * only read the images with it; without it the site is turned off again.
   */
  const requestSitePermission = (): void => {
    const url = state?.tabUrl;
    if (url === undefined || siteHostFromUrl(url) === null) {
      return;
    }
    let permission: Promise<boolean>;
    try {
      permission = browser.permissions.request({ origins: [sitePermissionPattern(url)] });
    } catch (error) {
      report(error, SITE_PERMISSION_FAILED_MESSAGE);
      return;
    }
    permission.then(
      (granted) => {
        if (!granted) {
          changeCurrentSite((settings, host) => setSiteEnabled(settings, host, false), SITE_PERMISSION_DENIED_MESSAGE);
        }
      },
      (error: unknown) => report(error, SITE_PERMISSION_FAILED_MESSAGE),
    );
  };

  const toggleOriginal = async (): Promise<void> => {
    if (state === null || state.tabId === null) {
      return;
    }
    const current = state;
    const tabId = state.tabId;
    view.showError(null);
    try {
      await sendToContentScript(tabId, { type: 'toggle-original' });
      current.pageStatus = await requestPageStatus(tabId);
    } catch (error) {
      report(error, TOGGLE_ORIGINAL_FAILED_MESSAGE);
    }
    render();
  };

  const openOptions = async (): Promise<void> => {
    try {
      await browser.runtime.openOptionsPage();
    } catch (error) {
      report(error, OPEN_OPTIONS_FAILED_MESSAGE);
    }
  };

  const handlers: PopupHandlers = {
    onOpenOptions: () => void openOptions(),
    onRetry: () => {
      view.showError(null);
      void checkServer();
    },
    onSiteEnabledChange: (enabled) => {
      if (enabled) {
        // Must run inside the click: browsers only show the permission prompt for a user gesture.
        requestSitePermission();
      }
      changeCurrentSite((settings, host) => setSiteEnabled(settings, host, enabled));
    },
    onImagesChange: (images) => changeCurrentSite((settings, host) => updateSite(settings, host, { images })),
    onTextChange: (text) => changeCurrentSite((settings, host) => updateSite(settings, host, { text })),
    onSourceLanguageChange: (value) => {
      if (isSiteSourceLanguage(value)) {
        changeCurrentSite((settings, host) => updateSite(settings, host, { sourceLanguage: value }));
      }
    },
    onTargetLanguageChange: (value) => {
      if (isTargetLanguage(value)) {
        changeSettings((settings) => ({ ...settings, targetLanguage: value }));
      }
    },
    onToggleOriginal: () => void toggleOriginal(),
  };

  const view: PopupView = createPopupView(root, handlers);

  try {
    const [settings, lastConnectedAt, tab] = await Promise.all([
      loadSettings(),
      loadLastConnectedAt(),
      queryActiveTab(),
    ]);
    state = {
      settings,
      tabId: tab.id,
      tabUrl: tab.url,
      serverStatus: 'checking',
      previousServerStatus: null,
      lastConnectedAt,
      pageStatus: null,
    };
  } catch (error) {
    report(error, LOAD_FAILED_MESSAGE);
    return;
  }

  state.pageStatus = await loadPageStatus(state, report);
  await checkServer();
}

async function queryActiveTab(): Promise<ActiveTab> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return { id: tab?.id ?? null, url: tab?.url };
}

/** Asks the content script for the page progress; only translatable pages can have one. */
async function loadPageStatus(
  state: PopupState,
  report: (error: unknown, message: string) => void,
): Promise<PageStatus | null> {
  if (state.tabId === null || siteHostFromUrl(state.tabUrl) === null) {
    return null;
  }
  try {
    return await requestPageStatus(state.tabId);
  } catch (error) {
    report(error, PAGE_STATUS_FAILED_MESSAGE);
    return null;
  }
}
