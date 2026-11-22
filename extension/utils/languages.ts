/** Languages the image pipeline can read (OCR). English is the first one implemented. */
export const SOURCE_LANGUAGES = [
  { code: 'en', label: 'Inglês' },
  { code: 'ja', label: 'Japonês' },
  { code: 'ko', label: 'Coreano' },
  { code: 'zh', label: 'Chinês' },
  { code: 'es', label: 'Espanhol' },
  { code: 'ru', label: 'Russo' },
] as const;

/** Languages offered as translation targets in the interface. */
export const TARGET_LANGUAGES = [
  { code: 'pt-BR', label: 'Português (BR)' },
  { code: 'en', label: 'Inglês' },
  { code: 'es', label: 'Espanhol' },
] as const;

/**
 * Per-site option to let the translator detect the language. It only works for
 * page text: images need a known language to pick the OCR model.
 */
export const AUTO_DETECT = 'auto';
export const AUTO_DETECT_LABEL = 'Detectar (só texto)';

/** Code of a language the image pipeline can read. */
export type SourceLanguage = (typeof SOURCE_LANGUAGES)[number]['code'];
/** Code of a language offered as translation target. */
export type TargetLanguage = (typeof TARGET_LANGUAGES)[number]['code'];
/** Source language chosen for a site, which may be automatic detection. */
export type SiteSourceLanguage = SourceLanguage | typeof AUTO_DETECT;

/** Value and visible label of a `<select>` option. */
export interface LanguageOption {
  value: string;
  label: string;
}

/** Type guard for {@link SourceLanguage}. */
export function isSourceLanguage(value: unknown): value is SourceLanguage {
  return SOURCE_LANGUAGES.some((language) => language.code === value);
}

/** Type guard for {@link TargetLanguage}. */
export function isTargetLanguage(value: unknown): value is TargetLanguage {
  return TARGET_LANGUAGES.some((language) => language.code === value);
}

/** Type guard for {@link SiteSourceLanguage}. */
export function isSiteSourceLanguage(value: unknown): value is SiteSourceLanguage {
  return value === AUTO_DETECT || isSourceLanguage(value);
}

/** Options for a per-site source language select, including automatic detection. */
export function siteSourceLanguageOptions(): LanguageOption[] {
  return [
    ...SOURCE_LANGUAGES.map(({ code, label }) => ({ value: code, label })),
    { value: AUTO_DETECT, label: AUTO_DETECT_LABEL },
  ];
}

/** Options for the default source language select (no automatic detection). */
export function sourceLanguageOptions(): LanguageOption[] {
  return SOURCE_LANGUAGES.map(({ code, label }) => ({ value: code, label }));
}

/** Options for a target language select. */
export function targetLanguageOptions(): LanguageOption[] {
  return TARGET_LANGUAGES.map(({ code, label }) => ({ value: code, label }));
}
