import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createImageOverlay, type ImageOverlay } from '@/components/image-overlay';

let overlay: ImageOverlay;
let onShowOriginalChange: ReturnType<typeof vi.fn<(showOriginal: boolean) => void>>;
let onRetry: ReturnType<typeof vi.fn<() => void>>;

function shadow(): ShadowRoot {
  const root = overlay.host.shadowRoot;
  if (!root) {
    throw new Error('The overlay host has no open shadow root.');
  }
  return root;
}

function query<T extends Element>(selector: string): T {
  const element = shadow().querySelector<T>(selector);
  if (!element) {
    throw new Error(`Nothing matches "${selector}" in the overlay.`);
  }
  return element;
}

const progressPill = (): HTMLElement => query('.progress');
const errorPill = (): HTMLElement => query('.error');
const control = (): HTMLElement => query('.control');
const segment = (label: string): HTMLButtonElement => {
  const button = Array.from(shadow().querySelectorAll<HTMLButtonElement>('.control__segment')).find(
    (candidate) => candidate.textContent === label,
  );
  if (!button) {
    throw new Error(`No segment labelled "${label}".`);
  }
  return button;
};

beforeEach(() => {
  onShowOriginalChange = vi.fn<(showOriginal: boolean) => void>();
  onRetry = vi.fn<() => void>();
  overlay = createImageOverlay({ onShowOriginalChange, onRetry });
  document.body.append(overlay.host);
});

afterEach(() => {
  overlay.destroy();
});

describe('createImageOverlay', () => {
  it('renders in an open shadow root with its own styles and lets clicks through', () => {
    expect(overlay.host.style.pointerEvents).toBe('none');
    // Vitest does not process CSS, so `?inline` imports are empty here; only the element is checked.
    expect(shadow().firstElementChild?.tagName).toBe('STYLE');
  });

  it('shows nothing while idle', () => {
    overlay.setState({ kind: 'idle' });
    expect(progressPill().textContent).toBe('');
    expect(progressPill().className).toBe('progress');
    expect(errorPill().hidden).toBe(true);
    expect(control().hidden).toBe(true);
  });

  it('shows the queue position in a polite status pill', () => {
    overlay.setState({ kind: 'queued', position: 3 });
    const pill = progressPill();
    expect(pill.textContent).toBe('Na fila · 3ª');
    expect(pill.getAttribute('role')).toBe('status');
    expect(pill.getAttribute('aria-live')).toBe('polite');
    expect(pill.classList.contains('progress--queued')).toBe(true);
    expect(pill.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(control().hidden).toBe(true);
  });

  it('shows a spinner while translating, with the queue position when given', () => {
    overlay.setState({ kind: 'translating' });
    expect(progressPill().textContent).toBe('Traduzindo…');
    expect(progressPill().classList.contains('progress--translating')).toBe(true);
    expect(progressPill().querySelector('svg.spinner')).not.toBeNull();

    overlay.setState({ kind: 'translating', queuePosition: 2 });
    expect(progressPill().textContent).toBe('Traduzindo · 2ª na fila');
  });

  it('does not rewrite the live region when the text is unchanged', () => {
    overlay.setState({ kind: 'queued', position: 1 });
    const label = progressPill().querySelector('span');
    overlay.setState({ kind: 'queued', position: 1 });
    expect(progressPill().querySelector('span')).toBe(label);
  });

  it('clears the progress pill once the image is translated', () => {
    overlay.setState({ kind: 'translating' });
    overlay.setState({ kind: 'translated', showingOriginal: false });
    expect(progressPill().textContent).toBe('');
    expect(progressPill().getAttribute('role')).toBe('status');
  });

  it('shows the translation/original control when translated', () => {
    overlay.setState({ kind: 'translated', showingOriginal: false });
    expect(control().hidden).toBe(false);
    expect(control().getAttribute('role')).toBe('group');
    expect(query('.control__badge').textContent).toBe('KM');
    expect(query('.control__hint').textContent).toBe('Alt+T');
    expect(segment('Tradução').getAttribute('aria-pressed')).toBe('true');
    expect(segment('Original').getAttribute('aria-pressed')).toBe('false');

    overlay.setState({ kind: 'translated', showingOriginal: true });
    expect(segment('Tradução').getAttribute('aria-pressed')).toBe('false');
    expect(segment('Original').getAttribute('aria-pressed')).toBe('true');
  });

  it('reports segment clicks and updates aria-pressed', () => {
    overlay.setState({ kind: 'translated', showingOriginal: false });

    segment('Original').click();
    expect(onShowOriginalChange).toHaveBeenCalledExactlyOnceWith(true);
    expect(segment('Original').getAttribute('aria-pressed')).toBe('true');
    expect(segment('Tradução').getAttribute('aria-pressed')).toBe('false');

    segment('Tradução').click();
    expect(onShowOriginalChange).toHaveBeenLastCalledWith(false);
    expect(segment('Tradução').getAttribute('aria-pressed')).toBe('true');
  });

  it('ignores clicks on the segment that is already active', () => {
    overlay.setState({ kind: 'translated', showingOriginal: false });
    segment('Tradução').click();
    expect(onShowOriginalChange).not.toHaveBeenCalled();
  });

  it('shows the control only while the image is hovered', () => {
    overlay.setState({ kind: 'translated', showingOriginal: false });
    expect(control().classList.contains('control--visible')).toBe(false);

    overlay.setHovered(true);
    expect(control().classList.contains('control--visible')).toBe(true);

    overlay.setHovered(false);
    expect(control().classList.contains('control--visible')).toBe(false);
  });

  it('stays visible while the pointer moves from the image onto the control', () => {
    overlay.setState({ kind: 'translated', showingOriginal: false });
    overlay.setHovered(true);
    overlay.setHovered(false);
    control().dispatchEvent(new MouseEvent('mouseenter'));
    expect(control().classList.contains('control--visible')).toBe(true);

    control().dispatchEvent(new MouseEvent('mouseleave'));
    expect(control().classList.contains('control--visible')).toBe(false);
  });

  it('stays visible while keyboard focus is inside it', () => {
    overlay.setState({ kind: 'translated', showingOriginal: false });

    segment('Tradução').dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(control().classList.contains('control--visible')).toBe(true);

    segment('Tradução').dispatchEvent(
      new FocusEvent('focusout', { bubbles: true, relatedTarget: segment('Original') }),
    );
    expect(control().classList.contains('control--visible')).toBe(true);

    segment('Original').dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    expect(control().classList.contains('control--visible')).toBe(false);
  });

  it('does not stay visible after focus that came from a click', () => {
    overlay.setState({ kind: 'translated', showingOriginal: false });

    segment('Original').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    segment('Original').dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(control().classList.contains('control--visible')).toBe(false);
  });

  it('shows the error pill with a retry button', () => {
    overlay.setState({ kind: 'translating' });
    overlay.setState({ kind: 'error' });

    expect(errorPill().hidden).toBe(false);
    expect(errorPill().textContent).toContain('Falhou');
    expect(progressPill().textContent).toBe('');
    expect(control().hidden).toBe(true);

    const retry = query<HTMLButtonElement>('.error__retry');
    expect(retry.textContent).toBe('Tentar de novo');
    expect(retry.type).toBe('button');
    retry.click();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('keeps the failure reason as the tooltip of the error pill', () => {
    overlay.setState({ kind: 'error', reason: 'O Ollama não está rodando em http://127.0.0.1:11434.' });
    expect(errorPill().getAttribute('title')).toBe('O Ollama não está rodando em http://127.0.0.1:11434.');

    overlay.setState({ kind: 'error' });
    expect(errorPill().hasAttribute('title')).toBe(false);
  });

  it('hides the error pill when a new state arrives', () => {
    overlay.setState({ kind: 'error' });
    overlay.setState({ kind: 'queued', position: 1 });
    expect(errorPill().hidden).toBe(true);
  });

  it('removes the host on destroy', () => {
    expect(document.body.contains(overlay.host)).toBe(true);
    overlay.destroy();
    expect(document.body.contains(overlay.host)).toBe(false);
  });
});
