import type { ImageOverlayState } from '@/components/image-overlay';
import type { PageStatus } from '@/utils/messages';
import { getSite, type Settings } from '@/utils/settings';
import type { SourceLanguage, TargetLanguage } from '@/utils/languages';
import { isLargeEnough, translatableImageUrl } from './image-candidates';
import { createImageLayer, type ImageLayer } from './image-layer';
import type { ProximityCallback, ProximityChange, ProximityObserver } from './proximity-observer';
import { TranslationQueue } from './translation-queue';
import type { TranslationHandle, TranslationStarter } from './translation-port';

/** Images sent to the background at the same time; the server works on one at a time anyway. */
export const MAX_TRANSLATIONS_IN_FLIGHT = 2;

/** Browser features the translator uses, replaceable in tests. */
export interface PageTranslatorDependencies {
  startTranslation: TranslationStarter;
  reportQueueSize(pending: number): void;
  createProximityObserver(callback: ProximityCallback): ProximityObserver;
}

/** Translates the images of the current page while the site is turned on. */
export interface PageTranslator {
  /** Follows the settings: turning the site (or its images) off removes everything from the page. */
  applySettings(settings: Settings): void;
  /** Progress for the popup, or `null` while the site is off. */
  pageStatus(): PageStatus | null;
  toggleOriginal(): void;
  stop(): void;
}

type ImageStatus = 'waiting' | 'queued' | 'translating' | 'translated' | 'error';

interface TrackedImage {
  element: HTMLImageElement;
  url: string;
  layer: ImageLayer;
  status: ImageStatus;
  near: boolean;
  visible: boolean;
  translatedImage: string | null;
  /** Why the last translation failed, shown as the tooltip of the error pill. */
  errorReason: string | null;
  request: TranslationHandle | null;
  removeListeners(): void;
}

interface Languages {
  source: SourceLanguage;
  target: TargetLanguage;
}

/** Creates the translator for the page of `host`; it does nothing until the settings turn it on. */
export function createPageTranslator(host: string, dependencies: PageTranslatorDependencies): PageTranslator {
  const tracked = new Map<HTMLImageElement, TrackedImage>();
  const queue = new TranslationQueue<HTMLImageElement>();
  let languages: Languages | null = null;
  let showingOriginal = false;
  let proximity: ProximityObserver | null = null;
  let mutations: MutationObserver | null = null;
  let resizes: ResizeObserver | null = null;
  let placementFrame: number | null = null;
  let reportedPending = 0;

  const schedulePlacement = (): void => {
    if (placementFrame === null) {
      placementFrame = requestAnimationFrame(placeLayers);
    }
  };

  // Layers are fixed to the viewport, so they move with the image on every scroll and resize.
  function placeLayers(): void {
    placementFrame = null;
    for (const item of tracked.values()) {
      item.layer.place(item.visible ? item.element.getBoundingClientRect() : null);
    }
  }

  function overlayState(item: TrackedImage): ImageOverlayState {
    switch (item.status) {
      case 'waiting':
        return { kind: 'idle' };
      case 'queued':
        return { kind: 'queued', position: queue.position(item.element) ?? 1 };
      case 'translating':
        return { kind: 'translating' };
      case 'translated':
        return { kind: 'translated', showingOriginal };
      case 'error':
        return { kind: 'error', reason: item.errorReason ?? undefined };
    }
  }

  function render(): void {
    let pending = 0;
    for (const item of tracked.values()) {
      item.layer.overlay.setState(overlayState(item));
      item.layer.showImage(item.status === 'translated' && !showingOriginal ? item.translatedImage : null);
      if (item.status === 'queued' || item.status === 'translating') {
        pending += 1;
      }
    }
    if (pending !== reportedPending) {
      reportedPending = pending;
      dependencies.reportQueueSize(pending);
    }
  }

  function inFlight(): number {
    let count = 0;
    for (const item of tracked.values()) {
      if (item.status === 'translating') {
        count += 1;
      }
    }
    return count;
  }

  function enqueue(item: TrackedImage): void {
    item.status = 'queued';
    const pageOrder = item.element.getBoundingClientRect().top + window.scrollY;
    queue.add(item.element, item.visible, pageOrder);
  }

  function pump(): void {
    while (languages !== null && inFlight() < MAX_TRANSLATIONS_IN_FLIGHT) {
      const next = queue.takeNext();
      const item = next === undefined ? undefined : tracked.get(next);
      if (item === undefined) {
        break;
      }
      start(item, languages);
    }
    render();
  }

  function start(item: TrackedImage, current: Languages): void {
    item.status = 'translating';
    item.request = dependencies.startTranslation(
      {
        url: item.url,
        sourceLanguage: current.source,
        targetLanguage: current.target,
        priority: item.visible ? 'visible' : 'prefetch',
      },
      (result) => {
        // The image may have been removed, or the languages changed, while it was translated.
        if (tracked.get(item.element) !== item || item.request === null) {
          return;
        }
        item.request = null;
        if (result.state === 'translated') {
          item.status = 'translated';
          item.translatedImage = result.imageDataUrl;
        } else {
          item.status = 'error';
          item.errorReason = result.reason;
        }
        pump();
      },
    );
  }

  function retry(element: HTMLImageElement): void {
    const item = tracked.get(element);
    if (item === undefined || item.status !== 'error') {
      return;
    }
    if (item.near) {
      enqueue(item);
    } else {
      item.status = 'waiting';
    }
    pump();
  }

  function handleProximity(element: Element, change: ProximityChange): void {
    const item = tracked.get(element as HTMLImageElement);
    if (item === undefined) {
      return;
    }
    if (change.visible !== undefined) {
      item.visible = change.visible;
      queue.setVisible(item.element, change.visible);
      schedulePlacement();
    }
    if (change.near !== undefined) {
      item.near = change.near;
      if (change.near && item.status === 'waiting') {
        enqueue(item);
      } else if (!change.near && item.status === 'queued') {
        // Scrolled away before its turn: it waits until the reader comes back.
        queue.remove(item.element);
        item.status = 'waiting';
      }
    }
    pump();
  }

  function track(element: HTMLImageElement, url: string): void {
    const layer = createImageLayer({
      onShowOriginalChange: (showOriginal) => setShowingOriginal(showOriginal),
      onRetry: () => retry(element),
    });
    const showControls = (): void => layer.overlay.setHovered(true);
    const hideControls = (): void => layer.overlay.setHovered(false);
    element.addEventListener('mouseenter', showControls);
    element.addEventListener('mouseleave', hideControls);
    (document.body ?? document.documentElement).append(layer.host);
    tracked.set(element, {
      element,
      url,
      layer,
      status: 'waiting',
      near: false,
      visible: false,
      translatedImage: null,
      errorReason: null,
      request: null,
      removeListeners: () => {
        element.removeEventListener('mouseenter', showControls);
        element.removeEventListener('mouseleave', hideControls);
      },
    });
    proximity?.observe(element);
    resizes?.observe(element);
  }

  function untrack(item: TrackedImage): void {
    item.request?.cancel();
    item.request = null;
    item.removeListeners();
    item.layer.destroy();
    proximity?.unobserve(item.element);
    resizes?.unobserve(item.element);
    queue.remove(item.element);
    tracked.delete(item.element);
  }

  function consider(element: HTMLImageElement): void {
    if (tracked.has(element)) {
      return;
    }
    if (!element.complete || element.naturalWidth === 0) {
      // Lazy-loaded pages get their size only when they load.
      element.addEventListener('load', () => consider(element), { once: true });
      return;
    }
    const url = translatableImageUrl(element);
    if (url !== null && isLargeEnough(element)) {
      track(element, url);
    }
  }

  function scan(root: ParentNode): void {
    if (root instanceof HTMLImageElement) {
      consider(root);
    }
    for (const image of root.querySelectorAll('img')) {
      consider(image);
    }
  }

  function handleMutations(records: MutationRecord[]): void {
    for (const record of records) {
      if (record.type === 'attributes' && record.target instanceof HTMLImageElement) {
        // Paginated readers reuse the same <img> for the next page.
        const item = tracked.get(record.target);
        if (item !== undefined) {
          untrack(item);
        }
        consider(record.target);
      }
      for (const node of record.addedNodes) {
        if (node instanceof Element) {
          scan(node);
        }
      }
    }
    for (const item of [...tracked.values()]) {
      if (!item.element.isConnected) {
        untrack(item);
      }
    }
    schedulePlacement();
    pump();
  }

  function setShowingOriginal(value: boolean): void {
    showingOriginal = value;
    render();
  }

  function activate(current: Languages): void {
    languages = current;
    proximity = dependencies.createProximityObserver(handleProximity);
    resizes = new ResizeObserver(schedulePlacement);
    mutations = new MutationObserver(handleMutations);
    mutations.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'srcset'],
    });
    document.addEventListener('scroll', schedulePlacement, { capture: true, passive: true });
    window.addEventListener('resize', schedulePlacement, { passive: true });
    scan(document);
    pump();
  }

  function deactivate(): void {
    for (const item of [...tracked.values()]) {
      untrack(item);
    }
    queue.clear();
    proximity?.disconnect();
    mutations?.disconnect();
    resizes?.disconnect();
    proximity = null;
    mutations = null;
    resizes = null;
    languages = null;
    document.removeEventListener('scroll', schedulePlacement, { capture: true });
    window.removeEventListener('resize', schedulePlacement);
    if (placementFrame !== null) {
      cancelAnimationFrame(placementFrame);
      placementFrame = null;
    }
    render();
  }

  /** New languages make the old results useless: every image starts over. */
  function restartTranslations(current: Languages): void {
    languages = current;
    queue.clear();
    for (const item of tracked.values()) {
      item.request?.cancel();
      item.request = null;
      item.translatedImage = null;
      item.status = 'waiting';
      if (item.near) {
        enqueue(item);
      }
    }
    pump();
  }

  return {
    applySettings(settings) {
      const site = getSite(settings, host);
      if (site === undefined || !site.enabled || !site.images) {
        if (languages !== null) {
          deactivate();
        }
        return;
      }
      const next: Languages = {
        // Automatic detection only exists for page text; images need a known language for the OCR.
        source: site.sourceLanguage === 'auto' ? settings.defaultSourceLanguage : site.sourceLanguage,
        target: settings.targetLanguage,
      };
      if (languages === null) {
        activate(next);
      } else if (next.source !== languages.source || next.target !== languages.target) {
        restartTranslations(next);
      }
    },
    pageStatus() {
      if (languages === null) {
        return null;
      }
      const translatedImages = [...tracked.values()].filter((item) => item.status === 'translated').length;
      return { translatedImages, totalImages: tracked.size, showingOriginal };
    },
    toggleOriginal() {
      setShowingOriginal(!showingOriginal);
    },
    stop() {
      deactivate();
    },
  };
}
