import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { createImageCache, imageCacheKey, type ImageCache } from '@/utils/image-cache';
import type { TranslateImageRequest } from '@/utils/messages';
import { createDefaultSettings, saveSettings } from '@/utils/settings';
import {
  NO_IMAGE_RESULT_REASON,
  NO_SERVER_PERMISSION_REASON,
  SERVER_UNREACHABLE_REASON,
  TOKEN_REFUSED_REASON,
  clearPipelineVersions,
  readPipelineVersion,
  readResultImage,
  translateImage,
} from '@/utils/translation-client';

const IMAGE_URL = 'https://leitor.exemplo/pages/1.png';
const SERVER = 'http://127.0.0.1:8000';
const TOKEN = 'token-de-teste-123456';
const IMAGE_BYTES: Uint8Array<ArrayBuffer> = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
const REQUEST: TranslateImageRequest = { url: IMAGE_URL, sourceLanguage: 'en', targetLanguage: 'pt-BR', priority: 'visible' };
const RESULT_BODY = { pipeline_version: 'demo-1', results: [{ image_sha256: 'x', image_webp_base64: 'UklGRg==', regions: [] }], timings_ms: {} };

type Route = (init: RequestInit | undefined) => Response | Promise<Response>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** A fake fetch that answers by URL; unknown URLs fail the test. */
function routes(table: Record<string, Route>) {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    const route = table[url];
    if (route === undefined) {
      throw new Error(`Unexpected request to ${url}`);
    }
    return route(init);
  });
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const downloadImage: Route = () => new Response(IMAGE_BYTES, { headers: { 'Content-Type': 'image/png' } });

let cache: ImageCache;

/** Translates `REQUEST` with an empty in-memory browser cache (reset before each test). */
function translate(signal: AbortSignal, fetchFunction: typeof fetch) {
  return translateImage(REQUEST, signal, fetchFunction, cache);
}

beforeEach(async () => {
  fakeBrowser.reset();
  vi.restoreAllMocks();
  clearPipelineVersions();
  cache = createImageCache({ factory: new IDBFactory() });
  await saveSettings({ ...createDefaultSettings(), token: TOKEN });
});

describe('translateImage', () => {
  it('uploads the image when the server has not translated it yet', async () => {
    const fetchFunction = routes({
      [IMAGE_URL]: downloadImage,
      [`${SERVER}/v1/lookup`]: () => json({ error: { code: 'not-cached', message: '' } }, 404),
      [`${SERVER}/v1/translate`]: () => json(RESULT_BODY),
    });

    const result = await translate(new AbortController().signal, fetchFunction);

    expect(result).toEqual({ state: 'translated', imageDataUrl: 'data:image/webp;base64,UklGRg==' });
    const [, lookupInit] = fetchFunction.mock.calls[1] ?? [];
    expect(JSON.parse(String(lookupInit?.body))).toEqual({
      image_sha256s: [await sha256Hex(IMAGE_BYTES)],
      options: { source_lang: 'en', target_lang: 'pt-BR', reading_direction: 'ltr', output: 'image', priority: 'visible' },
    });
    const [, translateInit] = fetchFunction.mock.calls[2] ?? [];
    const form = translateInit?.body as FormData;
    expect(form.get('images')).toBeInstanceOf(Blob);
    expect(JSON.parse(String(form.get('options')))).toMatchObject({ source_lang: 'en', target_lang: 'pt-BR' });
    expect(translateInit?.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}` });
  });

  it('uses the cached result without uploading the image again', async () => {
    const fetchFunction = routes({ [IMAGE_URL]: downloadImage, [`${SERVER}/v1/lookup`]: () => json(RESULT_BODY) });

    const result = await translate(new AbortController().signal, fetchFunction);

    expect(result.state).toBe('translated');
    expect(fetchFunction).toHaveBeenCalledTimes(2);
  });

  it('explains every failure to the reader', async () => {
    const signal = new AbortController().signal;
    const lookupThen = (route: Route) => routes({ [IMAGE_URL]: downloadImage, [`${SERVER}/v1/lookup`]: route });

    await expect(translate(signal, lookupThen(() => json({}, 401)))).resolves.toEqual({
      state: 'error',
      reason: TOKEN_REFUSED_REASON,
    });
    const unreachable = lookupThen(() => {
      throw new TypeError('Failed to fetch');
    });
    await expect(translate(signal, unreachable)).resolves.toEqual({
      state: 'error',
      reason: SERVER_UNREACHABLE_REASON,
    });
    const tooLarge = lookupThen(() => json({ error: { code: 'image-too-large', message: 'A imagem passa de 20 MB.' } }, 413));
    await expect(translate(signal, tooLarge)).resolves.toEqual({
      state: 'error',
      reason: 'A imagem passa de 20 MB.',
    });
    await expect(translate(signal, lookupThen(() => json({ results: [] })))).resolves.toEqual({
      state: 'error',
      reason: NO_IMAGE_RESULT_REASON,
    });
    const missingImage = routes({ [IMAGE_URL]: () => new Response('', { status: 404 }) });
    await expect(translate(signal, missingImage)).resolves.toEqual({
      state: 'error',
      reason: 'Não foi possível baixar a imagem (HTTP 404).',
    });
  });

  it('needs the host permission of a server on the network', async () => {
    await saveSettings({ ...createDefaultSettings(), serverUrl: 'http://192.168.0.10:8000' });
    // The fake browser types this method with its callback overload, which returns void.
    vi.spyOn(fakeBrowser.permissions, 'contains').mockResolvedValue(false as never);
    const fetchFunction = routes({});

    await expect(translate(new AbortController().signal, fetchFunction)).resolves.toEqual({
      state: 'error',
      reason: NO_SERVER_PERMISSION_REASON,
    });
    expect(fetchFunction).not.toHaveBeenCalled();
  });

  it('stops when the page cancels the request', async () => {
    const controller = new AbortController();
    const fetchFunction = vi.fn<typeof fetch>(async () => {
      controller.abort();
      throw new DOMException('The operation was aborted.', 'AbortError');
    });

    await expect(translate(controller.signal, fetchFunction)).rejects.toThrow('aborted');
  });
});

describe('readResultImage', () => {
  it('reads the first image and rejects malformed bodies', () => {
    expect(readResultImage(RESULT_BODY)).toBe('UklGRg==');
    expect(readResultImage({ results: [{ image_sha256: 'x', image_webp_base64: null, regions: [] }] })).toBeNull();
    expect(readResultImage({ results: 'nope' })).toBeNull();
    expect(readResultImage(null)).toBeNull();
  });
});

describe('translateImage with the browser cache', () => {
  const signal = new AbortController().signal;
  const health = (version: string): Route => () => json({ status: 'ok', pipeline_version: version });
  const pageKey = async () => imageCacheKey(await sha256Hex(IMAGE_BYTES), 'en', 'pt-BR');

  it('keeps a new translation with the pipeline version that made it', async () => {
    const fetchFunction = routes({
      [IMAGE_URL]: downloadImage,
      [`${SERVER}/v1/lookup`]: () => json({}, 404),
      [`${SERVER}/v1/translate`]: () => json(RESULT_BODY),
    });

    await translate(signal, fetchFunction);

    expect(await cache.get(await pageKey())).toEqual({
      imageDataUrl: 'data:image/webp;base64,UklGRg==',
      pipelineVersion: 'demo-1',
    });
  });

  it('shows a cached page without asking the server to translate it again', async () => {
    await cache.put(await pageKey(), { imageDataUrl: 'data:image/webp;base64,CACHED', pipelineVersion: 'demo-1' });
    const fetchFunction = routes({ [IMAGE_URL]: downloadImage, [`${SERVER}/v1/health`]: health('demo-1') });

    const result = await translate(signal, fetchFunction);

    expect(result).toEqual({ state: 'translated', imageDataUrl: 'data:image/webp;base64,CACHED' });
    expect(fetchFunction.mock.calls.map(([url]) => String(url))).toEqual([IMAGE_URL, `${SERVER}/v1/health`]);
  });

  it('translates again when the server pipeline changed', async () => {
    await cache.put(await pageKey(), { imageDataUrl: 'data:image/webp;base64,OLD', pipelineVersion: 'demo-0' });
    const fetchFunction = routes({
      [IMAGE_URL]: downloadImage,
      [`${SERVER}/v1/health`]: health('demo-1'),
      [`${SERVER}/v1/lookup`]: () => json(RESULT_BODY),
    });

    const result = await translate(signal, fetchFunction);

    expect(result).toEqual({ state: 'translated', imageDataUrl: 'data:image/webp;base64,UklGRg==' });
    expect((await cache.get(await pageKey()))?.pipelineVersion).toBe('demo-1');
  });

  it('shows the cached page while the server is off', async () => {
    await cache.put(await pageKey(), { imageDataUrl: 'data:image/webp;base64,CACHED', pipelineVersion: 'demo-0' });
    const fetchFunction = routes({
      [IMAGE_URL]: downloadImage,
      [`${SERVER}/v1/health`]: () => {
        throw new TypeError('Failed to fetch');
      },
    });

    await expect(translate(signal, fetchFunction)).resolves.toEqual({
      state: 'translated',
      imageDataUrl: 'data:image/webp;base64,CACHED',
    });
  });

  it('still translates when the browser cache fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    cache = {
      get: async () => {
        throw new Error('quota exceeded');
      },
      put: async () => {
        throw new Error('quota exceeded');
      },
      stats: async () => ({ pages: 0, bytes: 0 }),
    };
    const fetchFunction = routes({ [IMAGE_URL]: downloadImage, [`${SERVER}/v1/lookup`]: () => json(RESULT_BODY) });

    await expect(translate(signal, fetchFunction)).resolves.toMatchObject({ state: 'translated' });
    expect(console.error).toHaveBeenCalledTimes(2);
  });

  it('reads the pipeline version of a body', () => {
    expect(readPipelineVersion(RESULT_BODY)).toBe('demo-1');
    expect(readPipelineVersion({})).toBeNull();
  });
});
