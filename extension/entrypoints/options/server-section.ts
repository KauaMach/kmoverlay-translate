import { browser } from 'wxt/browser';
import { createStatusPill, type PillTone } from '@/components/status-pill';
import { h } from '@/utils/dom';
import { createSpinner } from '@/utils/icons';
import { requestServerCheck } from '@/utils/messages';
import {
  isLocalServer,
  normalizeServerUrl,
  serverPermissionPattern,
  type ServerStatus,
} from '@/utils/server-status';
import { DEFAULT_SERVER_URL, type Settings } from '@/utils/settings';
import { createSectionCard } from './page-parts';
import type { SettingsChange, SettingsSaver } from './settings-saver';

/** What the connection pill shows: the result of the last test, or the test in progress. */
export type ConnectionState = { state: 'not-tested' } | { state: 'checking' } | ServerStatus;

export interface ConnectionPill {
  tone: PillTone;
  text: string;
}

export const INVALID_SERVER_URL_MESSAGE = 'Use um endereço que comece com http:// ou https://';
export const SERVER_URL_INPUT_ID = 'server-url';
export const TOKEN_INPUT_ID = 'server-token';

const SERVER_URL_HINT_ID = 'server-url-hint';
const SERVER_URL_ERROR_ID = 'server-url-error';
const SERVER_URL_SAVE_KEY = 'serverUrl';
const TOKEN_SAVE_KEY = 'token';
const SHOW_TOKEN_LABEL = 'Mostrar';
const HIDE_TOKEN_LABEL = 'Ocultar';
const SETTINGS_NOT_SAVED_REASON = 'as alterações não foram salvas';
const SPINNER_SIZE = 14;

/** Maps a connection test result to the pill shown next to "Testar conexão". */
export function describeConnection(connection: ConnectionState): ConnectionPill {
  switch (connection.state) {
    case 'not-tested':
      return { tone: 'neutral', text: 'Não testado' };
    case 'checking':
      return { tone: 'neutral', text: 'Verificando…' };
    case 'online': {
      const models = connection.modelsLoaded ? 'modelos carregados' : 'modelos não carregados';
      const parts = connection.gpuName ? ['Conectado', connection.gpuName, models] : ['Conectado', models];
      return { tone: 'success', text: parts.join(' · ') };
    }
    case 'offline':
      return { tone: 'danger', text: 'Servidor não encontrado' };
    case 'unauthorized':
      return { tone: 'danger', text: 'Token recusado' };
    case 'no-permission':
      return { tone: 'danger', text: 'Acesso não autorizado' };
    case 'error':
      return { tone: 'danger', text: `Erro: ${connection.reason}` };
  }
}

/** "Servidor" section: address, token and the connection test. */
export function createServerSection(settings: Settings, saver: SettingsSaver): HTMLElement {
  const urlField = createServerUrlField(settings.serverUrl, saver);
  return createSectionCard('servidor', 'Servidor', [
    urlField.element,
    createTokenField(settings.token, saver),
    createConnectionTest(urlField, saver),
  ]);
}

interface ServerUrlField {
  element: HTMLElement;
  input: HTMLInputElement;
  /** Shows whether the typed address is valid and returns it normalized, or `null`. */
  validate(): string | null;
}

function createServerUrlField(serverUrl: string, saver: SettingsSaver): ServerUrlField {
  const input = h('input', {
    id: SERVER_URL_INPUT_ID,
    class: 'input',
    type: 'text',
    inputmode: 'url',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: DEFAULT_SERVER_URL,
    value: serverUrl,
    'aria-describedby': `${SERVER_URL_HINT_ID} ${SERVER_URL_ERROR_ID}`,
  });
  const error = h('p', { id: SERVER_URL_ERROR_ID, class: 'field__error', 'aria-live': 'polite' });

  const showValidity = (valid: boolean): void => {
    if (valid) {
      input.removeAttribute('aria-invalid');
      error.textContent = '';
    } else {
      input.setAttribute('aria-invalid', 'true');
      error.textContent = INVALID_SERVER_URL_MESSAGE;
    }
  };

  const validate = (): string | null => {
    const normalized = normalizeServerUrl(input.value);
    showValidity(normalized !== null);
    return normalized;
  };

  const prepareSave = (): SettingsChange | null => {
    const normalized = validate();
    return normalized === null ? null : (current) => ({ ...current, serverUrl: normalized });
  };

  input.addEventListener('input', () => {
    // An error disappears as soon as the address is fixed, but only shows up
    // once the typing stops, so "h", "ht", "htt"… are not flagged on the way.
    if (input.getAttribute('aria-invalid') === 'true' && normalizeServerUrl(input.value) !== null) {
      showValidity(true);
    }
    saver.saveLater(SERVER_URL_SAVE_KEY, prepareSave);
  });
  input.addEventListener('change', () => {
    void saver.flush();
    // Rewriting the value while typing would move the cursor, so the saved form is shown only on leaving the field.
    const normalized = normalizeServerUrl(input.value);
    if (normalized !== null && normalized !== input.value) {
      input.value = normalized;
    }
  });

  const element = h('div', { class: 'field field--narrow' }, [
    h('label', { class: 'field__label', for: SERVER_URL_INPUT_ID }, ['Endereço do servidor']),
    input,
    h('p', { id: SERVER_URL_HINT_ID, class: 'field__hint' }, [
      'No celular, use o IP do PC na rede local ou o endereço do Tailscale.',
    ]),
    error,
  ]);
  return { element, input, validate };
}

function createTokenField(token: string, saver: SettingsSaver): HTMLElement {
  const input = h('input', {
    id: TOKEN_INPUT_ID,
    class: 'input',
    type: 'password',
    autocomplete: 'off',
    spellcheck: 'false',
    value: token,
  });
  const visibilityButton = h(
    'button',
    { type: 'button', class: 'button', 'aria-pressed': 'false', 'aria-controls': TOKEN_INPUT_ID },
    [SHOW_TOKEN_LABEL],
  );

  visibilityButton.addEventListener('click', () => {
    const reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    visibilityButton.setAttribute('aria-pressed', String(reveal));
    visibilityButton.textContent = reveal ? HIDE_TOKEN_LABEL : SHOW_TOKEN_LABEL;
  });
  input.addEventListener('input', () => {
    // Pasted tokens often bring a trailing newline or space that the server would refuse.
    saver.saveLater(TOKEN_SAVE_KEY, () => (current) => ({ ...current, token: input.value.trim() }));
  });
  input.addEventListener('change', () => {
    void saver.flush();
  });

  return h('div', { class: 'field field--narrow' }, [
    h('label', { class: 'field__label', for: TOKEN_INPUT_ID }, ['Token de acesso']),
    h('div', { class: 'field__row' }, [input, visibilityButton]),
  ]);
}

function createConnectionTest(urlField: ServerUrlField, saver: SettingsSaver): HTMLElement {
  const status = h('span', { class: 'connection-status', role: 'status' });
  let testing = false;

  const show = (connection: ConnectionState): void => {
    status.replaceChildren(renderConnectionPill(connection));
  };

  const runTest = async (permission: Promise<boolean>): Promise<void> => {
    testing = true;
    show({ state: 'checking' });
    try {
      // The address or token typed just before the click must be stored, because the background reads them from storage.
      const [granted, saved] = await Promise.all([permission, saver.flush()]);
      if (!granted) {
        show({ state: 'no-permission' });
      } else if (!saved) {
        show({ state: 'error', reason: SETTINGS_NOT_SAVED_REASON });
      } else {
        show(await requestServerCheck());
      }
    } catch (error) {
      console.error('KMOverlay: the connection test failed.', error);
      show({ state: 'error', reason: describeError(error) });
    } finally {
      testing = false;
    }
  };

  const handleClick = (): void => {
    if (testing) {
      return;
    }
    const serverUrl = urlField.validate();
    if (serverUrl === null) {
      urlField.input.focus();
      return;
    }
    // Browsers only show the permission prompt while handling the click, so
    // the request starts here, before anything is awaited.
    const permission = isLocalServer(serverUrl)
      ? Promise.resolve(true)
      : browser.permissions.request({ origins: [serverPermissionPattern(serverUrl)] });
    void runTest(permission);
  };

  show({ state: 'not-tested' });
  return h('div', { class: 'connection-test' }, [
    h('button', { type: 'button', class: 'button button--primary', onClick: handleClick }, ['Testar conexão']),
    status,
  ]);
}

function renderConnectionPill(connection: ConnectionState): HTMLElement {
  const { tone, text } = describeConnection(connection);
  if (connection.state === 'checking') {
    return h('span', { class: `pill pill--${tone}` }, [createSpinner(SPINNER_SIZE), text]);
  }
  return createStatusPill(tone, text);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
