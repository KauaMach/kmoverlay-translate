import { browser, type Browser } from 'wxt/browser';
import { normalizeServerUrl } from './internal/server-url';
import {
  isSiteSourceLanguage,
  isSourceLanguage,
  isTargetLanguage,
  type SiteSourceLanguage,
  type SourceLanguage,
  type TargetLanguage,
} from './languages';

/** Preferences for one site. A site is listed in the options page while `enabled` is true. */
export interface SiteSettings {
  enabled: boolean;
  images: boolean;
  text: boolean;
  sourceLanguage: SiteSourceLanguage;
}

/** Everything the user configures, stored in `storage.local` (never synced, it holds the token). */
export interface Settings {
  serverUrl: string;
  token: string;
  targetLanguage: TargetLanguage;
  defaultSourceLanguage: SourceLanguage;
  /** Keyed by hostname, e.g. `leitor.exemplo`. */
  sites: Record<string, SiteSettings>;
  translateOnomatopoeia: boolean;
  usePreviousPageContext: boolean;
  shrinkOverflowingText: boolean;
}

export const DEFAULT_SERVER_URL = 'http://127.0.0.1:8000';
const SETTINGS_STORAGE_KEY = 'settings';
const TRANSLATABLE_PROTOCOLS = new Set(['http:', 'https:']);

/** Tail of the queue that serializes {@link updateSettings} calls. */
let pendingUpdate: Promise<void> = Promise.resolve();

/** Returns a fresh copy of the default settings. */
export function createDefaultSettings(): Settings {
  return {
    serverUrl: DEFAULT_SERVER_URL,
    token: '',
    targetLanguage: 'pt-BR',
    defaultSourceLanguage: 'en',
    sites: {},
    translateOnomatopoeia: false,
    usePreviousPageContext: true,
    shrinkOverflowingText: true,
  };
}

/**
 * Builds valid settings from stored data. Storage is external input (older
 * versions, manual edits), so every field is checked and falls back to its default.
 */
export function normalizeSettings(raw: unknown): Settings {
  const defaults = createDefaultSettings();
  if (!isRecord(raw)) {
    return defaults;
  }
  return {
    serverUrl: readServerUrl(raw.serverUrl, defaults.serverUrl),
    token: typeof raw.token === 'string' ? raw.token : defaults.token,
    targetLanguage: isTargetLanguage(raw.targetLanguage) ? raw.targetLanguage : defaults.targetLanguage,
    defaultSourceLanguage: isSourceLanguage(raw.defaultSourceLanguage)
      ? raw.defaultSourceLanguage
      : defaults.defaultSourceLanguage,
    sites: normalizeSites(raw.sites, defaults.defaultSourceLanguage),
    translateOnomatopoeia: readBoolean(raw.translateOnomatopoeia, defaults.translateOnomatopoeia),
    usePreviousPageContext: readBoolean(raw.usePreviousPageContext, defaults.usePreviousPageContext),
    shrinkOverflowingText: readBoolean(raw.shrinkOverflowingText, defaults.shrinkOverflowingText),
  };
}

/** Reads the settings from `storage.local`. */
export async function loadSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get(SETTINGS_STORAGE_KEY);
  return normalizeSettings(stored[SETTINGS_STORAGE_KEY]);
}

/** Writes the settings to `storage.local`. */
export async function saveSettings(settings: Settings): Promise<void> {
  await browser.storage.local.set({ [SETTINGS_STORAGE_KEY]: settings });
}

/**
 * Applies a pure change to the stored settings and returns what was saved.
 * Updates made in the same context run one after the other, so two quick
 * changes (e.g. the shortcut pressed twice) never read the same old value.
 */
export function updateSettings(change: (current: Settings) => Settings): Promise<Settings> {
  const update = pendingUpdate.then(async () => {
    const next = change(await loadSettings());
    await saveSettings(next);
    return next;
  });
  // The caller still receives the failure through `update`; the queue only
  // needs to know it finished, so a failed update does not block the next ones.
  pendingUpdate = update.then(
    () => undefined,
    () => undefined,
  );
  return update;
}

/**
 * Calls `listener` whenever the stored settings change (popup, options page,
 * keyboard shortcut), so open pages can show the new values.
 * @returns A function that stops listening.
 */
export function watchSettings(listener: (settings: Settings) => void): () => void {
  const handleChange = (changes: Record<string, Browser.storage.StorageChange>, areaName: string): void => {
    if (areaName === 'local' && Object.hasOwn(changes, SETTINGS_STORAGE_KEY)) {
      listener(normalizeSettings(changes[SETTINGS_STORAGE_KEY]?.newValue));
    }
  };
  browser.storage.onChanged.addListener(handleChange);
  return () => browser.storage.onChanged.removeListener(handleChange);
}

/** Hostname used as the site key, or `null` for pages that cannot be translated (`chrome://`, `about:`…). */
export function siteHostFromUrl(url: string | undefined): string | null {
  if (!url) {
    return null;
  }
  try {
    const parsed = new URL(url);
    return TRANSLATABLE_PROTOCOLS.has(parsed.protocol) && parsed.hostname !== '' ? parsed.hostname : null;
  } catch (error) {
    if (error instanceof TypeError) {
      return null;
    }
    throw error;
  }
}

/** Preferences of a site, or `undefined` if it was never configured. */
export function getSite(settings: Settings, host: string): SiteSettings | undefined {
  // Hostnames such as "constructor" are valid, so inherited properties must not count as sites.
  return Object.hasOwn(settings.sites, host) ? settings.sites[host] : undefined;
}

/** Preferences a site gets the first time it is turned on: images on, text off (privacy default). */
export function createSiteSettings(settings: Settings): SiteSettings {
  return { enabled: true, images: true, text: false, sourceLanguage: settings.defaultSourceLanguage };
}

/** Turns a site on or off, keeping its other preferences for the next time. */
export function setSiteEnabled(settings: Settings, host: string, enabled: boolean): Settings {
  const current = getSite(settings, host) ?? createSiteSettings(settings);
  return withSite(settings, host, { ...current, enabled });
}

/** Changes preferences of a site, creating it (turned off) if it does not exist yet. */
export function updateSite(
  settings: Settings,
  host: string,
  change: Partial<Omit<SiteSettings, 'enabled'>>,
): Settings {
  const current = getSite(settings, host) ?? { ...createSiteSettings(settings), enabled: false };
  return withSite(settings, host, { ...current, ...change });
}

/** Forgets every preference of a site. */
export function removeSite(settings: Settings, host: string): Settings {
  const sites = { ...settings.sites };
  delete sites[host];
  return { ...settings, sites };
}

/** Sites turned on, sorted by hostname, as shown in the options page. */
export function listEnabledSites(settings: Settings): Array<[string, SiteSettings]> {
  return Object.entries(settings.sites)
    .filter(([, site]) => site.enabled)
    .sort(([hostA], [hostB]) => hostA.localeCompare(hostB));
}

/** Source language for a site: its own choice, or the global default. */
export function resolveSourceLanguage(settings: Settings, host: string): SiteSourceLanguage {
  return getSite(settings, host)?.sourceLanguage ?? settings.defaultSourceLanguage;
}

function withSite(settings: Settings, host: string, site: SiteSettings): Settings {
  return { ...settings, sites: { ...settings.sites, [host]: site } };
}

function normalizeSites(raw: unknown, defaultSourceLanguage: SourceLanguage): Record<string, SiteSettings> {
  if (!isRecord(raw)) {
    return {};
  }
  const sites: Array<[string, SiteSettings]> = [];
  for (const [host, value] of Object.entries(raw)) {
    if (host === '' || !isRecord(value)) {
      continue;
    }
    sites.push([
      host,
      {
        enabled: readBoolean(value.enabled, false),
        images: readBoolean(value.images, true),
        text: readBoolean(value.text, false),
        sourceLanguage: isSiteSourceLanguage(value.sourceLanguage) ? value.sourceLanguage : defaultSourceLanguage,
      },
    ]);
  }
  // `fromEntries` defines own properties: assigning a "__proto__" host would replace the prototype instead.
  return Object.fromEntries(sites);
}

function readServerUrl(value: unknown, fallback: string): string {
  return typeof value === 'string' ? (normalizeServerUrl(value) ?? fallback) : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
