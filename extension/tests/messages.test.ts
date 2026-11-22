import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { handleCommand, TOGGLE_ORIGINAL_COMMAND, TOGGLE_SITE_COMMAND } from '@/entrypoints/background';
import {
  isBackgroundRequest,
  isContentRequest,
  isTranslateImageRequest,
  isTranslateImageResult,
  reportQueueSize,
  isPageStatus,
  requestPageStatus,
  requestServerCheck,
  sendToContentScript,
} from '@/utils/messages';
import { createDefaultSettings, loadSettings, saveSettings, setSiteEnabled } from '@/utils/settings';

const TAB_ID = 7;
const NO_RECEIVER = 'Could not establish connection. Receiving end does not exist.';
const PAGE_STATUS = { translatedImages: 5, totalImages: 12, showingOriginal: false };

beforeEach(() => {
  fakeBrowser.reset();
  vi.restoreAllMocks();
});

describe('message guards', () => {
  it('recognizes the background requests and the page status', () => {
    expect(isBackgroundRequest({ type: 'check-server' })).toBe(true);
    expect(isBackgroundRequest({ type: 'toggle-original' })).toBe(false);
    expect(isPageStatus(PAGE_STATUS)).toBe(true);
    expect(isPageStatus({ ...PAGE_STATUS, totalImages: -1 })).toBe(false);
    expect(isPageStatus({ translatedImages: 1 })).toBe(false);
  });
});

describe('requestServerCheck', () => {
  it('returns the status answered by the background script', async () => {
    fakeBrowser.runtime.onMessage.addListener(
      (_message: unknown, _sender: unknown, sendResponse: (response: unknown) => void) => {
        sendResponse({ state: 'offline' });
        return true;
      },
    );

    await expect(requestServerCheck()).resolves.toEqual({ state: 'offline' });
  });

  it('rejects an invalid answer', async () => {
    // The fake browser types these methods with their callback overload, which returns void.
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValue({ state: 'online' } as never);

    await expect(requestServerCheck()).rejects.toThrow('invalid server status');
  });
});

describe('sendToContentScript', () => {
  it('resolves to null when the page has no content script', async () => {
    vi.spyOn(fakeBrowser.tabs, 'sendMessage').mockRejectedValue(new Error(NO_RECEIVER));

    await expect(sendToContentScript(TAB_ID, { type: 'toggle-original' })).resolves.toBeNull();
    await expect(requestPageStatus(TAB_ID)).resolves.toBeNull();
  });

  it('rethrows other failures', async () => {
    vi.spyOn(fakeBrowser.tabs, 'sendMessage').mockRejectedValue(new Error('No tab with id: 7.'));

    await expect(sendToContentScript(TAB_ID, { type: 'toggle-original' })).rejects.toThrow('No tab with id');
  });

  it('returns a valid page status and ignores malformed answers', async () => {
    const sendMessage = vi.spyOn(fakeBrowser.tabs, 'sendMessage').mockResolvedValue(PAGE_STATUS as never);
    await expect(requestPageStatus(TAB_ID)).resolves.toEqual(PAGE_STATUS);
    expect(sendMessage).toHaveBeenCalledWith(TAB_ID, { type: 'get-page-status' });

    sendMessage.mockResolvedValue({ unexpected: true } as never);
    await expect(requestPageStatus(TAB_ID)).resolves.toBeNull();
  });
});

describe('handleCommand (background)', () => {
  const readerTab = { id: TAB_ID, url: 'https://leitor.exemplo/capitulo/12' } as Parameters<typeof handleCommand>[1];

  it('turns the current site on and off', async () => {
    await handleCommand(TOGGLE_SITE_COMMAND, readerTab);
    expect((await loadSettings()).sites['leitor.exemplo']?.enabled).toBe(true);

    await handleCommand(TOGGLE_SITE_COMMAND, readerTab);
    expect((await loadSettings()).sites['leitor.exemplo']?.enabled).toBe(false);
  });

  it('ignores browser pages', async () => {
    await saveSettings(setSiteEnabled(createDefaultSettings(), 'leitor.exemplo', true));

    await handleCommand(TOGGLE_SITE_COMMAND, { id: TAB_ID, url: 'chrome://extensions/' } as typeof readerTab);

    expect(Object.keys((await loadSettings()).sites)).toEqual(['leitor.exemplo']);
  });

  it('forwards "toggle original" to the page, even when it has no content script', async () => {
    const sendMessage = vi.spyOn(fakeBrowser.tabs, 'sendMessage').mockRejectedValue(new Error(NO_RECEIVER));

    await expect(handleCommand(TOGGLE_ORIGINAL_COMMAND, readerTab)).resolves.toBeUndefined();

    expect(sendMessage).toHaveBeenCalledWith(TAB_ID, { type: 'toggle-original' });
  });
});

describe('content and translation messages', () => {
  it('recognizes the content requests and the queue report', () => {
    expect(isContentRequest({ type: 'get-page-status' })).toBe(true);
    expect(isContentRequest({ type: 'check-server' })).toBe(false);
    expect(isBackgroundRequest({ type: 'queue-changed', pending: 3 })).toBe(true);
    expect(isBackgroundRequest({ type: 'queue-changed', pending: -1 })).toBe(false);
  });

  it('validates what crosses the translation port', () => {
    const request = { url: 'https://leitor.exemplo/1.png', sourceLanguage: 'en', targetLanguage: 'pt-BR', priority: 'visible' };
    expect(isTranslateImageRequest(request)).toBe(true);
    expect(isTranslateImageRequest({ ...request, sourceLanguage: 'auto' })).toBe(false);
    expect(isTranslateImageResult({ state: 'translated', imageDataUrl: 'data:image/webp;base64,AA' })).toBe(true);
    expect(isTranslateImageResult({ state: 'error', reason: 'x' })).toBe(true);
    expect(isTranslateImageResult({ state: 'translated' })).toBe(false);
  });

  it('reports the queue size, ignoring that the background does not answer', async () => {
    const sendMessage = vi
      .spyOn(fakeBrowser.runtime, 'sendMessage')
      .mockRejectedValueOnce(new Error('The message port closed before a response was received.'))
      .mockRejectedValueOnce(new Error('Extension context invalidated.'));

    await expect(reportQueueSize(2)).resolves.toBeUndefined();
    expect(sendMessage).toHaveBeenCalledWith({ type: 'queue-changed', pending: 2 });
    await expect(reportQueueSize(1)).rejects.toThrow('Extension context invalidated');
  });
});
