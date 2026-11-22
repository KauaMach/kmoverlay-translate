import { browser, type Browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { injectIntoOpenTabs, syncContentScriptRegistration } from '@/utils/content-script-registration';
import {
  TRANSLATE_PORT_NAME,
  isBackgroundRequest,
  isTranslateImageRequest,
  sendToContentScript,
  type TranslateImageResult,
} from '@/utils/messages';
import { checkConfiguredServer, type ServerStatus } from '@/utils/server-status';
import { getSite, setSiteEnabled, siteHostFromUrl, updateSettings, watchSettings } from '@/utils/settings';
import { translateImage } from '@/utils/translation-client';

/** Keyboard command that switches the page between the original and the translation. */
export const TOGGLE_ORIGINAL_COMMAND = 'toggle-original';
/** Keyboard command that turns the extension on or off for the current site. */
export const TOGGLE_SITE_COMMAND = 'toggle-site';
/** Same as `--color-accent`; the badge API takes a color value, not CSS. */
const BADGE_COLOR = '#c2410c';

/** Patterns where the content script runs, to find the sites that were just turned on. */
let activePatterns = new Set<string>();
/** Registration changes run one after the other, so two quick changes never register twice. */
let registrationQueue: Promise<void> = Promise.resolve();

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (!isBackgroundRequest(message)) {
      return undefined;
    }
    if (message.type === 'queue-changed') {
      updateQueueBadge(sender.tab?.id, message.pending).catch(reportFailure('update the badge'));
      return undefined;
    }
    checkConfiguredServer().then(sendResponse, (error: unknown) => {
      const failure: ServerStatus = { state: 'error', reason: describeError(error) };
      sendResponse(failure);
    });
    // Chrome keeps the response channel open only when the listener returns true.
    return true;
  });

  browser.runtime.onConnect.addListener(handleTranslationPort);

  browser.commands.onCommand.addListener((command: string, tab?: Browser.tabs.Tab) => {
    handleCommand(command, tab).catch(reportFailure(`run the command "${command}"`));
  });

  // The content script follows the sites turned on (popup, shortcut, options) and the granted permissions.
  watchSettings(() => refreshContentScripts(true));
  browser.permissions.onAdded.addListener(() => refreshContentScripts(true));
  browser.permissions.onRemoved.addListener(() => refreshContentScripts(false));
  // On start-up the open pages already have the script (or were opened before the site was turned on).
  refreshContentScripts(false);
});

/**
 * Brings the content script registration up to date and, when asked, starts it
 * in the open tabs of sites that were just turned on.
 */
function refreshContentScripts(injectIntoNewSites: boolean): void {
  registrationQueue = registrationQueue
    .then(async () => {
      const matches = await syncContentScriptRegistration();
      const added = matches.filter((pattern) => !activePatterns.has(pattern));
      activePatterns = new Set(matches);
      if (injectIntoNewSites) {
        await injectIntoOpenTabs(added);
      }
    })
    .catch(reportFailure('update the content script registration'));
}

/** Translates the image a content script asks for; closing the port cancels the work. */
function handleTranslationPort(port: Browser.runtime.Port): void {
  if (port.name !== TRANSLATE_PORT_NAME) {
    return;
  }
  const controller = new AbortController();
  port.onDisconnect.addListener(() => controller.abort());
  port.onMessage.addListener((message: unknown) => {
    if (!isTranslateImageRequest(message)) {
      port.disconnect();
      return;
    }
    translateImage(message, controller.signal).then(
      (result) => answerPort(port, controller.signal, result),
      (error: unknown) => {
        if (controller.signal.aborted) {
          // The page cancelled the request (image removed, site turned off): nobody waits for it.
          return;
        }
        console.error('KMOverlay: image translation failed.', error);
        answerPort(port, controller.signal, { state: 'error', reason: describeError(error) });
      },
    );
  });
}

function answerPort(port: Browser.runtime.Port, signal: AbortSignal, result: TranslateImageResult): void {
  if (signal.aborted) {
    return;
  }
  port.postMessage(result);
  port.disconnect();
}

async function updateQueueBadge(tabId: number | undefined, pending: number): Promise<void> {
  if (tabId === undefined) {
    return;
  }
  await browser.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLOR });
  await browser.action.setBadgeText({ tabId, text: pending > 0 ? String(pending) : '' });
}

function reportFailure(action: string): (error: unknown) => void {
  return (error) => {
    console.error(`KMOverlay: could not ${action}.`, error);
  };
}

/**
 * Runs a keyboard command on the tab it was pressed in. Older browsers do not
 * pass the tab, so the active tab of the focused window is used instead.
 */
export async function handleCommand(command: string, tab: Browser.tabs.Tab | undefined): Promise<void> {
  const activeTab = tab ?? (await findActiveTab());
  if (activeTab === undefined) {
    return;
  }
  if (command === TOGGLE_SITE_COMMAND) {
    await toggleSite(activeTab.url);
  } else if (command === TOGGLE_ORIGINAL_COMMAND && activeTab.id !== undefined) {
    await sendToContentScript(activeTab.id, { type: 'toggle-original' });
  }
}

async function findActiveTab(): Promise<Browser.tabs.Tab | undefined> {
  // A service worker has no window of its own, so "current window" is not meaningful here.
  const [activeTab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  return activeTab;
}

/** Browser pages (`chrome://`, `about:`…) have no site to toggle and are ignored. */
async function toggleSite(url: string | undefined): Promise<void> {
  const host = siteHostFromUrl(url);
  if (host === null) {
    return;
  }
  await updateSettings((settings) => setSiteEnabled(settings, host, !(getSite(settings, host)?.enabled ?? false)));
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
