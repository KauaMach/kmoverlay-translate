import { h } from '@/utils/dom';
import { createIcon, createSpinner } from '@/utils/icons';
import type { SaveState } from './settings-saver';

const ICON_SIZE = 16;
const CHECK_STROKE_WIDTH = 2.2;

/** Copy shown for each save state. */
export const SAVE_STATE_TEXT: Record<SaveState, string> = {
  saved: 'Alterações salvas automaticamente',
  saving: 'Salvando…',
  error: 'Não foi possível salvar as alterações',
};

export interface SaveIndicator {
  element: HTMLElement;
  setState(state: SaveState): void;
}

/** Header message that tells whether the latest changes were saved. */
export function createSaveIndicator(): SaveIndicator {
  const element = h('p', { class: 'save-indicator', 'aria-live': 'polite' });

  const setState = (state: SaveState): void => {
    element.setAttribute('data-state', state);
    element.replaceChildren(createStateIcon(state), SAVE_STATE_TEXT[state]);
  };

  setState('saved');
  return { element, setState };
}

function createStateIcon(state: SaveState): SVGSVGElement {
  switch (state) {
    case 'saved':
      return createIcon('check', { size: ICON_SIZE, strokeWidth: CHECK_STROKE_WIDTH });
    case 'saving':
      return createSpinner(ICON_SIZE);
    case 'error':
      return createIcon('alertCircle', { size: ICON_SIZE });
  }
}
