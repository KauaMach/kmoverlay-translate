import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { LOAD_FAILED_TEXT, startOptionsPage } from '@/entrypoints/options/options-page';
import { NAV_ENTRIES } from '@/entrypoints/options/section-nav';
import { createDefaultSettings, saveSettings, setSiteEnabled } from '@/utils/settings';

let root: HTMLElement;

beforeEach(() => {
  fakeBrowser.reset();
  vi.restoreAllMocks();
  document.body.replaceChildren();
  root = document.createElement('div');
  document.body.append(root);
  // The fake browser does not implement commands, and types the method with its callback overload.
  vi.spyOn(fakeBrowser.commands, 'getAll').mockResolvedValue([
    { name: 'toggle-original', shortcut: 'Alt+T', description: 'Alternar original e tradução' },
    { name: 'toggle-site', shortcut: 'Alt+Shift+K', description: 'Ligar ou desligar no site atual' },
  ] as never);
});

describe('startOptionsPage', () => {
  it('renders the header, the navigation and every section of the design', async () => {
    await startOptionsPage(root);

    expect(root.querySelector('h1')?.textContent).toBe('Opções');
    expect(root.querySelector('.save-indicator')?.textContent).toBe('Alterações salvas automaticamente');
    const links = [...root.querySelectorAll('nav a')].map((link) => link.textContent);
    expect(links).toEqual(NAV_ENTRIES.map((entry) => entry.label));
    for (const entry of NAV_ENTRIES) {
      expect(root.querySelector(`section#${entry.id}`), entry.id).not.toBeNull();
    }
    await vi.waitFor(() => expect(root.querySelectorAll('.shortcut-row')).toHaveLength(2));
  });

  it('leaves out the features of future phases', async () => {
    await startOptionsPage(root);

    expect(root.textContent).not.toContain('Gerenciar glossários');
    expect(root.textContent).not.toContain('Capturar área visível');
  });

  it('shows sites turned on elsewhere (popup or shortcut) without reloading', async () => {
    await startOptionsPage(root);
    expect(root.querySelector('tr[data-host="leitor.exemplo"]')).toBeNull();

    await saveSettings(setSiteEnabled(createDefaultSettings(), 'leitor.exemplo', true));

    await vi.waitFor(() => expect(root.querySelector('tr[data-host="leitor.exemplo"]')).not.toBeNull());
  });

  it('says so when the settings cannot be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(fakeBrowser.storage.local, 'get').mockRejectedValue(new Error('storage unavailable'));

    await startOptionsPage(root);

    expect(root.querySelector('[role="alert"]')?.textContent).toBe(LOAD_FAILED_TEXT);
  });
});
