import { h } from '@/utils/dom';
import { loadSettings, watchSettings, type Settings } from '@/utils/settings';
import { createCacheSection } from './cache-section';
import { createLanguagesSection } from './languages-section';
import { createSaveIndicator } from './save-indicator';
import { createSectionNav } from './section-nav';
import { createServerSection } from './server-section';
import { createSettingsSaver } from './settings-saver';
import { createShortcutsSection } from './shortcuts-section';
import { createSitesSection } from './sites-section';
import { createTranslationSection } from './translation-section';

export const LOAD_FAILED_TEXT = 'Não foi possível carregar as opções. Feche esta aba e abra as opções de novo.';

/**
 * Builds the options page inside `root`. Every change is saved right away; the
 * sections that the popup or a shortcut can also change follow the stored
 * settings, so this page never shows stale values.
 */
export async function startOptionsPage(root: HTMLElement): Promise<void> {
  const saveIndicator = createSaveIndicator();
  const saver = createSettingsSaver({ onStateChange: (state) => saveIndicator.setState(state) });

  let settings: Settings;
  try {
    settings = await loadSettings();
  } catch (error) {
    console.error('KMOverlay: could not load the settings.', error);
    root.replaceChildren(h('p', { class: 'page-error', role: 'alert' }, [LOAD_FAILED_TEXT]));
    return;
  }

  const languages = createLanguagesSection(settings, saver);
  const sites = createSitesSection(settings, saver);
  const translation = createTranslationSection(settings, saver);
  const syncedSections = [languages, sites, translation];
  const sections = [
    createServerSection(settings, saver),
    languages.element,
    sites.element,
    translation.element,
    createShortcutsSection(),
    createCacheSection(),
  ];
  const nav = createSectionNav();

  root.replaceChildren(
    h('div', { class: 'options-page' }, [
      createHeader(saveIndicator.element),
      h('div', { class: 'options-layout' }, [nav.element, h('main', { class: 'options-content' }, sections)]),
    ]),
  );
  nav.observe(sections);
  watchSettings((next) => {
    for (const section of syncedSections) {
      section.update(next);
    }
  });
}

function createHeader(saveIndicator: HTMLElement): HTMLElement {
  return h('header', { class: 'options-header' }, [
    h('span', { class: 'brand-mark brand-mark--large', 'aria-hidden': 'true' }, ['KM']),
    h('div', { class: 'options-header__titles' }, [
      h('h1', { class: 'options-header__title' }, ['Opções']),
      h('span', { class: 'options-header__subtitle' }, ['KMOverlay Translate']),
    ]),
    saveIndicator,
  ]);
}
