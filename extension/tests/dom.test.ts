import { describe, expect, it, vi } from 'vitest';
import { h } from '@/utils/dom';

describe('h', () => {
  it('sets attributes, booleans and ARIA values', () => {
    const button = h('button', {
      type: 'button',
      class: 'button',
      tabindex: 0,
      disabled: true,
      hidden: false,
      title: null,
      'aria-expanded': true,
      'aria-pressed': 'false',
    });

    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('tabindex')).toBe('0');
    expect(button.getAttribute('disabled')).toBe('');
    expect(button.hasAttribute('hidden')).toBe(false);
    expect(button.hasAttribute('title')).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.getAttribute('aria-pressed')).toBe('false');
  });

  it('turns on* functions into event listeners', () => {
    const onClick = vi.fn();
    const button = h('button', { onClick });

    button.click();

    expect(onClick).toHaveBeenCalledOnce();
    expect(button.hasAttribute('onclick')).toBe(false);
  });

  it('appends children, skipping empty ones', () => {
    const list = h('ul', {}, [h('li', {}, ['um']), null, undefined, false, 'texto']);

    expect(list.children).toHaveLength(1);
    expect(list.textContent).toBe('umtexto');
  });

  it('never parses text as HTML', () => {
    const paragraph = h('p', {}, ['<img src=x onerror="alert(1)">']);

    expect(paragraph.children).toHaveLength(0);
    expect(paragraph.textContent).toBe('<img src=x onerror="alert(1)">');
  });

  it('refuses functions on other attributes and strings on event attributes', () => {
    expect(() => h('div', { title: () => undefined })).toThrow('non-event attribute "title"');
    expect(() => h('div', { onclick: 'alert(1)' })).toThrow('event attribute "onclick"');
  });
});
