import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { TranslateImageRequest } from '@/utils/messages';
import { createDefaultSettings, saveSettings } from '@/utils/settings';
import {
  NO_IMAGE_RESULT_REASON,
  NO_SERVER_PERMISSION_REASON,
  SERVER_UNREACHABLE_REASON,
  TOKEN_REFUSED_REASON,
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

beforeEach(async () => {
  fakeBrowser.reset();
  vi.restoreAllMocks();
  await saveSettings({ ...createDefaultSettings(), token: TOKEN });
});

describe('translateImage', () => {
  it('uploads the image when the server has not translated it yet', async () => {
    const fetchFunction = routes({
      [IMAGE_URL]: downloadImage,
      [`${SERVER}/v1/lookup`]: () => json({ error: { code: 'not-cached', message: '' } }, 404),
      [`${SERVER}/v1/translate`]: () => json(RESULT_BODY),
    });

    const result = await translateImage(REQUEST, new AbortController().signal, fetchFunction);

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

    const result = await translateImage(REQUEST, new AbortController().signal, fetchFunction);

    expect(result.state).toBe('translated');
    expect(fetchFunction).toHaveBeenCalledTimes(2);
  });

  it('explains every failure to the reader', async () => {
    const signal = new AbortController().signal;
    const lookupThen = (route: Route) => routes({ [IMAGE_URL]: downloadImage, [`${SERVER}/v1/lookup`]: route });

    await expect(translateImage(REQUEST, signal, lookupThen(() => json({}, 401)))).resolves.toEqual({
      state: 'error',
      reason: TOKEN_REFUSED_REASON,
    });
    const unreachable = lookupThen(() => {
      throw new TypeError('Failed to fetch');
    });
    await expect(translateImage(REQUEST, signal, unreachable)).resolves.toEqual({
      state: 'error',
      reason: SERVER_UNREACHABLE_REASON,
    });
    const tooLarge = lookupThen(() => json({ error: { code: 'image-too-large', message: 'A imagem passa de 20 MB.' } }, 413));
    await expect(translateImage(REQUEST, signal, tooLarge)).resolves.toEqual({
      state: 'error',
      reason: 'A imagem passa de 20 MB.',
    });
    await expect(translateImage(REQUEST, signal, lookupThen(() => json({ results: [] })))).resolves.toEqual({
      state: 'error',
      reason: NO_IMAGE_RESULT_REASON,
    });
    const missingImage = routes({ [IMAGE_URL]: () => new Response('', { status: 404 }) });
    await expect(translateImage(REQUEST, signal, missingImage)).resolves.toEqual({
      state: 'error',
      reason: 'Não foi possível baixar a imagem (HTTP 404).',
    });
  });

  it('needs the host permission of a server on the network', async () => {
    await saveSettings({ ...createDefaultSettings(), serverUrl: 'http://192.168.0.10:8000' });
    // The fake browser types this method with its callback overload, which returns void.
    vi.spyOn(fakeBrowser.permissions, 'contains').mockResolvedValue(false as never);
    const fetchFunction = routes({});

    await expect(translateImage(REQUEST, new AbortController().signal, fetchFunction)).resolves.toEqual({
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

    await expect(translateImage(REQUEST, controller.signal, fetchFunction)).rejects.toThrow('aborted');
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
