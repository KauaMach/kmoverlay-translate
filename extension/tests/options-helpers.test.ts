import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CACHE_CLEARED_TEXT,
  CACHE_CLEAR_FAILED_TEXT,
  CACHE_CLEAR_PENDING_TEXT,
  CONFIRM_CLEAR_CACHE_TEXT,
  SIZE_UNAVAILABLE_TEXT,
  createCacheSection,
  describeCacheUsage,
  type CacheSectionDependencies,
} from '@/entrypoints/options/cache-section';
import { debounce } from '@/entrypoints/options/debounce';
import { IMAGE_CACHE_DATABASE_NAME } from '@/utils/image-cache';
import { chooseActiveSection, createSectionNav } from '@/entrypoints/options/section-nav';
import { createSettingsSaver, type SaveState, type SettingsChange } from '@/entrypoints/options/settings-saver';
import {
  CHROME_SHORTCUTS_URL,
  FIREFOX_SHORTCUTS_HELP,
  resolveShortcutSettingsAction,
  toShortcutRows,
} from '@/entrypoints/options/shortcuts-section';
import { createDefaultSettings, type Settings } from '@/utils/settings';

const DELAY_MS = 500;
const MEGABYTE = 1024 * 1024;

describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs once, with the last arguments, after the calls stop', () => {
    const callback = vi.fn();
    const delayed = debounce(callback, DELAY_MS);

    delayed.call('h');
    vi.advanceTimersByTime(DELAY_MS - 100);
    delayed.call('ht');
    vi.advanceTimersByTime(DELAY_MS - 1);
    expect(callback).not.toHaveBeenCalled();
    expect(delayed.isPending()).toBe(true);

    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith('ht');
    expect(delayed.isPending()).toBe(false);
  });

  it('runs the waiting call on flush and drops it on cancel', () => {
    const callback = vi.fn();
    const delayed = debounce(callback, DELAY_MS);

    delayed.call('first');
    delayed.flush();
    expect(callback).toHaveBeenCalledWith('first');

    delayed.call('second');
    delayed.cancel();
    vi.advanceTimersByTime(DELAY_MS * 2);
    delayed.flush();
    expect(callback).toHaveBeenCalledTimes(1);
  });
});

describe('createSettingsSaver', () => {
  const applyToDefaults = async (change: SettingsChange): Promise<Settings> => change(createDefaultSettings());

  function setup(update: (change: SettingsChange) => Promise<Settings>) {
    const states: SaveState[] = [];
    const saver = createSettingsSaver({ onStateChange: (state) => states.push(state), update, debounceMs: DELAY_MS });
    return { saver, states };
  }

  it('reports "saving" and then "saved"', async () => {
    const { saver, states } = setup(applyToDefaults);

    await expect(saver.save((current) => ({ ...current, token: 'abc' }))).resolves.toBe(true);

    expect(states).toEqual(['saving', 'saved']);
    expect(saver.isBusy()).toBe(false);
  });

  it('reports "error" and resolves to false when the write fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { saver, states } = setup(async () => {
      throw new Error('quota exceeded');
    });

    await expect(saver.save((current) => current)).resolves.toBe(false);

    expect(states).toEqual(['saving', 'error']);
  });

  it('saves a delayed change once with the last value, and flush saves it at once', async () => {
    const update = vi.fn(applyToDefaults);
    const { saver } = setup(update);

    saver.saveLater('token', () => (current) => ({ ...current, token: 'a' }));
    saver.saveLater('token', () => (current) => ({ ...current, token: 'ab' }));
    expect(saver.isBusy()).toBe(true);

    await expect(saver.flush()).resolves.toBe(true);

    expect(update).toHaveBeenCalledOnce();
    const change = update.mock.lastCall?.[0];
    expect(change?.(createDefaultSettings()).token).toBe('ab');
    expect(saver.isBusy()).toBe(false);
  });

  it('saves nothing when the delayed change is not valid', async () => {
    const update = vi.fn(applyToDefaults);
    const { saver } = setup(update);

    saver.saveLater('serverUrl', () => null);
    await saver.flush();

    expect(update).not.toHaveBeenCalled();
    expect(saver.isBusy()).toBe(false);
  });
});

describe('chooseActiveSection', () => {
  it('highlights the first section, in page order, inside the reading band', () => {
    expect(chooseActiveSection(['servidor', 'idiomas', 'sites'], new Set(['sites', 'idiomas']), 'servidor')).toBe(
      'idiomas',
    );
  });

  it('keeps the current section when none is inside the band', () => {
    expect(chooseActiveSection(['servidor', 'idiomas'], new Set(), 'idiomas')).toBe('idiomas');
  });
});

describe('createSectionNav', () => {
  it('starts on the first section and follows the clicks', () => {
    const nav = createSectionNav([
      { id: 'servidor', label: 'Servidor' },
      { id: 'idiomas', label: 'Idiomas' },
    ]);
    const [server, languages] = nav.element.querySelectorAll('a');

    expect(nav.element.getAttribute('aria-label')).toBe('Seções');
    expect(server?.getAttribute('href')).toBe('#servidor');
    expect(server?.getAttribute('aria-current')).toBe('true');
    expect(languages?.hasAttribute('aria-current')).toBe(false);

    languages?.click();

    expect(languages?.getAttribute('aria-current')).toBe('true');
    expect(server?.hasAttribute('aria-current')).toBe(false);
  });
});

describe('toShortcutRows', () => {
  it('lists the extension commands and leaves out the ones the browser adds', () => {
    const rows = toShortcutRows([
      { name: '_execute_action', shortcut: 'Alt+P', description: '' },
      { name: 'toggle-original', shortcut: 'Alt+T', description: 'Alternar original e tradução' },
      { name: 'toggle-site', shortcut: '', description: 'Ligar ou desligar no site atual' },
    ]);

    expect(rows).toEqual([
      { description: 'Alternar original e tradução', shortcut: 'Alt+T' },
      { description: 'Ligar ou desligar no site atual', shortcut: null },
    ]);
  });
});

describe('resolveShortcutSettingsAction', () => {
  it('opens the shortcut page of Chrome in a tab', () => {
    expect(resolveShortcutSettingsAction(false, {})).toEqual({ kind: 'open-tab', url: CHROME_SHORTCUTS_URL });
  });

  it('uses openShortcutSettings on Firefox versions that have it', async () => {
    const commandsApi = { openShortcutSettings: vi.fn(async () => undefined) };

    const action = resolveShortcutSettingsAction(true, commandsApi);
    expect(action.kind).toBe('open-firefox-settings');
    if (action.kind === 'open-firefox-settings') {
      await action.open();
    }

    expect(commandsApi.openShortcutSettings).toHaveBeenCalledOnce();
  });

  it('explains the way on older Firefox versions', () => {
    expect(resolveShortcutSettingsAction(true, {})).toEqual({ kind: 'show-help', text: FIREFOX_SHORTCUTS_HELP });
  });
});

describe('describeCacheUsage', () => {
  it('shows the size and the number of pages, as in the design', () => {
    expect(describeCacheUsage({ bytes: 148 * MEGABYTE, pages: 312 })).toBe('148 MB · 312 páginas traduzidas');
    expect(describeCacheUsage({ bytes: 512 * 1024, pages: 1 })).toBe('512 KB · 1 página traduzida');
  });

  it('says when the cache cannot be read', () => {
    expect(describeCacheUsage(null)).toBe(SIZE_UNAVAILABLE_TEXT);
  });
});

describe('createCacheSection', () => {
  function setup(overrides: Partial<CacheSectionDependencies> = {}) {
    const dependencies = {
      stats: vi.fn(async () => ({ bytes: 2 * MEGABYTE, pages: 3 })),
      confirm: vi.fn(() => true),
      deleteDatabase: vi.fn(async () => 'deleted' as const),
      ...overrides,
    };
    const section = createCacheSection(dependencies);
    document.body.replaceChildren(section);
    const button = section.querySelector('button');
    if (button === null) {
      throw new Error('The cache section has no button.');
    }
    const status = (): string | null | undefined => section.querySelector('[role="status"]')?.textContent;
    const usage = (): string | null | undefined => section.querySelector('.cache-row__usage')?.textContent;
    return { section, dependencies, button, status, usage };
  }

  it('shows the space this browser uses', async () => {
    const { usage, section } = setup();

    await vi.waitFor(() => expect(usage()).toBe('2 MB · 3 páginas traduzidas'));
    expect(section.textContent).toContain('O cache do servidor é compartilhado entre PC e celular e não é apagado aqui.');
  });

  it('asks before deleting and keeps the cache when the user cancels', () => {
    const { button, dependencies } = setup({ confirm: vi.fn(() => false) });

    button.click();

    expect(dependencies.confirm).toHaveBeenCalledWith(CONFIRM_CLEAR_CACHE_TEXT);
    expect(dependencies.deleteDatabase).not.toHaveBeenCalled();
  });

  it('deletes the image cache database and reads the size again', async () => {
    const { button, dependencies, status } = setup();

    button.click();

    await vi.waitFor(() => expect(status()).toBe(CACHE_CLEARED_TEXT));
    expect(dependencies.deleteDatabase).toHaveBeenCalledWith(IMAGE_CACHE_DATABASE_NAME);
    await vi.waitFor(() => expect(dependencies.stats).toHaveBeenCalledTimes(2));
  });

  it('explains a deletion that waits for open pages', async () => {
    const { button, status } = setup({ deleteDatabase: vi.fn(async () => 'blocked' as const) });

    button.click();

    await vi.waitFor(() => expect(status()).toBe(CACHE_CLEAR_PENDING_TEXT));
  });

  it('says when the cache could not be cleared', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { button, status } = setup({
      deleteDatabase: vi.fn(async () => {
        throw new Error('disk error');
      }),
    });

    button.click();

    await vi.waitFor(() => expect(status()).toBe(CACHE_CLEAR_FAILED_TEXT));
  });
});
