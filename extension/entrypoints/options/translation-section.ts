import { createToggleSwitch, type ToggleSwitch } from '@/components/toggle-switch';
import { h } from '@/utils/dom';
import type { Settings } from '@/utils/settings';
import { createSectionCard, type SyncedSection } from './page-parts';
import type { SettingsSaver } from './settings-saver';

type TranslationPreferenceKey = 'translateOnomatopoeia' | 'usePreviousPageContext' | 'shrinkOverflowingText';

interface TranslationPreference {
  key: TranslationPreferenceKey;
  title: string;
  description: string;
}

/** On/off preferences of the "Tradução" section, in the order of the design. */
export const TRANSLATION_PREFERENCES: readonly TranslationPreference[] = [
  {
    key: 'translateOnomatopoeia',
    title: 'Traduzir onomatopeias',
    description: 'Sons e efeitos desenhados fora dos balões.',
  },
  {
    key: 'usePreviousPageContext',
    title: 'Usar a página anterior como contexto',
    description: 'Mantém nomes e diálogos consistentes entre páginas.',
  },
  {
    key: 'shrinkOverflowingText',
    title: 'Reduzir a fonte quando o texto não couber',
    description: 'Só no texto da página; as imagens já ajustam sozinhas.',
  },
];

/** "Tradução" section: one switch row per preference. */
export function createTranslationSection(settings: Settings, saver: SettingsSaver): SyncedSection {
  const switches = new Map<TranslationPreferenceKey, ToggleSwitch>();
  const rows = TRANSLATION_PREFERENCES.map((preference) => {
    const descriptionId = `${preference.key}-description`;
    const toggle = createToggleSwitch({
      label: preference.title,
      checked: settings[preference.key],
      onChange: (checked) => {
        void saver.save((current) => ({ ...current, [preference.key]: checked }));
      },
    });
    toggle.element.setAttribute('aria-describedby', descriptionId);
    switches.set(preference.key, toggle);
    return h('div', { class: 'preference-row' }, [
      h('div', { class: 'preference-row__text' }, [
        h('span', { class: 'preference-row__title' }, [preference.title]),
        h('span', { id: descriptionId, class: 'preference-row__description' }, [preference.description]),
      ]),
      toggle.element,
    ]);
  });

  return {
    element: createSectionCard('traducao', 'Tradução', rows, 'list'),
    update(next) {
      for (const [key, toggle] of switches) {
        toggle.setChecked(next[key]);
      }
    },
  };
}
