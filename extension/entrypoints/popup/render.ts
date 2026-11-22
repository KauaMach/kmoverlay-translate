import { createStatusPill } from '@/components/status-pill';
import { createToggleSwitch } from '@/components/toggle-switch';
import { h } from '@/utils/dom';
import { createIcon, createSpinner } from '@/utils/icons';
import {
  CHECKING_LABEL,
  type ConnectedViewModel,
  type LanguageSelectView,
  type PageView,
  type PopupViewModel,
  type ProblemView,
  type ProblemViewModel,
  type SiteView,
} from './view-model';

/** User actions the popup forwards to its controller. */
export interface PopupHandlers {
  onOpenOptions(): void;
  onRetry(): void;
  onSiteEnabledChange(enabled: boolean): void;
  onImagesChange(enabled: boolean): void;
  onTextChange(enabled: boolean): void;
  onSourceLanguageChange(value: string): void;
  onTargetLanguageChange(value: string): void;
  onToggleOriginal(): void;
}

/** Popup on screen. The header, live region and footer persist across renders. */
export interface PopupView {
  render(model: PopupViewModel): void;
  /** Shows an error message above the content, or hides it with `null`. */
  showError(message: string | null): void;
}

/** Ids of the controls, also used to keep keyboard focus across renders. */
export const CONTROL_IDS = {
  optionsButton: 'options-button',
  siteSwitch: 'site-enabled-switch',
  imagesSwitch: 'images-switch',
  textSwitch: 'text-switch',
  sourceLanguage: 'source-language',
  targetLanguage: 'target-language',
  toggleOriginal: 'toggle-original-button',
  retry: 'retry-button',
  openOptions: 'open-options-button',
} as const;

const TOGGLE_ORIGINAL_SHORTCUT = 'Alt+T';
const CHAPTER_TITLE_ID = 'chapter-title';
const HEADER_ICON_SIZE = 20;
const LANGUAGE_ARROW_SIZE = 18;
const PROBLEM_ICON_SIZE = 20;
const MEANWHILE_ICON_SIZE = 18;
const MEANWHILE_CHECK_STROKE = 2.2;
const RETRY_SPINNER_SIZE = 18;

/** Builds the popup shell inside `root` and returns a view that renders view models into it. */
export function createPopupView(root: HTMLElement, handlers: PopupHandlers): PopupView {
  const status = h('div', { class: 'popup__status', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const errorMessage = h('p', { class: 'popup__error', role: 'alert', hidden: true });
  const content = h('main', { class: 'popup__content' });
  const footer = h('footer', { class: 'popup__footer' });
  const header = h('header', { class: 'popup__header' }, [
    h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, ['KM']),
    h('h1', { class: 'popup__title' }, ['KMOverlay']),
    status,
    h(
      'button',
      {
        type: 'button',
        id: CONTROL_IDS.optionsButton,
        class: 'button button--icon',
        'aria-label': 'Opções',
        onClick: () => handlers.onOpenOptions(),
      },
      [createIcon('settings', { size: HEADER_ICON_SIZE })],
    ),
  ]);
  root.replaceChildren(h('div', { class: 'popup' }, [header, errorMessage, content, footer]));

  return {
    render(model) {
      const focusedId = findFocusedControlId(root);
      status.replaceChildren(createStatusPill(model.connection.tone, model.connection.label));
      content.replaceChildren(
        ...(model.layout === 'connected' ? renderConnected(model, handlers) : renderProblem(model, handlers)),
      );
      footer.textContent = model.footer;
      restoreFocus(root, focusedId);
    },
    showError(message) {
      errorMessage.textContent = message ?? '';
      errorMessage.hidden = message === null;
    },
  };
}

function renderConnected(model: ConnectedViewModel, handlers: PopupHandlers): HTMLElement[] {
  const sections = [
    renderSite(model.site, handlers),
    h('section', { class: 'popup__section popup__languages', 'aria-label': 'Idiomas' }, [
      renderLanguageField('De', CONTROL_IDS.sourceLanguage, model.languages.source, handlers.onSourceLanguageChange),
      h('span', { class: 'popup__languages-arrow' }, [createIcon('arrowRight', { size: LANGUAGE_ARROW_SIZE })]),
      renderLanguageField('Para', CONTROL_IDS.targetLanguage, model.languages.target, handlers.onTargetLanguageChange),
    ]),
  ];
  if (model.page !== null) {
    sections.push(...renderPage(model.page, handlers));
  }
  return sections;
}

function renderSite(site: SiteView, handlers: PopupHandlers): HTMLElement {
  if (site.kind === 'unavailable') {
    return h('section', { class: 'popup__section popup__site' }, [
      h('div', { class: 'popup__site-row' }, [h('p', { class: 'popup__site-host' }, [site.message])]),
    ]);
  }
  const siteSwitch = createToggleSwitch({
    label: 'Ativar neste site',
    checked: site.enabled,
    onChange: handlers.onSiteEnabledChange,
  });
  siteSwitch.element.id = CONTROL_IDS.siteSwitch;
  return h('section', { class: 'popup__section popup__site', 'aria-label': 'Site atual' }, [
    h('div', { class: 'popup__site-row' }, [renderSiteSummary(site), siteSwitch.element]),
    h('div', { class: `popup__site-options${site.contentTogglesDisabled ? ' popup__dimmed' : ''}` }, [
      renderOptionRow('Imagens (balões)', 'Traduzir imagens', CONTROL_IDS.imagesSwitch, site.images, site, handlers.onImagesChange),
      renderOptionRow('Texto da página', 'Traduzir texto da página', CONTROL_IDS.textSwitch, site.text, site, handlers.onTextChange),
    ]),
  ]);
}

function renderSiteSummary(site: Extract<SiteView, { kind: 'site' }>): HTMLElement {
  return h('div', { class: 'popup__site-summary' }, [
    h('p', { class: 'popup__site-host', title: site.host }, [site.host]),
    h('p', { class: 'popup__site-subtitle' }, [site.subtitle]),
  ]);
}

function renderOptionRow(
  text: string,
  label: string,
  id: string,
  checked: boolean,
  site: Extract<SiteView, { kind: 'site' }>,
  onChange: (checked: boolean) => void,
): HTMLElement {
  const toggle = createToggleSwitch({ label, checked, disabled: site.contentTogglesDisabled, onChange });
  toggle.element.id = id;
  return h('div', { class: 'popup__option-row' }, [h('span', { class: 'popup__option-label' }, [text]), toggle.element]);
}

function renderLanguageField(
  labelText: string,
  id: string,
  view: LanguageSelectView,
  onChange: (value: string) => void,
): HTMLElement {
  const select = h(
    'select',
    { id, class: 'select', disabled: view.disabled },
    view.options.map((option) => h('option', { value: option.value }, [option.label])),
  );
  select.value = view.value;
  select.addEventListener('change', () => onChange(select.value));
  return h('div', { class: 'field popup__language-field' }, [
    h('label', { class: 'field__label popup__language-label', for: id }, [labelText]),
    select,
  ]);
}

function renderPage(page: PageView, handlers: PopupHandlers): HTMLElement[] {
  const fill = h('div', { class: 'popup__progress-fill' });
  fill.style.width = `${page.progressPercent}%`;
  return [
    h('section', { class: 'popup__section popup__chapter', 'aria-labelledby': CHAPTER_TITLE_ID }, [
      h('div', { class: 'popup__chapter-header' }, [
        h('h2', { class: 'popup__chapter-title', id: CHAPTER_TITLE_ID }, ['Neste capítulo']),
        h('span', { class: 'popup__chapter-count' }, [page.progressLabel]),
      ]),
      h(
        'div',
        {
          class: 'popup__progress',
          role: 'progressbar',
          'aria-labelledby': CHAPTER_TITLE_ID,
          'aria-valuemin': '0',
          'aria-valuemax': String(page.totalImages),
          'aria-valuenow': String(page.translatedImages),
          'aria-valuetext': page.progressLabel,
        },
        [fill],
      ),
      h('p', { class: 'popup__hint' }, ['As próximas páginas são preparadas antes de você chegar nelas.']),
    ]),
    h('div', { class: 'popup__actions' }, [
      h(
        'button',
        {
          type: 'button',
          id: CONTROL_IDS.toggleOriginal,
          class: 'button button--primary popup__toggle-original',
          'aria-keyshortcuts': TOGGLE_ORIGINAL_SHORTCUT,
          onClick: () => handlers.onToggleOriginal(),
        },
        [
          h('span', {}, [page.toggleLabel]),
          h('kbd', { class: 'kbd popup__kbd-on-accent', 'aria-hidden': 'true' }, [TOGGLE_ORIGINAL_SHORTCUT]),
        ],
      ),
    ]),
  ];
}

function renderProblem(model: ProblemViewModel, handlers: PopupHandlers): HTMLElement[] {
  return [
    h('div', { class: 'popup__problem' }, [
      renderProblemCard(model.problem),
      h('div', { class: 'popup__problem-actions' }, [
        renderRetryButton(model.problem.retrying, handlers),
        h(
          'button',
          {
            type: 'button',
            id: CONTROL_IDS.openOptions,
            class: 'button popup__problem-button',
            onClick: () => handlers.onOpenOptions(),
          },
          ['Abrir opções'],
        ),
      ]),
    ]),
    h('section', { class: 'popup__section popup__meanwhile', 'aria-labelledby': 'meanwhile-title' }, [
      h('h2', { class: 'popup__meanwhile-title', id: 'meanwhile-title' }, ['Enquanto isso']),
      h('ul', { class: 'popup__meanwhile-list' }, [
        h('li', { class: 'popup__meanwhile-item' }, [
          h('span', { class: 'popup__meanwhile-icon popup__meanwhile-icon--success' }, [
            createIcon('check', { size: MEANWHILE_ICON_SIZE, strokeWidth: MEANWHILE_CHECK_STROKE }),
          ]),
          h('span', {}, ['Páginas já traduzidas continuam aparecendo, pelo cache.']),
        ]),
        h('li', { class: 'popup__meanwhile-item popup__meanwhile-item--soft' }, [
          h('span', { class: 'popup__meanwhile-icon' }, [createIcon('pause', { size: MEANWHILE_ICON_SIZE })]),
          h('span', {}, ['Novas traduções ficam pausadas até o servidor voltar.']),
        ]),
      ]),
    ]),
    renderInertSite(model.site),
  ];
}

function renderProblemCard(problem: ProblemView): HTMLElement {
  return h('div', { class: 'popup__problem-card' }, [
    h('div', { class: 'popup__problem-heading' }, [
      createIcon('alertCircle', { size: PROBLEM_ICON_SIZE }),
      h('h2', { class: 'popup__problem-title' }, [problem.title]),
    ]),
    h('p', { class: 'popup__problem-message' }, [problem.message]),
    problem.command !== null && h('code', { class: 'popup__command' }, [problem.command]),
  ]);
}

function renderRetryButton(retrying: boolean, handlers: PopupHandlers): HTMLButtonElement {
  // aria-disabled instead of disabled keeps keyboard focus on the button while the check runs.
  return h(
    'button',
    {
      type: 'button',
      id: CONTROL_IDS.retry,
      class: 'button button--primary popup__problem-button',
      'aria-disabled': retrying ? 'true' : null,
      onClick: () => {
        if (!retrying) {
          handlers.onRetry();
        }
      },
    },
    retrying ? [createSpinner(RETRY_SPINNER_SIZE), CHECKING_LABEL] : ['Tentar de novo'],
  );
}

/** The site preferences stay visible but unusable while the server is down, as in the design. */
function renderInertSite(site: SiteView): HTMLElement {
  const content: HTMLElement[] = [];
  if (site.kind === 'unavailable') {
    content.push(h('p', { class: 'popup__site-host' }, [site.message]));
  } else {
    const siteSwitch = createToggleSwitch({ label: 'Ativar neste site', checked: site.enabled, disabled: true });
    content.push(renderSiteSummary(site), siteSwitch.element);
  }
  return h('section', { class: 'popup__section popup__site popup__site--inert popup__dimmed', inert: true }, [
    h('div', { class: 'popup__site-row' }, content),
  ]);
}

function findFocusedControlId(root: HTMLElement): string | null {
  const focused = document.activeElement;
  return focused instanceof HTMLElement && root.contains(focused) && focused.id !== '' ? focused.id : null;
}

function restoreFocus(root: HTMLElement, id: string | null): void {
  if (id === null || root.contains(document.activeElement)) {
    return;
  }
  const control = document.getElementById(id);
  if (control !== null && root.contains(control)) {
    control.focus();
  }
}
