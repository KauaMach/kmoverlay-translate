import { h } from '@/utils/dom';
import {
  isSourceLanguage,
  isTargetLanguage,
  sourceLanguageOptions,
  targetLanguageOptions,
} from '@/utils/languages';
import type { Settings } from '@/utils/settings';
import { createSectionCard, createSelect, type SyncedSection } from './page-parts';
import type { SettingsSaver } from './settings-saver';

const TARGET_LANGUAGE_ID = 'target-language';
const DEFAULT_SOURCE_LANGUAGE_ID = 'default-source-language';

/** "Idiomas" section: target language and default source language. */
export function createLanguagesSection(settings: Settings, saver: SettingsSaver): SyncedSection {
  const targetSelect = createSelect(targetLanguageOptions(), settings.targetLanguage, { id: TARGET_LANGUAGE_ID });
  const sourceSelect = createSelect(sourceLanguageOptions(), settings.defaultSourceLanguage, {
    id: DEFAULT_SOURCE_LANGUAGE_ID,
  });

  targetSelect.addEventListener('change', () => {
    const targetLanguage = targetSelect.value;
    if (isTargetLanguage(targetLanguage)) {
      void saver.save((current) => ({ ...current, targetLanguage }));
    }
  });
  sourceSelect.addEventListener('change', () => {
    const defaultSourceLanguage = sourceSelect.value;
    if (isSourceLanguage(defaultSourceLanguage)) {
      void saver.save((current) => ({ ...current, defaultSourceLanguage }));
    }
  });

  const element = createSectionCard('idiomas', 'Idiomas', [
    h('div', { class: 'field-group' }, [
      h('div', { class: 'field' }, [
        h('label', { class: 'field__label', for: TARGET_LANGUAGE_ID }, ['Traduzir para']),
        targetSelect,
      ]),
      h('div', { class: 'field' }, [
        h('label', { class: 'field__label', for: DEFAULT_SOURCE_LANGUAGE_ID }, ['Idioma de origem padrão']),
        sourceSelect,
      ]),
    ]),
    h('p', { class: 'field__hint' }, ['Cada site pode ter o próprio idioma de origem, na seção Sites.']),
  ]);

  return {
    element,
    update(next) {
      targetSelect.value = next.targetLanguage;
      sourceSelect.value = next.defaultSourceLanguage;
    },
  };
}
