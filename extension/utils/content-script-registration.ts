import { browser } from 'wxt/browser';
import { listEnabledSites, loadSettings, type Settings } from './settings';

/** Id of the dynamically registered content script. */
export const CONTENT_SCRIPT_ID = 'kmoverlay-page-translator';
/** Output path of `entrypoints/content/index.ts` in the build. */
export const CONTENT_SCRIPT_FILE = '/content-scripts/content.js';

const SITE_PROTOCOLS = ['http', 'https'] as const;
/** Grants that cover every site, e.g. after the user allows "all sites" in the browser. */
const ALL_SITES_PATTERNS = new Set(['<all_urls>', '*://*/*']);

/** Match patterns of a site (both protocols), as used by permissions and content scripts. */
export function sitePatterns(host: string): string[] {
  return SITE_PROTOCOLS.map((protocol) => `${protocol}://${host}/*`);
}

/** Host permission the popup asks for when a site is turned on from a page at `url`. */
export function sitePermissionPattern(url: string): string {
  const { protocol, hostname } = new URL(url);
  return `${protocol}//${hostname}/*`;
}

/**
 * Patterns where the content script must run: sites turned on whose host
 * permission is granted. Without the permission the script could not see the
 * images anyway, so those sites are left out until it is granted.
 */
export function desiredMatches(settings: Settings, grantedOrigins: readonly string[]): string[] {
  const granted = new Set(grantedOrigins);
  const coversEverything = grantedOrigins.some((origin) => ALL_SITES_PATTERNS.has(origin));
  return listEnabledSites(settings).flatMap(([host]) =>
    sitePatterns(host).filter((pattern) => coversEverything || granted.has(pattern) || granted.has(protocolWildcard(pattern))),
  );
}

/** Registers, updates or removes the content script so it matches the enabled sites. */
export async function syncContentScriptRegistration(): Promise<string[]> {
  const [settings, permissions] = await Promise.all([loadSettings(), browser.permissions.getAll()]);
  const matches = desiredMatches(settings, permissions.origins ?? []);
  const registered = await browser.scripting.getRegisteredContentScripts({ ids: [CONTENT_SCRIPT_ID] });
  if (matches.length === 0) {
    if (registered.length > 0) {
      await browser.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] });
    }
    return matches;
  }
  const script = { id: CONTENT_SCRIPT_ID, js: [CONTENT_SCRIPT_FILE], matches, runAt: 'document_idle' as const };
  if (registered.length > 0) {
    await browser.scripting.updateContentScripts([script]);
  } else {
    await browser.scripting.registerContentScripts([script]);
  }
  return matches;
}

/**
 * Runs the content script in tabs already open on a site that was just turned
 * on, so the reader does not have to reload the page. The script ignores a
 * second injection in the same page.
 */
export async function injectIntoOpenTabs(patterns: readonly string[]): Promise<void> {
  if (patterns.length === 0) {
    return;
  }
  const tabs = await browser.tabs.query({ url: [...patterns] });
  await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id === undefined) {
        return;
      }
      try {
        await browser.scripting.executeScript({ target: { tabId: tab.id }, files: [CONTENT_SCRIPT_FILE] });
      } catch (error) {
        // A tab can close or navigate away while this runs; the others still get the script.
        console.error(`KMOverlay: could not start in tab ${tab.id}.`, error);
      }
    }),
  );
}

/** `http://host/*` is also covered by a `*://host/*` grant. */
function protocolWildcard(pattern: string): string {
  return pattern.replace(/^https?:/, '*:');
}
