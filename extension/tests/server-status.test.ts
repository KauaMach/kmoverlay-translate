import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  checkConfiguredServer,
  fetchServerStatus,
  isLocalServer,
  isServerStatus,
  loadLastConnectedAt,
  normalizeServerUrl,
  serverAddressLabel,
  serverPermissionPattern,
} from '@/utils/server-status';
import { createDefaultSettings, saveSettings } from '@/utils/settings';

const LOCAL_URL = 'http://127.0.0.1:8000';
const NETWORK_URL = 'http://192.168.0.10:8000';
const HEALTHY_BODY = { status: 'ok', gpu_name: 'RTX 3050', models_loaded: true };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function fakeFetch(result: Response | Error) {
  return vi.fn<typeof fetch>(async () => {
    if (result instanceof Error) {
      throw result;
    }
    return result;
  });
}

beforeEach(() => {
  fakeBrowser.reset();
  vi.restoreAllMocks();
});

describe('normalizeServerUrl', () => {
  it.each([
    ['http://127.0.0.1:8000', 'http://127.0.0.1:8000'],
    ['  http://192.168.0.10:8000/  ', 'http://192.168.0.10:8000'],
    ['https://pc.tailnet.ts.net/', 'https://pc.tailnet.ts.net'],
    ['http://pc.local:8000/kmoverlay//', 'http://pc.local:8000/kmoverlay'],
  ])('accepts %j as %j', (value, expected) => {
    expect(normalizeServerUrl(value)).toBe(expected);
  });

  it.each(['', '127.0.0.1:8000', 'ftp://192.168.0.10', 'not a url', 'http://user:secret@192.168.0.10'])(
    'rejects %j',
    (value) => {
      expect(normalizeServerUrl(value)).toBeNull();
    },
  );
});

describe('server address helpers', () => {
  it('treats only the addresses allowed by the manifest as local', () => {
    expect(isLocalServer('http://127.0.0.1:8000')).toBe(true);
    expect(isLocalServer('http://localhost:9000')).toBe(true);
    expect(isLocalServer('https://localhost')).toBe(false);
    expect(isLocalServer(NETWORK_URL)).toBe(false);
  });

  it('builds the host permission pattern and the label', () => {
    expect(serverPermissionPattern(NETWORK_URL)).toBe('http://192.168.0.10/*');
    expect(serverAddressLabel(LOCAL_URL)).toBe('127.0.0.1:8000');
  });
});

describe('fetchServerStatus', () => {
  it('reports an online server with its GPU', async () => {
    const fetchFunction = fakeFetch(jsonResponse(HEALTHY_BODY));

    await expect(fetchServerStatus(LOCAL_URL, 'segredo', fetchFunction)).resolves.toEqual({
      state: 'online',
      gpuName: 'RTX 3050',
      modelsLoaded: true,
    });

    const [url, init] = fetchFunction.mock.lastCall as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:8000/v1/health');
    expect(init.headers).toEqual({ Authorization: 'Bearer segredo' });
    expect(init.cache).toBe('no-store');
  });

  it('accepts a server without GPU and sends no Authorization header without a token', async () => {
    const fetchFunction = fakeFetch(jsonResponse({ ...HEALTHY_BODY, gpu_name: null, models_loaded: false }));

    await expect(fetchServerStatus(LOCAL_URL, '', fetchFunction)).resolves.toEqual({
      state: 'online',
      gpuName: null,
      modelsLoaded: false,
    });
    const [, init] = fetchFunction.mock.lastCall as [string, RequestInit];
    expect(init.headers).toEqual({});
  });

  it.each([401, 403])('reports a refused token for HTTP %i', async (status) => {
    await expect(fetchServerStatus(LOCAL_URL, 'errado', fakeFetch(jsonResponse({}, status)))).resolves.toEqual({
      state: 'unauthorized',
    });
  });

  it('reports other HTTP errors with the status code', async () => {
    await expect(fetchServerStatus(LOCAL_URL, '', fakeFetch(jsonResponse({}, 500)))).resolves.toEqual({
      state: 'error',
      reason: 'HTTP 500',
    });
  });

  it('reports an invalid answer', async () => {
    const notJson = new Response('<html>', { status: 200 });
    await expect(fetchServerStatus(LOCAL_URL, '', fakeFetch(notJson))).resolves.toEqual({
      state: 'error',
      reason: 'resposta inválida',
    });
    await expect(fetchServerStatus(LOCAL_URL, '', fakeFetch(jsonResponse({ status: 'ok' })))).resolves.toEqual({
      state: 'error',
      reason: 'resposta inválida',
    });
  });

  it('reports an unreachable server as offline', async () => {
    await expect(fetchServerStatus(LOCAL_URL, '', fakeFetch(new TypeError('Failed to fetch')))).resolves.toEqual({
      state: 'offline',
    });
    const timeout = new DOMException('The operation timed out.', 'TimeoutError');
    await expect(fetchServerStatus(LOCAL_URL, '', fakeFetch(timeout))).resolves.toEqual({ state: 'offline' });
  });

  it('rethrows unexpected errors', async () => {
    await expect(fetchServerStatus(LOCAL_URL, '', fakeFetch(new RangeError('bug')))).rejects.toThrow('bug');
  });
});

describe('checkConfiguredServer', () => {
  it('checks the local server and records when it answered', async () => {
    const contains = vi.spyOn(fakeBrowser.permissions, 'contains');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(HEALTHY_BODY));

    await expect(checkConfiguredServer(() => 1234)).resolves.toMatchObject({ state: 'online' });

    expect(contains).not.toHaveBeenCalled();
    await expect(loadLastConnectedAt()).resolves.toBe(1234);
  });

  it('needs a host permission for a server on the network', async () => {
    await saveSettings({ ...createDefaultSettings(), serverUrl: NETWORK_URL });
    // The fake browser types this method with its callback overload, which returns void.
    const contains = vi.spyOn(fakeBrowser.permissions, 'contains').mockResolvedValue(false as never);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expect(checkConfiguredServer()).resolves.toEqual({ state: 'no-permission' });

    expect(contains).toHaveBeenCalledWith({ origins: ['http://192.168.0.10/*'] });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not record a connection when the server is offline', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(checkConfiguredServer()).resolves.toEqual({ state: 'offline' });

    await expect(loadLastConnectedAt()).resolves.toBeNull();
  });
});

describe('isServerStatus', () => {
  it('accepts every valid state and rejects malformed ones', () => {
    expect(isServerStatus({ state: 'online', gpuName: null, modelsLoaded: true })).toBe(true);
    expect(isServerStatus({ state: 'offline' })).toBe(true);
    expect(isServerStatus({ state: 'error', reason: 'x' })).toBe(true);
    expect(isServerStatus({ state: 'online' })).toBe(false);
    expect(isServerStatus({ state: 'error' })).toBe(false);
    expect(isServerStatus({ state: 'unknown' })).toBe(false);
    expect(isServerStatus(null)).toBe(false);
  });
});
