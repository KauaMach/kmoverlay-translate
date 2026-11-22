import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  MAX_TRANSLATIONS_IN_FLIGHT,
  createPageTranslator,
  type PageTranslator,
} from '@/entrypoints/content/page-translator';
import type { ProximityCallback, ProximityChange } from '@/entrypoints/content/proximity-observer';
import type { TranslateImageRequest, TranslateImageResult } from '@/utils/messages';
import { createDefaultSettings, setSiteEnabled, updateSite, type Settings } from '@/utils/settings';

const HOST = 'leitor.exemplo';
const TRANSLATED = 'data:image/webp;base64,UklGRg==';

interface PendingTranslation {
  request: TranslateImageRequest;
  finish(result: TranslateImageResult): void;
  cancel: ReturnType<typeof vi.fn>;
}

let translations: PendingTranslation[];
let proximityCallback: ProximityCallback;
let reportQueueSize: Mock<(pending: number) => void>;
let translator: PageTranslator;

function enabledSettings(): Settings {
  return setSiteEnabled(createDefaultSettings(), HOST, true);
}

function addImage(name: string, width = 800, height = 1200): HTMLImageElement {
  const image = document.createElement('img');
  image.src = `https://${HOST}/${name}.png`;
  Object.defineProperty(image, 'complete', { value: true });
  Object.defineProperty(image, 'naturalWidth', { value: width });
  Object.defineProperty(image, 'naturalHeight', { value: height });
  document.body.append(image);
  return image;
}

function move(image: Element, change: ProximityChange): void {
  proximityCallback(image, change);
}

/** Layers are the shadow hosts the translator adds to the page. */
function layers(): HTMLElement[] {
  return [...document.body.children].filter((child): child is HTMLElement => child instanceof HTMLDivElement);
}

function overlayText(layer: HTMLElement): string {
  const overlayHost = layer.shadowRoot?.querySelector('div');
  return overlayHost?.shadowRoot?.textContent ?? '';
}

function shownImage(layer: HTMLElement): HTMLImageElement | null | undefined {
  return layer.shadowRoot?.querySelector<HTMLImageElement>('img.translated:not([hidden])');
}

beforeEach(() => {
  document.body.replaceChildren();
  translations = [];
  reportQueueSize = vi.fn<(pending: number) => void>();
  translator = createPageTranslator(HOST, {
    reportQueueSize,
    createProximityObserver: (callback) => {
      proximityCallback = callback;
      return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    },
    startTranslation: (request, onResult) => {
      const cancel = vi.fn();
      translations.push({ request, finish: onResult, cancel });
      return { cancel };
    },
  });
});

describe('createPageTranslator', () => {
  it('stays out of the page while the site is off', () => {
    addImage('page-1');

    translator.applySettings(createDefaultSettings());

    expect(layers()).toHaveLength(0);
    expect(translator.pageStatus()).toBeNull();
  });

  it('tracks the large images only', () => {
    addImage('page-1');
    addImage('icon', 48, 48);

    translator.applySettings(enabledSettings());

    expect(layers()).toHaveLength(1);
    expect(translator.pageStatus()).toEqual({ translatedImages: 0, totalImages: 1, showingOriginal: false });
  });

  it('translates the images near the screen, a few at a time, visible ones first', () => {
    const images = ['page-1', 'page-2', 'page-3'].map((name) => addImage(name));
    translator.applySettings(enabledSettings());

    move(images[2]!, { near: true, visible: true });
    move(images[0]!, { near: true });
    move(images[1]!, { near: true });

    expect(translations.map((translation) => translation.request.url)).toEqual([
      `https://${HOST}/page-3.png`,
      `https://${HOST}/page-1.png`,
    ]);
    expect(translations).toHaveLength(MAX_TRANSLATIONS_IN_FLIGHT);
    expect(translations[0]?.request).toMatchObject({ sourceLanguage: 'en', targetLanguage: 'pt-BR', priority: 'visible' });
    expect(translations[1]?.request.priority).toBe('prefetch');
    expect(overlayText(layers()[1]!)).toContain('Na fila · 1ª');
    expect(reportQueueSize).toHaveBeenLastCalledWith(3);
  });

  it('shows the translation, then the original on toggle', () => {
    const [image] = [addImage('page-1')];
    translator.applySettings(enabledSettings());
    move(image!, { near: true, visible: true });

    translations[0]?.finish({ state: 'translated', imageDataUrl: TRANSLATED });

    const [layer] = layers();
    expect(shownImage(layer!)?.getAttribute('src')).toBe(TRANSLATED);
    expect(translator.pageStatus()).toEqual({ translatedImages: 1, totalImages: 1, showingOriginal: false });
    expect(reportQueueSize).toHaveBeenLastCalledWith(0);

    translator.toggleOriginal();

    expect(shownImage(layer!)).toBeNull();
    expect(translator.pageStatus()?.showingOriginal).toBe(true);
  });

  it('shows a failure and tries again from the overlay', () => {
    const image = addImage('page-1');
    translator.applySettings(enabledSettings());
    move(image, { near: true, visible: true });

    translations[0]?.finish({ state: 'error', reason: 'Servidor não encontrado.' });
    const [layer] = layers();
    expect(overlayText(layer!)).toContain('Falhou');

    const overlayRoot = layer!.shadowRoot?.querySelector('div')?.shadowRoot;
    const retryButton = [...(overlayRoot?.querySelectorAll('button') ?? [])].find((button) =>
      button.textContent?.includes('Tentar de novo'),
    );
    retryButton?.click();

    expect(translations).toHaveLength(2);
  });

  it('cancels the work and removes the layer when the image leaves the page', async () => {
    const image = addImage('page-1');
    translator.applySettings(enabledSettings());
    move(image, { near: true });

    image.remove();
    await vi.waitFor(() => expect(layers()).toHaveLength(0));

    expect(translations[0]?.cancel).toHaveBeenCalledOnce();
  });

  it('starts over when the languages change and cleans up when the site is turned off', () => {
    const image = addImage('page-1');
    translator.applySettings(enabledSettings());
    move(image, { near: true });
    translations[0]?.finish({ state: 'translated', imageDataUrl: TRANSLATED });

    translator.applySettings(updateSite(enabledSettings(), HOST, { sourceLanguage: 'ja' }));
    expect(translations[1]?.request.sourceLanguage).toBe('ja');

    translator.applySettings(createDefaultSettings());
    expect(translations[1]?.cancel).toHaveBeenCalledOnce();
    expect(layers()).toHaveLength(0);
    expect(translator.pageStatus()).toBeNull();
  });
});
