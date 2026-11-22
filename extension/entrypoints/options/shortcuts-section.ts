import { browser, type Browser } from 'wxt/browser';
import { h } from '@/utils/dom';
import { createSectionCard } from './page-parts';

export const CHROME_SHORTCUTS_URL = 'chrome://extensions/shortcuts';
export const NO_SHORTCUT_TEXT = 'Sem atalho';
export const FIREFOX_SHORTCUTS_HELP = 'No Firefox: about:addons → engrenagem → Gerenciar atalhos de extensões.';
export const NO_COMMANDS_TEXT = 'Este navegador não tem atalhos de teclado para extensões.';

const CHROME_SHORTCUTS_HELP = `Abra ${CHROME_SHORTCUTS_URL} na barra de endereços para alterar os atalhos.`;
const COMMANDS_FAILED_TEXT = 'Não foi possível ler os atalhos.';
/** Commands the browser adds by itself, such as `_execute_action` (open the popup). */
const BROWSER_COMMAND_PREFIX = '_execute_';

/** One line of the "Atalhos" section. */
export interface ShortcutRow {
  description: string;
  /** Keys as the browser reports them ("Alt+T"), or `null` when the command has none. */
  shortcut: string | null;
}

/** How "Alterar atalhos nas configurações do navegador" reaches the browser settings. */
export type ShortcutSettingsAction =
  | { kind: 'open-tab'; url: string }
  | { kind: 'open-firefox-settings'; open: () => Promise<void> }
  | { kind: 'show-help'; text: string };

/** Newer Firefox versions can open the shortcut settings; the method is not in the shared typings. */
interface FirefoxCommandsApi {
  openShortcutSettings?: () => Promise<void>;
}

/** Turns the extension commands into rows, leaving out the commands the browser adds by itself. */
export function toShortcutRows(commands: readonly Browser.commands.Command[]): ShortcutRow[] {
  return commands.flatMap((command) => {
    if (!command.description || command.name?.startsWith(BROWSER_COMMAND_PREFIX)) {
      return [];
    }
    return [{ description: command.description, shortcut: command.shortcut ? command.shortcut : null }];
  });
}

/**
 * Chromium opens its shortcut page in a tab. Firefox blocks `about:addons`
 * for extensions, so it uses `openShortcutSettings` when available, or explains the way.
 */
export function resolveShortcutSettingsAction(isFirefox: boolean, commandsApi: object): ShortcutSettingsAction {
  if (!isFirefox) {
    return { kind: 'open-tab', url: CHROME_SHORTCUTS_URL };
  }
  const { openShortcutSettings } = commandsApi as FirefoxCommandsApi;
  if (typeof openShortcutSettings === 'function') {
    return { kind: 'open-firefox-settings', open: () => openShortcutSettings.call(commandsApi) };
  }
  return { kind: 'show-help', text: FIREFOX_SHORTCUTS_HELP };
}

/** "Atalhos" section: the keyboard shortcuts as the browser has them now. */
export function createShortcutsSection(isFirefox: boolean = import.meta.env.FIREFOX): HTMLElement {
  // Firefox for Android has no keyboard shortcuts, so the API is missing there.
  const commandsApi: typeof browser.commands | undefined = browser.commands;
  const list = h('div', { class: 'shortcut-list' });
  const help = h('p', { class: 'field__hint shortcut-help', 'aria-live': 'polite' });

  const showHelp = (text: string): void => {
    help.textContent = text;
  };

  const handleChangeClick = (): void => {
    if (commandsApi === undefined) {
      return;
    }
    const action = resolveShortcutSettingsAction(isFirefox, commandsApi);
    if (action.kind === 'show-help') {
      showHelp(action.text);
      return;
    }
    showHelp('');
    const opening: Promise<unknown> =
      action.kind === 'open-tab' ? browser.tabs.create({ url: action.url }) : action.open();
    opening.catch((error: unknown) => {
      console.error('KMOverlay: could not open the shortcut settings.', error);
      showHelp(isFirefox ? FIREFOX_SHORTCUTS_HELP : CHROME_SHORTCUTS_HELP);
    });
  };

  const changeButton = h('button', { type: 'button', class: 'link-button', onClick: handleChangeClick }, [
    'Alterar atalhos nas configurações do navegador',
  ]);

  if (commandsApi === undefined) {
    list.replaceChildren(h('p', { class: 'field__hint' }, [NO_COMMANDS_TEXT]));
    changeButton.hidden = true;
  } else {
    commandsApi.getAll().then(
      (commands) => list.replaceChildren(...toShortcutRows(commands).map(renderShortcutRow)),
      (error: unknown) => {
        console.error('KMOverlay: could not read the keyboard shortcuts.', error);
        list.replaceChildren(h('p', { class: 'field__error' }, [COMMANDS_FAILED_TEXT]));
      },
    );
  }

  return createSectionCard('atalhos', 'Atalhos', [list, changeButton, help], 'list');
}

function renderShortcutRow(row: ShortcutRow): HTMLElement {
  return h('div', { class: 'shortcut-row' }, [
    h('span', {}, [row.description]),
    row.shortcut === null
      ? h('span', { class: 'shortcut-row__none' }, [NO_SHORTCUT_TEXT])
      : h('kbd', { class: 'kbd' }, [row.shortcut]),
  ]);
}
