import { browser, type Browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { isBackgroundRequest, sendToContentScript } from '@/utils/messages';
import { checkConfiguredServer, type ServerStatus } from '@/utils/server-status';
import { getSite, setSiteEnabled, siteHostFromUrl, updateSettings } from '@/utils/settings';

/** Keyboard command that switches the page between the original and the translation. */
export const TOGGLE_ORIGINAL_COMMAND = 'toggle-original';
/** Keyboard command that turns the extension on or off for the current site. */
export const TOGGLE_SITE_COMMAND = 'toggle-site';

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isBackgroundRequest(message)) {
      return undefined;
    }
    checkConfiguredServer().then(sendResponse, (error: unknown) => {
      const failure: ServerStatus = { state: 'error', reason: describeError(error) };
      sendResponse(failure);
    });
    // Chrome keeps the response channel open only when the listener returns true.
    return true;
  });

  browser.commands.onCommand.addListener((command: string, tab?: Browser.tabs.Tab) => {
    handleCommand(command, tab).catch((error: unknown) => {
      console.error(`KMOverlay: command "${command}" failed:`, error);
    });
  });
});

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
