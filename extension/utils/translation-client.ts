import { browser } from 'wxt/browser';
import type { TranslateImageRequest, TranslateImageResult } from './messages';
import { isLocalServer, serverPermissionPattern } from './server-status';
import { loadSettings, type Settings } from './settings';

const LOOKUP_PATH = '/v1/lookup';
const TRANSLATE_PATH = '/v1/translate';
const HTTP_NOT_FOUND = 404;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const DEFAULT_IMAGE_TYPE = 'application/octet-stream';
const RESULT_DATA_URL_PREFIX = 'data:image/webp;base64,';

export const SERVER_UNREACHABLE_REASON = 'Servidor não encontrado.';
export const TOKEN_REFUSED_REASON = 'Token recusado pelo servidor.';
export const NO_SERVER_PERMISSION_REASON = 'Sem permissão para acessar o servidor; teste a conexão nas opções.';
export const INVALID_SERVER_RESPONSE_REASON = 'Resposta inválida do servidor.';
export const NO_IMAGE_RESULT_REASON = 'O servidor não devolveu a imagem traduzida.';

/** Options sent to the server, in the format of the API contract. */
interface ServerTranslateOptions {
  source_lang: string;
  target_lang: string;
  reading_direction: 'ltr';
  output: 'image';
  priority: 'visible' | 'prefetch';
}

/**
 * Translates one image of a page: downloads it (the background script is not
 * limited by CORS), asks the server cache first and only uploads it when the
 * server has not translated it yet. Failures become an `error` result with a
 * message for the reader; `signal` aborts every request.
 */
export async function translateImage(
  request: TranslateImageRequest,
  signal: AbortSignal,
  fetchFunction: typeof fetch = fetch,
): Promise<TranslateImageResult> {
  const settings = await loadSettings();
  if (!(await canReachServer(settings.serverUrl))) {
    return { state: 'error', reason: NO_SERVER_PERMISSION_REASON };
  }
  const image = await downloadImage(request.url, signal, fetchFunction);
  if (image.state === 'error') {
    return image;
  }
  const options = toServerOptions(request);
  const imageSha256 = await sha256Hex(image.bytes);
  const cached = await callServer(
    settings,
    LOOKUP_PATH,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image_sha256s: [imageSha256], options }) },
    signal,
    fetchFunction,
  );
  if (cached.state !== 'not-found') {
    return toTranslateResult(cached);
  }
  const form = new FormData();
  form.append('images', new Blob([image.bytes], { type: image.type }), 'image');
  form.append('options', JSON.stringify(options));
  return toTranslateResult(
    await callServer(settings, TRANSLATE_PATH, { method: 'POST', body: form }, signal, fetchFunction),
  );
}

/** Extracts the translated image from a `/v1/translate` or `/v1/lookup` body, or `null` when it is malformed. */
export function readResultImage(body: unknown): string | null {
  if (!isRecord(body) || !Array.isArray(body.results)) {
    return null;
  }
  const [first] = body.results as unknown[];
  if (!isRecord(first) || typeof first.image_sha256 !== 'string' || !Array.isArray(first.regions)) {
    return null;
  }
  return typeof first.image_webp_base64 === 'string' ? first.image_webp_base64 : null;
}

type DownloadResult = { state: 'downloaded'; bytes: ArrayBuffer; type: string } | { state: 'error'; reason: string };

type ServerCall = { state: 'ok'; body: unknown } | { state: 'not-found' } | { state: 'error'; reason: string };

async function canReachServer(serverUrl: string): Promise<boolean> {
  if (isLocalServer(serverUrl)) {
    return true;
  }
  return browser.permissions.contains({ origins: [serverPermissionPattern(serverUrl)] });
}

async function downloadImage(url: string, signal: AbortSignal, fetchFunction: typeof fetch): Promise<DownloadResult> {
  let response: Response;
  try {
    // Cookies go along, as when the page itself loads the image (logged-in readers).
    response = await fetchFunction(url, { credentials: 'include', signal });
  } catch (error) {
    if (isNetworkError(error)) {
      return { state: 'error', reason: 'Não foi possível baixar a imagem.' };
    }
    throw error;
  }
  if (!response.ok) {
    return { state: 'error', reason: `Não foi possível baixar a imagem (HTTP ${response.status}).` };
  }
  return {
    state: 'downloaded',
    bytes: await response.arrayBuffer(),
    type: response.headers.get('Content-Type') ?? DEFAULT_IMAGE_TYPE,
  };
}

async function callServer(
  settings: Settings,
  path: string,
  init: RequestInit,
  signal: AbortSignal,
  fetchFunction: typeof fetch,
): Promise<ServerCall> {
  let response: Response;
  try {
    response = await fetchFunction(`${settings.serverUrl}${path}`, {
      ...init,
      headers: { ...init.headers, ...(settings.token === '' ? {} : { Authorization: `Bearer ${settings.token}` }) },
      signal,
    });
  } catch (error) {
    if (isNetworkError(error)) {
      return { state: 'error', reason: SERVER_UNREACHABLE_REASON };
    }
    throw error;
  }
  if (response.status === HTTP_NOT_FOUND && path === LOOKUP_PATH) {
    return { state: 'not-found' };
  }
  if (response.status === HTTP_UNAUTHORIZED || response.status === HTTP_FORBIDDEN) {
    return { state: 'error', reason: TOKEN_REFUSED_REASON };
  }
  const body = await readJson(response);
  if (!response.ok) {
    return { state: 'error', reason: readErrorMessage(body) ?? `O servidor respondeu com erro (HTTP ${response.status}).` };
  }
  return { state: 'ok', body };
}

function toTranslateResult(call: ServerCall): TranslateImageResult {
  if (call.state === 'error') {
    return call;
  }
  if (call.state === 'not-found') {
    return { state: 'error', reason: INVALID_SERVER_RESPONSE_REASON };
  }
  const image = readResultImage(call.body);
  if (image === null) {
    return { state: 'error', reason: NO_IMAGE_RESULT_REASON };
  }
  return { state: 'translated', imageDataUrl: `${RESULT_DATA_URL_PREFIX}${image}` };
}

function toServerOptions(request: TranslateImageRequest): ServerTranslateOptions {
  return {
    source_lang: request.sourceLanguage,
    target_lang: request.targetLanguage,
    reading_direction: 'ltr',
    output: 'image',
    priority: request.priority,
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

/** Message of the contract error format `{ error: { code, message } }`, if present. */
function readErrorMessage(body: unknown): string | null {
  if (isRecord(body) && isRecord(body.error) && typeof body.error.message === 'string') {
    return body.error.message;
  }
  return null;
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** `fetch` rejects with a TypeError when the network fails; aborts are rethrown so callers can stop. */
function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
