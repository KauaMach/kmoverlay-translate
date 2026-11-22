import { createToggleSwitch } from '@/components/toggle-switch';
import { h } from '@/utils/dom';
import { createIcon } from '@/utils/icons';
import { isSiteSourceLanguage, siteSourceLanguageOptions } from '@/utils/languages';
import {
  listEnabledSites,
  removeSite,
  updateSite,
  type Settings,
  type SiteSettings,
} from '@/utils/settings';
import { createSectionCard, createSelect, type SyncedSection } from './page-parts';
import type { SettingsSaver } from './settings-saver';

export const NO_SITES_TEXT = 'Nenhum site ainda.';

const REMOVE_ICON_SIZE = 18;

interface SiteRow {
  element: HTMLTableRowElement;
  update(site: SiteSettings): void;
  focusRemoveButton(): void;
}

/**
 * "Sites" section: one table row per enabled site. Rows are updated in place
 * (keyed by hostname) so a change made in the popup does not steal the focus
 * of someone using the table.
 */
export function createSitesSection(settings: Settings, saver: SettingsSaver): SyncedSection {
  const rows = new Map<string, SiteRow>();
  const tableBody = h('tbody');
  const tableWrapper = h('div', { class: 'sites-table-wrapper' }, [
    h('table', { class: 'sites-table' }, [
      h('thead', {}, [
        h('tr', {}, [
          h('th', { scope: 'col' }, ['Site']),
          h('th', { scope: 'col' }, ['Imagens']),
          h('th', { scope: 'col' }, ['Texto']),
          h('th', { scope: 'col' }, ['Idioma de origem']),
          h('th', { scope: 'col' }, [h('span', { class: 'visually-hidden' }, ['Ações'])]),
        ]),
      ]),
      tableBody,
    ]),
  ]);
  const emptyState = h('p', { class: 'sites-empty' }, [NO_SITES_TEXT]);
  const element = createSectionCard('sites', 'Sites', [
    tableWrapper,
    emptyState,
    h('p', { class: 'field__hint' }, ['Um site entra nesta lista quando você ativa a extensão nele pelo popup.']),
  ]);
  const heading = element.querySelector('h2');

  const showEmptyState = (): void => {
    const empty = rows.size === 0;
    tableWrapper.hidden = empty;
    emptyState.hidden = !empty;
  };

  const remove = (host: string): void => {
    const row = rows.get(host);
    if (row === undefined) {
      return;
    }
    const neighbor = findNeighborRow(row.element, rows);
    row.element.remove();
    rows.delete(host);
    showEmptyState();
    // Focus would otherwise fall back to the top of the page with the removed button.
    if (neighbor !== undefined) {
      neighbor.focusRemoveButton();
    } else {
      heading?.focus();
    }
    void saver.save((current) => removeSite(current, host));
  };

  const update = (next: Settings): void => {
    const sites = listEnabledSites(next);
    const hosts = new Set(sites.map(([host]) => host));
    for (const [host, row] of rows) {
      if (!hosts.has(host)) {
        row.element.remove();
        rows.delete(host);
      }
    }
    sites.forEach(([host, site], index) => {
      let row = rows.get(host);
      if (row === undefined) {
        row = createSiteRow(host, site, saver, remove);
        rows.set(host, row);
      } else {
        row.update(site);
      }
      // Moving a row that is already in place would blur a focused control inside it.
      const rowAtIndex = tableBody.children[index];
      if (rowAtIndex !== row.element) {
        tableBody.insertBefore(row.element, rowAtIndex ?? null);
      }
    });
    showEmptyState();
  };

  update(settings);
  return { element, update };
}

function createSiteRow(
  host: string,
  site: SiteSettings,
  saver: SettingsSaver,
  onRemove: (host: string) => void,
): SiteRow {
  const imagesSwitch = createToggleSwitch({
    label: `Imagens em ${host}`,
    checked: site.images,
    onChange: (images) => {
      void saver.save((current) => updateSite(current, host, { images }));
    },
  });
  const textSwitch = createToggleSwitch({
    label: `Texto em ${host}`,
    checked: site.text,
    onChange: (text) => {
      void saver.save((current) => updateSite(current, host, { text }));
    },
  });
  const languageSelect = createSelect(siteSourceLanguageOptions(), site.sourceLanguage, {
    'aria-label': `Idioma de origem em ${host}`,
  });
  languageSelect.addEventListener('change', () => {
    const sourceLanguage = languageSelect.value;
    if (isSiteSourceLanguage(sourceLanguage)) {
      void saver.save((current) => updateSite(current, host, { sourceLanguage }));
    }
  });
  const removeButton = h(
    'button',
    { type: 'button', class: 'button button--icon', 'aria-label': `Remover ${host}`, onClick: () => onRemove(host) },
    [createIcon('trash', { size: REMOVE_ICON_SIZE })],
  );

  // In a table cell the switch lines up with its column header, not with the end of the cell.
  imagesSwitch.element.classList.add('switch--start');
  textSwitch.element.classList.add('switch--start');

  const element = h('tr', { 'data-host': host }, [
    h('td', { class: 'sites-table__host' }, [host]),
    h('td', {}, [imagesSwitch.element]),
    h('td', {}, [textSwitch.element]),
    h('td', {}, [languageSelect]),
    h('td', { class: 'sites-table__actions' }, [removeButton]),
  ]);

  return {
    element,
    update(next) {
      imagesSwitch.setChecked(next.images);
      textSwitch.setChecked(next.text);
      languageSelect.value = next.sourceLanguage;
    },
    focusRemoveButton: () => removeButton.focus(),
  };
}

/** The row after `rowElement`, or the one before it when it is the last. */
function findNeighborRow(rowElement: HTMLTableRowElement, rows: Map<string, SiteRow>): SiteRow | undefined {
  const neighborElement = rowElement.nextElementSibling ?? rowElement.previousElementSibling;
  const neighborHost = neighborElement?.getAttribute('data-host');
  return neighborHost ? rows.get(neighborHost) : undefined;
}
