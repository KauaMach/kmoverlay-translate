import { h } from '@/utils/dom';

/** Color of a {@link createStatusPill}: matches the `.pill--*` modifiers. */
export type PillTone = 'success' | 'danger' | 'neutral';

/** Rounded status label with a colored dot ("Conectado", "Offline"). Styled by `.pill`. */
export function createStatusPill(tone: PillTone, text: string): HTMLSpanElement {
  return h('span', { class: `pill pill--${tone}` }, [h('span', { class: 'pill__dot', 'aria-hidden': 'true' }), text]);
}
