import { browser } from 'wxt/browser';
import { loadSettings } from './settings';

export { normalizeServerUrl } from './internal/server-url';

/** Result of checking the translation server. */
export type ServerStatus =
  | { state: 'online'; gpuName: string | null; modelsLoaded: boolean }
  | { state: 'unauthorized' }
  | { state: 'no-permission' }
  | { state: 'offline' }
  | { state: 'error'; reason: string };

export const HEALTH_TIMEOUT_MS = 3000;
const HEALTH_PATH = '/v1/health';
const LAST_CONNECTED_STORAGE_KEY = 'lastConnectedAt';
// Must match `host_permissions` in `wxt.config.ts`: only these are reachable without asking.
const LOCAL_SERVER_PROTOCOL = 'http:';
const LOCAL_HOSTNAMES = new Set(['127.0.0.1', 'localhost']);
const TRAILING_SLASHES = /\/+$/;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const INVALID_RESPONSE_REASON = 'resposta inválida';
const UNREACHABLE_ERROR_NAMES = new Set(['TimeoutError', 'AbortError']);

/**
 * True for servers on this computer that the manifest always allows
 * (`http://127.0.0.1` and `http://localhost`, any port). Other local addresses,
 * such as `https://localhost` or `http://[::1]`, still need a host permission.
 * @throws {TypeError} when `serverUrl` is not a valid URL (use {@link normalizeServerUrl} first).
 */
export function isLocalServer(serverUrl: string): boolean {
  const { protocol, hostname } = new URL(serverUrl);
  return protocol === LOCAL_SERVER_PROTOCOL && LOCAL_HOSTNAMES.has(hostname);
}

/**
 * Host permission needed to reach a server that is not local. Match patterns
 * without a port cover every port.
 * @throws {TypeError} when `serverUrl` is not a valid URL.
 */
export function serverPermissionPattern(serverUrl: string): string {
  const { protocol, hostname } = new URL(serverUrl);
  return `${protocol}//${hostname}/*`;
}

/**
 * "host:port" shown in the interface (e.g. "127.0.0.1:8000").
 * @throws {TypeError} when `serverUrl` is not a valid URL.
 */
export function serverAddressLabel(serverUrl: string): string {
  return new URL(serverUrl).host;
}

/**
 * Calls `GET /v1/health` and maps the answer to a {@link ServerStatus}.
 * Network failures and timeouts resolve to `offline`; unexpected errors are rethrown.
 */
export async function fetchServerStatus(
  serverUrl: string,
  token: string,
  fetchFunction: typeof fetch = fetch,
): Promise<ServerStatus> {
  let response: Response;
  try {
    response = await fetchFunction(`${serverUrl.replace(TRAILING_SLASHES, '')}${HEALTH_PATH}`, {
      headers: token === '' ? {} : { Authorization: `Bearer ${token}` },
      // A cached answer would report a server that is no longer running.
      cache: 'no-store',
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
  } catch (error) {
    if (isUnreachableError(error)) {
      return { state: 'offline' };
    }
    throw error;
  }
  if (response.status === HTTP_UNAUTHORIZED || response.status === HTTP_FORBIDDEN) {
    return { state: 'unauthorized' };
  }
  if (!response.ok) {
    return { state: 'error', reason: `HTTP ${response.status}` };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      return { state: 'error', reason: INVALID_RESPONSE_REASON };
    }
    // The timeout keeps running while the body downloads, and the connection can drop there too.
    if (isUnreachableError(error)) {
      return { state: 'offline' };
    }
    throw error;
  }
  return parseHealthBody(body);
}

/**
 * Checks the server configured in the settings and records when it last
 * answered. Servers that are not local need a host permission first, granted
 * from the options page.
 * @param now Clock used for the "last connected" timestamp (injected in tests).
 */
export async function checkConfiguredServer(now: () => number = Date.now): Promise<ServerStatus> {
  const settings = await loadSettings();
  if (!isLocalServer(settings.serverUrl)) {
    const granted = await browser.permissions.contains({
      origins: [serverPermissionPattern(settings.serverUrl)],
    });
    if (!granted) {
      return { state: 'no-permission' };
    }
  }
  const status = await fetchServerStatus(settings.serverUrl, settings.token);
  if (status.state === 'online') {
    await browser.storage.local.set({ [LAST_CONNECTED_STORAGE_KEY]: now() });
  }
  return status;
}

/** When the server last answered, as a timestamp in milliseconds, or `null` if never. */
export async function loadLastConnectedAt(): Promise<number | null> {
  const stored = await browser.storage.local.get(LAST_CONNECTED_STORAGE_KEY);
  const value = stored[LAST_CONNECTED_STORAGE_KEY];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Type guard for statuses that crossed a message boundary, including the fields of each state. */
export function isServerStatus(value: unknown): value is ServerStatus {
  if (!isRecord(value)) {
    return false;
  }
  switch (value.state) {
    case 'online':
      return typeof value.modelsLoaded === 'boolean' && isGpuName(value.gpuName);
    case 'error':
      return typeof value.reason === 'string';
    case 'unauthorized':
    case 'no-permission':
    case 'offline':
      return true;
    default:
      return false;
  }
}

function parseHealthBody(body: unknown): ServerStatus {
  if (!isRecord(body)) {
    return { state: 'error', reason: INVALID_RESPONSE_REASON };
  }
  const gpuName = body.gpu_name;
  const modelsLoaded = body.models_loaded;
  if (body.status !== 'ok' || typeof modelsLoaded !== 'boolean' || !isGpuName(gpuName)) {
    return { state: 'error', reason: INVALID_RESPONSE_REASON };
  }
  return { state: 'online', gpuName, modelsLoaded };
}

function isGpuName(value: unknown): value is string | null {
  return typeof value === 'string' || value === null;
}

/**
 * Network failures and timeouts mean the server is not running or not reachable.
 * Timeouts are recognized by name because the DOMException may come from another realm.
 */
function isUnreachableError(error: unknown): boolean {
  if (error instanceof TypeError) {
    return true;
  }
  return isRecord(error) && typeof error.name === 'string' && UNREACHABLE_ERROR_NAMES.has(error.name);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
