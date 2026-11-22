import { h } from '@/utils/dom';

/** One entry of the side navigation: the id of a section card and its label. */
export interface NavEntry {
  id: string;
  label: string;
}

/** Sections of the options page, in page order. The ids match the section cards. */
export const NAV_ENTRIES: readonly NavEntry[] = [
  { id: 'servidor', label: 'Servidor' },
  { id: 'idiomas', label: 'Idiomas' },
  { id: 'sites', label: 'Sites' },
  { id: 'traducao', label: 'Tradução' },
  { id: 'atalhos', label: 'Atalhos' },
  { id: 'cache', label: 'Cache' },
];

/** Band at the top of the viewport where a section counts as the one being read. */
const READING_BAND_ROOT_MARGIN = '0px 0px -60% 0px';

/** Side navigation with the section being read highlighted. */
export interface SectionNav {
  element: HTMLElement;
  /** Starts following the scroll position over these section elements. */
  observe(sections: readonly HTMLElement[]): void;
  setActive(id: string): void;
}

/**
 * Section to highlight: the first one, in page order, inside the reading band.
 * Between two sections none is inside it, so the current one stays highlighted.
 */
export function chooseActiveSection(
  orderedIds: readonly string[],
  visibleIds: ReadonlySet<string>,
  currentId: string,
): string {
  return orderedIds.find((id) => visibleIds.has(id)) ?? currentId;
}

/** Builds the "Seções" navigation of the options page. */
export function createSectionNav(entries: readonly NavEntry[] = NAV_ENTRIES): SectionNav {
  const links = new Map<string, HTMLAnchorElement>();
  for (const entry of entries) {
    links.set(entry.id, h('a', { class: 'section-nav__link', href: `#${entry.id}` }, [entry.label]));
  }
  const element = h('nav', { class: 'section-nav', 'aria-label': 'Seções' }, [...links.values()]);
  let activeId = entries[0]?.id ?? '';

  const setActive = (id: string): void => {
    activeId = id;
    for (const [linkId, link] of links) {
      if (linkId === id) {
        link.setAttribute('aria-current', 'true');
      } else {
        link.removeAttribute('aria-current');
      }
    }
  };

  for (const [id, link] of links) {
    link.addEventListener('click', () => setActive(id));
  }

  const observe = (sections: readonly HTMLElement[]): void => {
    // Without IntersectionObserver the highlight simply follows the clicks.
    if (typeof IntersectionObserver === 'undefined') {
      return;
    }
    const orderedIds = entries.map((entry) => entry.id);
    const visibleIds = new Set<string>();
    const observer = new IntersectionObserver(
      (changes) => {
        for (const change of changes) {
          if (change.isIntersecting) {
            visibleIds.add(change.target.id);
          } else {
            visibleIds.delete(change.target.id);
          }
        }
        setActive(chooseActiveSection(orderedIds, visibleIds, activeId));
      },
      { rootMargin: READING_BAND_ROOT_MARGIN },
    );
    for (const section of sections) {
      observer.observe(section);
    }
  };

  setActive(activeId);
  return { element, observe, setActive };
}
