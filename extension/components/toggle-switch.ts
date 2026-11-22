import { h } from '@/utils/dom';

/** Options for {@link createToggleSwitch}. */
export interface ToggleSwitchOptions {
  /** Accessible name, e.g. "Ativar neste site". */
  label: string;
  checked: boolean;
  disabled?: boolean;
  /** Called with the new value after a user click (not after {@link ToggleSwitch.setChecked}). */
  onChange?: (checked: boolean) => void;
}

/** A switch created by {@link createToggleSwitch}. */
export interface ToggleSwitch {
  element: HTMLButtonElement;
  /** Updates the state without calling `onChange` (e.g. to revert after a failed save). */
  setChecked(checked: boolean): void;
  isChecked(): boolean;
}

/**
 * On/off switch from the design (44x26 track in a 52x44 touch target).
 * Styled by `.switch` in `assets/styles/controls.css`.
 */
export function createToggleSwitch(options: ToggleSwitchOptions): ToggleSwitch {
  let checked = options.checked;
  const element = h(
    'button',
    {
      type: 'button',
      class: 'switch',
      role: 'switch',
      'aria-label': options.label,
      'aria-checked': String(checked),
      disabled: options.disabled ?? false,
    },
    [h('span', { class: 'switch__track' }, [h('span', { class: 'switch__knob' })])],
  );

  const setChecked = (value: boolean): void => {
    checked = value;
    element.setAttribute('aria-checked', String(value));
  };

  element.addEventListener('click', () => {
    // Browsers skip clicks on disabled buttons, but a dispatched click event still arrives.
    if (element.disabled) {
      return;
    }
    setChecked(!checked);
    options.onChange?.(checked);
  });

  return { element, setChecked, isChecked: () => checked };
}
