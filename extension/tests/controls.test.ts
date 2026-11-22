import { describe, expect, it, vi } from 'vitest';
import { createStatusPill } from '@/components/status-pill';
import { createToggleSwitch } from '@/components/toggle-switch';
import { createIcon, createSpinner } from '@/utils/icons';
import {
  AUTO_DETECT,
  isSiteSourceLanguage,
  isSourceLanguage,
  isTargetLanguage,
  siteSourceLanguageOptions,
  sourceLanguageOptions,
  targetLanguageOptions,
} from '@/utils/languages';

describe('createToggleSwitch', () => {
  it('is a labelled switch that flips and reports the new value', () => {
    const onChange = vi.fn();
    const toggle = createToggleSwitch({ label: 'Ativar neste site', checked: false, onChange });

    expect(toggle.element.getAttribute('role')).toBe('switch');
    expect(toggle.element.getAttribute('aria-label')).toBe('Ativar neste site');
    expect(toggle.element.getAttribute('aria-checked')).toBe('false');

    toggle.element.click();

    expect(toggle.element.getAttribute('aria-checked')).toBe('true');
    expect(toggle.isChecked()).toBe(true);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('changes state from code without calling onChange', () => {
    const onChange = vi.fn();
    const toggle = createToggleSwitch({ label: 'Imagens', checked: true, onChange });

    toggle.setChecked(false);

    expect(toggle.element.getAttribute('aria-checked')).toBe('false');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('ignores clicks while disabled', () => {
    const onChange = vi.fn();
    const toggle = createToggleSwitch({ label: 'Texto', checked: false, disabled: true, onChange });

    toggle.element.dispatchEvent(new MouseEvent('click'));

    expect(toggle.isChecked()).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('createStatusPill', () => {
  it('shows the text with a decorative dot in the given tone', () => {
    const pill = createStatusPill('success', 'Conectado');

    expect(pill.className).toBe('pill pill--success');
    expect(pill.textContent).toBe('Conectado');
    expect(pill.querySelector('.pill__dot')?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('icons', () => {
  it('creates decorative icons by default and labelled ones on request', () => {
    const decorative = createIcon('settings');
    const labelled = createIcon('trash', { size: 18, label: 'Remover' });

    expect(decorative.getAttribute('aria-hidden')).toBe('true');
    expect(decorative.getAttribute('width')).toBe('20');
    expect(labelled.getAttribute('role')).toBe('img');
    expect(labelled.getAttribute('aria-label')).toBe('Remover');
    expect(labelled.getAttribute('width')).toBe('18');
    expect(labelled.querySelectorAll('path').length).toBeGreaterThan(0);
  });

  it('creates the spinner with the class that animates it', () => {
    const spinner = createSpinner(14);

    expect(spinner.getAttribute('class')).toBe('spinner');
    expect(spinner.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('languages', () => {
  it('offers the design languages, with detection only per site', () => {
    expect(sourceLanguageOptions().map((option) => option.label)).toEqual([
      'Inglês',
      'Japonês',
      'Coreano',
      'Chinês',
      'Espanhol',
      'Russo',
    ]);
    expect(targetLanguageOptions().map((option) => option.value)).toEqual(['pt-BR', 'en', 'es']);
    expect(siteSourceLanguageOptions().at(-1)).toEqual({ value: AUTO_DETECT, label: 'Detectar (só texto)' });
  });

  it('validates language codes', () => {
    expect(isSourceLanguage('ja')).toBe(true);
    expect(isSourceLanguage(AUTO_DETECT)).toBe(false);
    expect(isSiteSourceLanguage(AUTO_DETECT)).toBe(true);
    expect(isTargetLanguage('pt-BR')).toBe(true);
    expect(isTargetLanguage('fr')).toBe(false);
  });
});
