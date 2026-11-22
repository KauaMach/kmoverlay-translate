import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { MIN_IMAGE_SIDE_PX, isLargeEnough, translatableImageUrl } from '@/entrypoints/content/image-candidates';
import { TranslationQueue } from '@/entrypoints/content/translation-queue';
import {
  CONNECTION_LOST_REASON,
  INVALID_ANSWER_REASON,
  startTranslation,
} from '@/entrypoints/content/translation-port';
import type { TranslateImageRequest } from '@/utils/messages';

const REQUEST: TranslateImageRequest = {
  url: 'https://leitor.exemplo/p1.png',
  sourceLanguage: 'en',
  targetLanguage: 'pt-BR',
  priority: 'visible',
};

describe('TranslationQueue', () => {
  it('sends images on screen first, then follows the page order', () => {
    const queue = new TranslationQueue<string>();
    queue.add('page-3', false, 3000);
    queue.add('page-1', false, 1000);
    queue.add('page-2', true, 2000);

    expect(queue.ordered()).toEqual(['page-2', 'page-1', 'page-3']);
    expect(queue.position('page-1')).toBe(2);

    queue.setVisible('page-3', true);
    expect(queue.takeNext()).toBe('page-2');
    expect(queue.takeNext()).toBe('page-3');
    expect(queue.position('page-3')).toBeNull();
    expect(queue.size).toBe(1);
  });

  it('removes and clears items', () => {
    const queue = new TranslationQueue<string>();
    queue.add('a', false, 1);
    queue.add('b', false, 2);

    queue.remove('a');
    expect(queue.has('a')).toBe(false);
    queue.clear();
    expect(queue.takeNext()).toBeUndefined();
  });
});

describe('image candidates', () => {
  function image(src: string, width: number, height: number): HTMLImageElement {
    const element = document.createElement('img');
    element.setAttribute('src', src);
    Object.defineProperty(element, 'naturalWidth', { value: width });
    Object.defineProperty(element, 'naturalHeight', { value: height });
    return element;
  }

  it('keeps pages and strip slices, not icons', () => {
    expect(isLargeEnough(image('page.png', 800, 1200))).toBe(true);
    expect(isLargeEnough(image('slice.png', MIN_IMAGE_SIDE_PX, MIN_IMAGE_SIDE_PX))).toBe(true);
    expect(isLargeEnough(image('avatar.png', 64, 64))).toBe(false);
    expect(isLargeEnough(image('banner.png', 900, 120))).toBe(false);
  });

  it('returns an absolute URL and skips what the background cannot download', () => {
    // `currentSrc` is already resolved against the page, as in browsers.
    expect(translatableImageUrl(image('/pages/1.png', 1, 1))).toBe(new URL('/pages/1.png', document.baseURI).href);
    expect(translatableImageUrl(image('data:image/png;base64,AAAA', 1, 1))).toBe('data:image/png;base64,AAAA');
    expect(translatableImageUrl(image('blob:https://leitor.exemplo/123', 1, 1))).toBeNull();
    expect(translatableImageUrl(document.createElement('img'))).toBeNull();
  });
});

describe('startTranslation', () => {
  interface FakePort {
    postMessage: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    answer(message: unknown): void;
    close(): void;
  }

  function fakePort(): FakePort {
    const messageListeners: Array<(message: unknown) => void> = [];
    const disconnectListeners: Array<() => void> = [];
    const port = {
      name: 'translate-image',
      postMessage: vi.fn(),
      disconnect: vi.fn(),
      onMessage: { addListener: (listener: (message: unknown) => void) => messageListeners.push(listener) },
      onDisconnect: { addListener: (listener: () => void) => disconnectListeners.push(listener) },
    };
    vi.spyOn(fakeBrowser.runtime, 'connect').mockReturnValue(port as never);
    return {
      postMessage: port.postMessage,
      disconnect: port.disconnect,
      answer: (message) => messageListeners.forEach((listener) => listener(message)),
      close: () => disconnectListeners.forEach((listener) => listener()),
    };
  }

  beforeEach(() => {
    fakeBrowser.reset();
    vi.restoreAllMocks();
  });

  it('sends the request and reports the answer once', () => {
    const port = fakePort();
    const onResult = vi.fn();

    startTranslation(REQUEST, onResult);
    port.answer({ state: 'translated', imageDataUrl: 'data:image/webp;base64,AA' });
    port.close();

    expect(port.postMessage).toHaveBeenCalledWith(REQUEST);
    expect(onResult).toHaveBeenCalledOnce();
    expect(onResult).toHaveBeenCalledWith({ state: 'translated', imageDataUrl: 'data:image/webp;base64,AA' });
  });

  it('reports a lost connection and an invalid answer as errors', () => {
    const lost = fakePort();
    const onLost = vi.fn();
    startTranslation(REQUEST, onLost);
    lost.close();
    expect(onLost).toHaveBeenCalledWith({ state: 'error', reason: CONNECTION_LOST_REASON });

    const invalid = fakePort();
    const onInvalid = vi.fn();
    startTranslation(REQUEST, onInvalid);
    invalid.answer({ state: 'done' });
    expect(onInvalid).toHaveBeenCalledWith({ state: 'error', reason: INVALID_ANSWER_REASON });
  });

  it('closes the port on cancel and ignores what comes after', () => {
    const port = fakePort();
    const onResult = vi.fn();

    const handle = startTranslation(REQUEST, onResult);
    handle.cancel();
    port.answer({ state: 'translated', imageDataUrl: 'x' });

    expect(port.disconnect).toHaveBeenCalledOnce();
    expect(onResult).not.toHaveBeenCalled();
  });
});
