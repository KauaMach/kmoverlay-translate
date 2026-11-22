import tokensCss from '@/assets/styles/tokens.css?inline';
import mobileMenuCss from '@/components/mobile-menu.css?inline';
import { h } from '@/utils/dom';
import { createIcon, type IconName } from '@/utils/icons';

/** Largest 32-bit z-index, so the button stays above the page's own fixed elements. */
const MAX_Z_INDEX = '2147483647';
const HOST_RIGHT_OFFSET = '16px';
const HOST_BOTTOM_OFFSET = '24px';
const MENU_ID = 'kmoverlay-mobile-menu';
const MENU_ICON_SIZE = 20;
const OPEN_MENU_LABEL = 'Abrir menu do KMOverlay';
const CLOSE_MENU_LABEL = 'Fechar menu do KMOverlay';

/** Reading progress shown at the top of the menu. */
export interface MobileMenuStatus {
  translatedPages: number;
  queuedPages: number;
  /** Whether the page shows the original images, which flips the first action. */
  showingOriginal: boolean;
}

/** Actions of the menu. The menu does not close by itself; call `setOpen(false)` if needed. */
export interface MobileMenuCallbacks {
  onToggleOriginal(): void;
  onPauseSite(): void;
  onOpenPanel(): void;
}

/** Floating "KM" button with its menu, for phones. */
export interface MobileMenu {
  /** Fixed-position element for the caller to append to `document.body`. */
  host: HTMLDivElement;
  setStatus(status: MobileMenuStatus): void;
  setOpen(open: boolean): void;
  /** Removes the button and its menu from the page. */
  destroy(): void;
}

const INITIAL_STATUS: MobileMenuStatus = { translatedPages: 0, queuedPages: 0, showingOriginal: false };

/**
 * Creates the floating menu from the design "Leitor no celular". It is
 * isolated in a shadow root so the page's CSS cannot change it.
 */
export function createMobileMenu(callbacks: MobileMenuCallbacks): MobileMenu {
  const host = h('div');
  // Inline, so page stylesheets that target generic divs cannot move the button.
  Object.assign(host.style, {
    position: 'fixed',
    right: HOST_RIGHT_OFFSET,
    bottom: HOST_BOTTOM_OFFSET,
    zIndex: MAX_Z_INDEX,
  });
  const shadowRoot = host.attachShadow({ mode: 'open' });

  const statusLine = h('p', { class: 'menu__status' });
  const toggleOriginalLabel = h('span');
  const floatingButton = h(
    'button',
    {
      type: 'button',
      class: 'floating-button',
      'aria-controls': MENU_ID,
      'aria-expanded': 'false',
      'aria-label': OPEN_MENU_LABEL,
    },
    ['KM'],
  );
  const menu = h('div', { id: MENU_ID, class: 'menu', role: 'group', 'aria-label': 'Menu do KMOverlay', hidden: true }, [
    statusLine,
    createMenuItem('eye', toggleOriginalLabel, () => callbacks.onToggleOriginal(), true),
    createMenuItem('pause', h('span', {}, ['Pausar neste site']), () => callbacks.onPauseSite()),
    createMenuItem('sliders', h('span', {}, ['Abrir painel']), () => callbacks.onOpenPanel()),
  ]);
  const container = h('div', {}, [floatingButton, menu]);
  shadowRoot.append(h('style', {}, [`${tokensCss}\n${mobileMenuCss}`]), container);

  let isOpen = false;

  const setOpen = (open: boolean): void => {
    isOpen = open;
    menu.hidden = !open;
    floatingButton.setAttribute('aria-expanded', String(open));
    floatingButton.setAttribute('aria-label', open ? CLOSE_MENU_LABEL : OPEN_MENU_LABEL);
  };

  const setStatus = (status: MobileMenuStatus): void => {
    statusLine.textContent = describeStatus(status);
    toggleOriginalLabel.textContent = status.showingOriginal ? 'Mostrar tradução' : 'Mostrar original';
  };

  floatingButton.addEventListener('click', () => setOpen(!isOpen));
  container.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !isOpen) {
      return;
    }
    // The page may react to Escape too (closing its own reader view, for example).
    event.stopPropagation();
    setOpen(false);
    floatingButton.focus();
  });

  setStatus(INITIAL_STATUS);

  return { host, setStatus, setOpen, destroy: () => host.remove() };
}

/** Builds "1 página traduzida · 2 na fila"; the queue part is left out when nothing is waiting. */
function describeStatus(status: MobileMenuStatus): string {
  const translated =
    status.translatedPages === 1 ? '1 página traduzida' : `${status.translatedPages} páginas traduzidas`;
  return status.queuedPages > 0 ? `${translated} · ${status.queuedPages} na fila` : translated;
}

function createMenuItem(
  icon: IconName,
  label: HTMLSpanElement,
  onClick: () => void,
  highlighted = false,
): HTMLButtonElement {
  return h(
    'button',
    { type: 'button', class: highlighted ? 'menu__item menu__item--highlighted' : 'menu__item', onClick },
    [createIcon(icon, { size: MENU_ICON_SIZE }), label],
  );
}
