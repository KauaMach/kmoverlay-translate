import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMobileMenu, type MobileMenu } from '@/components/mobile-menu';

let mobileMenu: MobileMenu;
let onToggleOriginal: ReturnType<typeof vi.fn<() => void>>;
let onPauseSite: ReturnType<typeof vi.fn<() => void>>;
let onOpenPanel: ReturnType<typeof vi.fn<() => void>>;

function shadow(): ShadowRoot {
  const root = mobileMenu.host.shadowRoot;
  if (!root) {
    throw new Error('The menu host has no open shadow root.');
  }
  return root;
}

function query<T extends Element>(selector: string): T {
  const element = shadow().querySelector<T>(selector);
  if (!element) {
    throw new Error(`Nothing matches "${selector}" in the menu.`);
  }
  return element;
}

const floatingButton = (): HTMLButtonElement => query('.floating-button');
const menu = (): HTMLElement => query('.menu');
const statusLine = (): HTMLElement => query('.menu__status');
const menuItem = (label: string): HTMLButtonElement => {
  const item = Array.from(shadow().querySelectorAll<HTMLButtonElement>('.menu__item')).find(
    (candidate) => candidate.textContent === label,
  );
  if (!item) {
    throw new Error(`No menu item labelled "${label}".`);
  }
  return item;
};

beforeEach(() => {
  onToggleOriginal = vi.fn<() => void>();
  onPauseSite = vi.fn<() => void>();
  onOpenPanel = vi.fn<() => void>();
  mobileMenu = createMobileMenu({ onToggleOriginal, onPauseSite, onOpenPanel });
  document.body.append(mobileMenu.host);
});

afterEach(() => {
  mobileMenu.destroy();
});

describe('createMobileMenu', () => {
  it('pins the host to the bottom right corner above the page', () => {
    const { style } = mobileMenu.host;
    expect(style.position).toBe('fixed');
    expect(style.right).toBe('16px');
    expect(style.bottom).toBe('24px');
    expect(Number(style.zIndex)).toBeGreaterThan(1_000_000);
    // Vitest does not process CSS, so `?inline` imports are empty here; only the element is checked.
    expect(shadow().firstElementChild?.tagName).toBe('STYLE');
  });

  it('starts closed, with the button pointing at the menu', () => {
    const button = floatingButton();
    expect(button.textContent).toBe('KM');
    expect(button.type).toBe('button');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-label')).toBe('Abrir menu do KMOverlay');
    const menuId = button.getAttribute('aria-controls') ?? '';
    expect(shadow().getElementById(menuId)).toBe(menu());
    expect(menu().hidden).toBe(true);
  });

  it('opens and closes from the floating button', () => {
    floatingButton().click();
    expect(menu().hidden).toBe(false);
    expect(floatingButton().getAttribute('aria-expanded')).toBe('true');
    expect(floatingButton().getAttribute('aria-label')).toBe('Fechar menu do KMOverlay');

    floatingButton().click();
    expect(menu().hidden).toBe(true);
    expect(floatingButton().getAttribute('aria-expanded')).toBe('false');
    expect(floatingButton().getAttribute('aria-label')).toBe('Abrir menu do KMOverlay');
  });

  it('opens and closes through setOpen', () => {
    mobileMenu.setOpen(true);
    expect(menu().hidden).toBe(false);
    expect(floatingButton().getAttribute('aria-expanded')).toBe('true');

    mobileMenu.setOpen(false);
    expect(menu().hidden).toBe(true);
    expect(floatingButton().getAttribute('aria-expanded')).toBe('false');
  });

  it('places the menu after the button so it comes next in the focus order', () => {
    expect(floatingButton().nextElementSibling).toBe(menu());
  });

  it('lists the three actions with their icons', () => {
    const items = Array.from(shadow().querySelectorAll<HTMLButtonElement>('.menu__item'));
    expect(items.map((item) => item.textContent)).toEqual([
      'Mostrar original',
      'Pausar neste site',
      'Abrir painel',
    ]);
    for (const item of items) {
      expect(item.type).toBe('button');
      expect(item.querySelector('svg')?.getAttribute('width')).toBe('20');
    }
    expect(items[0]?.classList.contains('menu__item--highlighted')).toBe(true);
  });

  it('calls the callback of each action', () => {
    mobileMenu.setOpen(true);

    menuItem('Mostrar original').click();
    expect(onToggleOriginal).toHaveBeenCalledOnce();

    menuItem('Pausar neste site').click();
    expect(onPauseSite).toHaveBeenCalledOnce();

    menuItem('Abrir painel').click();
    expect(onOpenPanel).toHaveBeenCalledOnce();
  });

  it('pluralizes the status line', () => {
    mobileMenu.setStatus({ translatedPages: 1, queuedPages: 2, showingOriginal: false });
    expect(statusLine().textContent).toBe('1 página traduzida · 2 na fila');

    mobileMenu.setStatus({ translatedPages: 3, queuedPages: 1, showingOriginal: false });
    expect(statusLine().textContent).toBe('3 páginas traduzidas · 1 na fila');

    mobileMenu.setStatus({ translatedPages: 0, queuedPages: 4, showingOriginal: false });
    expect(statusLine().textContent).toBe('0 páginas traduzidas · 4 na fila');
  });

  it('leaves the queue out of the status line when nothing is waiting', () => {
    mobileMenu.setStatus({ translatedPages: 5, queuedPages: 0, showingOriginal: false });
    expect(statusLine().textContent).toBe('5 páginas traduzidas');
  });

  it('offers to show the translation back while the original is shown', () => {
    mobileMenu.setStatus({ translatedPages: 1, queuedPages: 0, showingOriginal: true });
    expect(menuItem('Mostrar tradução').classList.contains('menu__item--highlighted')).toBe(true);

    mobileMenu.setStatus({ translatedPages: 1, queuedPages: 0, showingOriginal: false });
    expect(menuItem('Mostrar original')).toBeDefined();
  });

  it('closes on Escape and returns focus to the floating button', () => {
    const pageListener = vi.fn();
    document.addEventListener('keydown', pageListener);
    mobileMenu.setOpen(true);
    const item = menuItem('Pausar neste site');
    item.focus();

    item.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));

    expect(menu().hidden).toBe(true);
    expect(floatingButton().getAttribute('aria-expanded')).toBe('false');
    expect(shadow().activeElement).toBe(floatingButton());
    expect(pageListener).not.toHaveBeenCalled();
    document.removeEventListener('keydown', pageListener);
  });

  it('lets Escape reach the page while the menu is closed', () => {
    const pageListener = vi.fn();
    document.addEventListener('keydown', pageListener);

    floatingButton().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));

    expect(pageListener).toHaveBeenCalledOnce();
    document.removeEventListener('keydown', pageListener);
  });

  it('ignores other keys', () => {
    mobileMenu.setOpen(true);
    menuItem('Abrir painel').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(menu().hidden).toBe(false);
  });

  it('removes the host on destroy', () => {
    expect(document.body.contains(mobileMenu.host)).toBe(true);
    mobileMenu.destroy();
    expect(document.body.contains(mobileMenu.host)).toBe(false);
  });
});
