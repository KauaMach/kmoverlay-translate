import { describe, expect, it } from 'vitest';
import {
  buildPopupViewModel,
  formatPageProgress,
  type ConnectedViewModel,
  type PopupViewModel,
  type PopupViewModelInput,
  type ProblemViewModel,
} from '@/entrypoints/popup/view-model';
import { siteSourceLanguageOptions, targetLanguageOptions } from '@/utils/languages';
import type { ServerStatus } from '@/utils/server-status';
import { createDefaultSettings, setSiteEnabled, updateSite, type Settings } from '@/utils/settings';

const NOW = Date.UTC(2026, 10, 22, 12, 0, 0);
const MINUTE_MS = 60_000;
const READER_URL = 'https://leitor.exemplo/capitulo/12';
const READER_HOST = 'leitor.exemplo';
const ONLINE: ServerStatus = { state: 'online', gpuName: 'RTX 3050', modelsLoaded: true };

function buildInput(overrides: Partial<PopupViewModelInput> = {}): PopupViewModelInput {
  return {
    settings: createDefaultSettings(),
    tabUrl: READER_URL,
    serverStatus: ONLINE,
    lastConnectedAt: null,
    pageStatus: null,
    now: NOW,
    ...overrides,
  };
}

function enabledReaderSettings(): Settings {
  return setSiteEnabled(createDefaultSettings(), READER_HOST, true);
}

function expectConnected(model: PopupViewModel): ConnectedViewModel {
  if (model.layout !== 'connected') {
    throw new Error(`Expected the connected layout, got "${model.layout}".`);
  }
  return model;
}

function expectProblem(model: PopupViewModel): ProblemViewModel {
  if (model.layout !== 'problem') {
    throw new Error(`Expected the problem layout, got "${model.layout}".`);
  }
  return model;
}

describe('buildPopupViewModel: connection', () => {
  it('shows a neutral "Verificando…" pill and the connected layout while the first check runs', () => {
    const model = expectConnected(buildPopupViewModel(buildInput({ serverStatus: 'checking' })));

    expect(model.connection).toEqual({ tone: 'neutral', label: 'Verificando…' });
  });

  it('shows a success "Conectado" pill when the server is online', () => {
    const model = expectConnected(buildPopupViewModel(buildInput()));

    expect(model.connection).toEqual({ tone: 'success', label: 'Conectado' });
  });

  it('shows "Offline" for an unreachable server and "Erro" for the other problems', () => {
    const offline = buildPopupViewModel(buildInput({ serverStatus: { state: 'offline' } }));
    expect(offline.connection).toEqual({ tone: 'danger', label: 'Offline' });

    const problems: ServerStatus[] = [
      { state: 'unauthorized' },
      { state: 'no-permission' },
      { state: 'error', reason: 'HTTP 500' },
    ];
    for (const serverStatus of problems) {
      const model = buildPopupViewModel(buildInput({ serverStatus }));
      expect(model.layout).toBe('problem');
      expect(model.connection).toEqual({ tone: 'danger', label: 'Erro' });
    }
  });
});

describe('buildPopupViewModel: problem card', () => {
  it('explains how to start the server when it is offline', () => {
    const model = expectProblem(buildPopupViewModel(buildInput({ serverStatus: { state: 'offline' } })));

    expect(model.problem).toEqual({
      title: 'Servidor não encontrado',
      message: 'Não foi possível conectar a 127.0.0.1:8000. Inicie o servidor no PC e tente de novo:',
      command: 'uv run kmoverlay serve',
      retrying: false,
    });
  });

  it('points to the token when the server refuses it', () => {
    const model = expectProblem(buildPopupViewModel(buildInput({ serverStatus: { state: 'unauthorized' } })));

    expect(model.problem.title).toBe('Token recusado');
    expect(model.problem.message).toBe('O servidor em 127.0.0.1:8000 recusou o token. Confira o token nas opções.');
    expect(model.problem.command).toBeNull();
  });

  it('asks for the host permission of a network server', () => {
    const settings = { ...createDefaultSettings(), serverUrl: 'http://192.168.0.20:8000' };
    const model = expectProblem(
      buildPopupViewModel(buildInput({ settings, serverStatus: { state: 'no-permission' } })),
    );

    expect(model.problem.title).toBe('Acesso ao servidor não autorizado');
    expect(model.problem.message).toBe(
      'Abra as opções e clique em Testar conexão para permitir o acesso a 192.168.0.20:8000.',
    );
    expect(model.problem.command).toBeNull();
  });

  it('includes the reason of an unexpected answer', () => {
    const model = expectProblem(
      buildPopupViewModel(buildInput({ serverStatus: { state: 'error', reason: 'HTTP 500' } })),
    );

    expect(model.problem.title).toBe('O servidor respondeu com erro');
    expect(model.problem.message).toBe('Resposta inesperada de 127.0.0.1:8000 (HTTP 500).');
  });

  it('keeps the problem card, marked as retrying, while a new check runs after a problem', () => {
    const model = expectProblem(
      buildPopupViewModel(buildInput({ serverStatus: 'checking', previousServerStatus: { state: 'offline' } })),
    );

    expect(model.connection).toEqual({ tone: 'neutral', label: 'Verificando…' });
    expect(model.problem.title).toBe('Servidor não encontrado');
    expect(model.problem.retrying).toBe(true);
  });

  it('uses the connected layout while checking again after the server was online', () => {
    const model = buildPopupViewModel(buildInput({ serverStatus: 'checking', previousServerStatus: ONLINE }));

    expect(model.layout).toBe('connected');
  });

  it('shows an invalid stored server address as typed instead of failing', () => {
    const settings = { ...createDefaultSettings(), serverUrl: 'endereço inválido' };
    const model = expectProblem(
      buildPopupViewModel(buildInput({ settings, serverStatus: { state: 'error', reason: 'URL inválida' } })),
    );

    expect(model.problem.message).toBe('Resposta inesperada de endereço inválido (URL inválida).');
  });
});

describe('buildPopupViewModel: footer', () => {
  it('describes a local server with its address and GPU', () => {
    expect(buildPopupViewModel(buildInput()).footer).toBe('Servidor local · 127.0.0.1:8000 · RTX 3050');
  });

  it('omits the GPU when the server has none', () => {
    const serverStatus: ServerStatus = { state: 'online', gpuName: null, modelsLoaded: true };

    expect(buildPopupViewModel(buildInput({ serverStatus })).footer).toBe('Servidor local · 127.0.0.1:8000');
  });

  it('describes a server on the network', () => {
    const settings = { ...createDefaultSettings(), serverUrl: 'http://192.168.0.20:8000' };

    expect(buildPopupViewModel(buildInput({ settings })).footer).toBe('Servidor na rede · 192.168.0.20:8000 · RTX 3050');
  });

  it('shows the address without a GPU while checking', () => {
    expect(buildPopupViewModel(buildInput({ serverStatus: 'checking' })).footer).toBe(
      'Servidor local · 127.0.0.1:8000',
    );
  });

  it('shows how long ago the server answered when there is a problem', () => {
    const model = buildPopupViewModel(
      buildInput({ serverStatus: { state: 'offline' }, lastConnectedAt: NOW - 12 * MINUTE_MS }),
    );

    expect(model.footer).toBe('Última conexão há 12 min');
  });

  it('says the server never answered', () => {
    const model = buildPopupViewModel(buildInput({ serverStatus: { state: 'offline' }, lastConnectedAt: null }));

    expect(model.footer).toBe('Nunca conectado');
  });

  it('never shows a negative duration when the clock moved backwards', () => {
    const model = buildPopupViewModel(
      buildInput({ serverStatus: { state: 'offline' }, lastConnectedAt: NOW + 5 * MINUTE_MS }),
    );

    expect(model.footer).toBe('Última conexão há menos de 1 min');
  });
});

describe('buildPopupViewModel: site', () => {
  it('shows an enabled site with its preferences', () => {
    const settings = updateSite(enabledReaderSettings(), READER_HOST, { images: true, text: true });
    const model = buildPopupViewModel(buildInput({ settings }));

    expect(model.site).toEqual({
      kind: 'site',
      host: READER_HOST,
      enabled: true,
      subtitle: 'Ativo neste site',
      images: true,
      text: true,
      contentTogglesDisabled: false,
    });
  });

  it('shows a site never turned on as off, with the preferences it would get', () => {
    const model = buildPopupViewModel(buildInput());

    expect(model.site).toEqual({
      kind: 'site',
      host: READER_HOST,
      enabled: false,
      subtitle: 'Desligado neste site',
      images: true,
      text: false,
      contentTogglesDisabled: true,
    });
  });

  it('keeps the preferences of a site that was turned off', () => {
    const settings = setSiteEnabled(
      updateSite(enabledReaderSettings(), READER_HOST, { images: false, text: true }),
      READER_HOST,
      false,
    );
    const model = buildPopupViewModel(buildInput({ settings }));

    expect(model.site).toMatchObject({ enabled: false, images: false, text: true, contentTogglesDisabled: true });
  });

  it('says that browser pages cannot be translated', () => {
    for (const tabUrl of ['chrome://extensions/', 'about:blank', undefined]) {
      const model = buildPopupViewModel(buildInput({ tabUrl }));
      expect(model.site).toEqual({ kind: 'unavailable', message: 'Esta página não pode ser traduzida' });
    }
  });

  it('keeps the site in the problem layout', () => {
    const model = buildPopupViewModel(
      buildInput({ settings: enabledReaderSettings(), serverStatus: { state: 'offline' } }),
    );

    expect(model.site).toMatchObject({ kind: 'site', host: READER_HOST, enabled: true });
  });
});

describe('buildPopupViewModel: languages', () => {
  it('offers the site source languages and the target languages', () => {
    const model = expectConnected(buildPopupViewModel(buildInput({ settings: enabledReaderSettings() })));

    expect(model.languages.source.options).toEqual(siteSourceLanguageOptions());
    expect(model.languages.target.options).toEqual(targetLanguageOptions());
    expect(model.languages.source).toMatchObject({ value: 'en', disabled: false });
    expect(model.languages.target).toMatchObject({ value: 'pt-BR', disabled: false });
  });

  it('uses the language chosen for the site', () => {
    const settings = updateSite(enabledReaderSettings(), READER_HOST, { sourceLanguage: 'ja' });
    const model = expectConnected(buildPopupViewModel(buildInput({ settings })));

    expect(model.languages.source.value).toBe('ja');
  });

  it('falls back to the default source language for a site without a choice', () => {
    const settings: Settings = { ...createDefaultSettings(), defaultSourceLanguage: 'ko' };
    const model = expectConnected(buildPopupViewModel(buildInput({ settings })));

    expect(model.languages.source.value).toBe('ko');
  });

  it('only lets the source language change while the site is on', () => {
    const model = expectConnected(buildPopupViewModel(buildInput()));

    expect(model.languages.source.disabled).toBe(true);
    expect(model.languages.target.disabled).toBe(false);
  });

  it('disables the source language on pages that cannot be translated', () => {
    const settings: Settings = { ...createDefaultSettings(), targetLanguage: 'es' };
    const model = expectConnected(buildPopupViewModel(buildInput({ settings, tabUrl: 'about:blank' })));

    expect(model.languages.source).toMatchObject({ value: 'en', disabled: true });
    expect(model.languages.target).toMatchObject({ value: 'es', disabled: false });
  });
});

describe('buildPopupViewModel: page', () => {
  it('has no page section without a content script', () => {
    const model = expectConnected(buildPopupViewModel(buildInput({ pageStatus: null })));

    expect(model.page).toBeNull();
  });

  it('shows the chapter progress and the toggle', () => {
    const model = expectConnected(
      buildPopupViewModel(
        buildInput({ pageStatus: { translatedImages: 5, totalImages: 12, showingOriginal: false } }),
      ),
    );

    expect(model.page).toEqual({
      translatedImages: 5,
      totalImages: 12,
      progressPercent: 42,
      progressLabel: '5 de 12 páginas',
      toggleLabel: 'Mostrar original',
    });
  });

  it('offers to show the translation again while the original is shown', () => {
    const model = expectConnected(
      buildPopupViewModel(buildInput({ pageStatus: { translatedImages: 2, totalImages: 4, showingOriginal: true } })),
    );

    expect(model.page?.toggleLabel).toBe('Mostrar tradução');
  });

  it('handles an empty chapter and inconsistent numbers', () => {
    const empty = expectConnected(
      buildPopupViewModel(buildInput({ pageStatus: { translatedImages: 0, totalImages: 0, showingOriginal: false } })),
    );
    expect(empty.page).toMatchObject({ progressPercent: 0, progressLabel: '0 de 0 páginas' });

    const overflow = expectConnected(
      buildPopupViewModel(buildInput({ pageStatus: { translatedImages: 9, totalImages: 4, showingOriginal: false } })),
    );
    expect(overflow.page).toMatchObject({ translatedImages: 4, progressPercent: 100, progressLabel: '4 de 4 páginas' });
  });

  it('is hidden on pages that cannot be translated and in the problem layout', () => {
    const pageStatus = { translatedImages: 1, totalImages: 2, showingOriginal: false };

    const browserPage = expectConnected(buildPopupViewModel(buildInput({ tabUrl: 'about:blank', pageStatus })));
    expect(browserPage.page).toBeNull();

    const offline = buildPopupViewModel(buildInput({ serverStatus: { state: 'offline' }, pageStatus }));
    expect(offline).not.toHaveProperty('page');
    expect(offline).not.toHaveProperty('languages');
  });
});

describe('formatPageProgress', () => {
  it('uses the singular for a single page', () => {
    expect(formatPageProgress(1, 1)).toBe('1 de 1 página');
    expect(formatPageProgress(0, 1)).toBe('0 de 1 página');
    expect(formatPageProgress(5, 12)).toBe('5 de 12 páginas');
  });
});
