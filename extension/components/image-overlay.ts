import tokensCss from '@/assets/styles/tokens.css?inline';
import overlayCss from '@/components/image-overlay.css?inline';
import { h } from '@/utils/dom';
import { formatQueuePosition } from '@/utils/format';
import { createIcon, createSpinner } from '@/utils/icons';

const PILL_ICON_SIZE = 14;
/** The design draws the pill icons slightly heavier than the default stroke. */
const PILL_ICON_STROKE_WIDTH = 2.2;
const TRANSLATED_SHORTCUT_HINT = 'Alt+T';

/** What the overlay shows over one image. */
export type ImageOverlayState =
  | { kind: 'idle' }
  | { kind: 'queued'; position: number }
  | { kind: 'translating'; queuePosition?: number }
  | { kind: 'translated'; showingOriginal: boolean }
  | { kind: 'error' };

/** Actions the reader can take from the overlay. */
export interface ImageOverlayCallbacks {
  /** Called when the reader picks "Tradução" (`false`) or "Original" (`true`). */
  onShowOriginalChange(showOriginal: boolean): void;
  /** Called by "Tentar de novo" after a failed translation. */
  onRetry(): void;
}

/** Overlay mounted over one image of the page. */
export interface ImageOverlay {
  /**
   * Element the caller positions absolutely over the image. It lets pointer
   * events through to the page, except on its own controls.
   */
  host: HTMLDivElement;
  setState(state: ImageOverlayState): void;
  /** Tells whether the pointer is over the image; the translated control only shows while it is. */
  setHovered(hovered: boolean): void;
  /** Removes the overlay from the page. */
  destroy(): void;
}

type ProgressTone = 'queued' | 'translating';

interface ProgressContent {
  tone: ProgressTone;
  text: string;
}

interface ProgressPill {
  element: HTMLDivElement;
  show(content: ProgressContent | null): void;
}

interface TranslatedControl {
  element: HTMLDivElement;
  setShowingOriginal(showingOriginal: boolean): void;
  setHovered(hovered: boolean): void;
}

/**
 * Creates the per-image overlay from the design "Estados da imagem": queue and
 * progress pills, the translation/original switch and the error pill. It is
 * isolated in a shadow root so the page's CSS cannot change it.
 */
export function createImageOverlay(callbacks: ImageOverlayCallbacks): ImageOverlay {
  const host = h('div');
  // Inline, so page stylesheets cannot make the overlay swallow clicks meant for the image.
  host.style.pointerEvents = 'none';
  const shadowRoot = host.attachShadow({ mode: 'open' });

  const progressPill = createProgressPill();
  const errorPill = createErrorPill(() => callbacks.onRetry());
  const translatedControl = createTranslatedControl((showOriginal) =>
    callbacks.onShowOriginalChange(showOriginal),
  );
  shadowRoot.append(
    h('style', {}, [`${tokensCss}\n${overlayCss}`]),
    progressPill.element,
    errorPill,
    translatedControl.element,
  );

  const setState = (state: ImageOverlayState): void => {
    progressPill.show(describeProgress(state));
    errorPill.hidden = state.kind !== 'error';
    translatedControl.element.hidden = state.kind !== 'translated';
    if (state.kind === 'translated') {
      translatedControl.setShowingOriginal(state.showingOriginal);
    }
  };

  return {
    host,
    setState,
    setHovered: (hovered) => translatedControl.setHovered(hovered),
    destroy: () => host.remove(),
  };
}

function describeProgress(state: ImageOverlayState): ProgressContent | null {
  switch (state.kind) {
    case 'queued':
      return { tone: 'queued', text: `Na fila · ${formatQueuePosition(state.position)}` };
    case 'translating':
      return {
        tone: 'translating',
        text:
          state.queuePosition === undefined
            ? 'Traduzindo…'
            : `Traduzindo · ${formatQueuePosition(state.queuePosition)} na fila`,
      };
    default:
      return null;
  }
}

function createProgressPill(): ProgressPill {
  const element = h('div', { class: 'progress', role: 'status', 'aria-live': 'polite' });
  let currentKey = '';

  const show = (content: ProgressContent | null): void => {
    const key = content ? `${content.tone}:${content.text}` : '';
    // Rewriting the same text would make screen readers announce it again.
    if (key === currentKey) {
      return;
    }
    currentKey = key;
    if (!content) {
      element.className = 'progress';
      element.replaceChildren();
      return;
    }
    element.className = `progress progress--${content.tone}`;
    element.replaceChildren(createProgressIcon(content.tone), h('span', {}, [content.text]));
  };

  return { element, show };
}

function createProgressIcon(tone: ProgressTone): SVGSVGElement {
  return tone === 'queued'
    ? createIcon('clock', { size: PILL_ICON_SIZE, strokeWidth: PILL_ICON_STROKE_WIDTH })
    : createSpinner(PILL_ICON_SIZE);
}

function createErrorPill(onRetry: () => void): HTMLDivElement {
  return h('div', { class: 'error', hidden: true }, [
    createIcon('alertCircle', { size: PILL_ICON_SIZE, strokeWidth: PILL_ICON_STROKE_WIDTH }),
    h('span', {}, ['Falhou']),
    h('button', { type: 'button', class: 'error__retry', onClick: onRetry }, ['Tentar de novo']),
  ]);
}

function createTranslatedControl(onShowOriginalChange: (showOriginal: boolean) => void): TranslatedControl {
  let showingOriginal = false;
  let hoveredByCaller = false;
  // The pointer may leave the image to reach the control, which sits on top of it.
  let pointerInside = false;
  let keyboardFocusInside = false;
  // A click also focuses the button; only keyboard focus should keep the control
  // on screen after the pointer leaves, or it would keep covering the art.
  let focusFromPointer = false;

  const select = (showOriginal: boolean): void => {
    if (showOriginal === showingOriginal) {
      return;
    }
    setShowingOriginal(showOriginal);
    onShowOriginalChange(showOriginal);
  };

  const translationButton = createSegment('Tradução', () => select(false));
  const originalButton = createSegment('Original', () => select(true));
  const element = h('div', { class: 'control', role: 'group', 'aria-label': 'KMOverlay', hidden: true }, [
    h('span', { class: 'control__badge', 'aria-hidden': 'true' }, ['KM']),
    translationButton,
    originalButton,
    h('span', { class: 'control__hint' }, [TRANSLATED_SHORTCUT_HINT]),
  ]);

  function setShowingOriginal(value: boolean): void {
    showingOriginal = value;
    translationButton.setAttribute('aria-pressed', String(!value));
    originalButton.setAttribute('aria-pressed', String(value));
  }

  const updateVisibility = (): void => {
    element.classList.toggle('control--visible', hoveredByCaller || pointerInside || keyboardFocusInside);
  };

  element.addEventListener('mouseenter', () => {
    pointerInside = true;
    updateVisibility();
  });
  element.addEventListener('mouseleave', () => {
    pointerInside = false;
    updateVisibility();
  });
  element.addEventListener('pointerdown', () => {
    focusFromPointer = true;
  });
  // Some browsers (Safari) do not focus buttons on click, so the flag is also cleared here.
  element.addEventListener('click', () => {
    focusFromPointer = false;
  });
  element.addEventListener('focusin', () => {
    keyboardFocusInside = !focusFromPointer;
    focusFromPointer = false;
    updateVisibility();
  });
  element.addEventListener('focusout', (event) => {
    if (event.relatedTarget instanceof Node && element.contains(event.relatedTarget)) {
      return;
    }
    keyboardFocusInside = false;
    updateVisibility();
  });

  setShowingOriginal(showingOriginal);

  return {
    element,
    setShowingOriginal,
    setHovered: (hovered) => {
      hoveredByCaller = hovered;
      updateVisibility();
    },
  };
}

function createSegment(label: string, onClick: () => void): HTMLButtonElement {
  return h('button', { type: 'button', class: 'control__segment', 'aria-pressed': 'false', onClick }, [label]);
}
