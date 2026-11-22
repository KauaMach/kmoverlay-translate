import { h, type Attributes, type Child } from '@/utils/dom';
import type { LanguageOption } from '@/utils/languages';
import type { Settings } from '@/utils/settings';

/** Spacing variants of the section cards in the design. */
export type SectionCardLayout = 'form' | 'list' | 'compact';

/** A section of the options page that can show settings changed elsewhere (popup, shortcut). */
export interface SyncedSection {
  element: HTMLElement;
  update(settings: Settings): void;
}

/**
 * White card with a heading, one per entry of the section navigation. The
 * heading can take focus so focus has somewhere to go when a row is removed.
 */
export function createSectionCard(
  id: string,
  title: string,
  children: Child[],
  layout: SectionCardLayout = 'form',
): HTMLElement {
  const headingId = `${id}-title`;
  return h('section', { id, class: `section-card section-card--${layout}`, 'aria-labelledby': headingId }, [
    h('h2', { id: headingId, class: 'section-card__title', tabindex: '-1' }, [title]),
    ...children,
  ]);
}

/** A `<select>` with the given options and the matching one selected. */
export function createSelect(
  options: readonly LanguageOption[],
  value: string,
  attributes: Attributes = {},
): HTMLSelectElement {
  return h(
    'select',
    { class: 'select', ...attributes },
    options.map((option) => h('option', { value: option.value, selected: option.value === value }, [option.label])),
  );
}
