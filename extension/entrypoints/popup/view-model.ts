import type { PillTone } from '@/components/status-pill';
import { formatElapsed } from '@/utils/format';
import { siteSourceLanguageOptions, targetLanguageOptions, type LanguageOption } from '@/utils/languages';
import type { PageStatus } from '@/utils/messages';
import { isLocalServer, serverAddressLabel, type ServerStatus } from '@/utils/server-status';
import { createSiteSettings, getSite, resolveSourceLanguage, siteHostFromUrl, type Settings } from '@/utils/settings';

/** Server state shown by the popup: a finished check, or one still running. */
export type PopupServerState = ServerStatus | 'checking';

/** Everything the popup decisions depend on. */
export interface PopupViewModelInput {
  settings: Settings;
  /** URL of the active tab (`undefined` when the browser does not expose it). */
  tabUrl: string | undefined;
  serverStatus: PopupServerState;
  /**
   * Status received before the check that is running now. A retry after a
   * problem keeps the problem layout on screen instead of flashing the
   * connected one for the duration of the check.
   */
  previousServerStatus?: ServerStatus | null;
  /** When the server last answered (milliseconds), or `null` if never. */
  lastConnectedAt: number | null;
  /** What the content script reported, or `null` when there is none. */
  pageStatus: PageStatus | null;
  /** Current time in milliseconds. */
  now: number;
}

/** Status pill in the header. */
export interface ConnectionView {
  tone: PillTone;
  label: string;
}

/** Current site, or the notice for pages that cannot be translated. */
export type SiteView =
  | { kind: 'unavailable'; message: string }
  | {
      kind: 'site';
      host: string;
      enabled: boolean;
      subtitle: string;
      images: boolean;
      text: boolean;
      /** The images and text switches only make sense while the site is on. */
      contentTogglesDisabled: boolean;
    };

/** One language select. */
export interface LanguageSelectView {
  options: LanguageOption[];
  value: string;
  disabled: boolean;
}

/** The "De → Para" row. */
export interface LanguagesView {
  source: LanguageSelectView;
  target: LanguageSelectView;
}

/** Chapter progress reported by the content script. */
export interface PageView {
  translatedImages: number;
  totalImages: number;
  /** Rounded percentage used for the width of the progress bar. */
  progressPercent: number;
  progressLabel: string;
  toggleLabel: string;
}

/** Card that explains why the server cannot be used. */
export interface ProblemView {
  title: string;
  message: string;
  /** Command shown in a code block, or `null` when there is nothing to run. */
  command: string | null;
  /** True while the check started by "Tentar de novo" is running. */
  retrying: boolean;
}

interface PopupViewModelBase {
  connection: ConnectionView;
  site: SiteView;
  footer: string;
}

/** Layout of Popup.dc.html: the server answers (or is still being checked). */
export interface ConnectedViewModel extends PopupViewModelBase {
  layout: 'connected';
  languages: LanguagesView;
  page: PageView | null;
}

/** Layout of PopupOffline.dc.html: the server cannot be used. */
export interface ProblemViewModel extends PopupViewModelBase {
  layout: 'problem';
  problem: ProblemView;
}

/** Everything the popup renderer needs, decided without touching the DOM or the browser. */
export type PopupViewModel = ConnectedViewModel | ProblemViewModel;

type ProblemStatus = Exclude<ServerStatus, { state: 'online' }>;

export const CHECKING_LABEL = 'Verificando…';
export const CONNECTED_LABEL = 'Conectado';
export const OFFLINE_LABEL = 'Offline';
export const PROBLEM_LABEL = 'Erro';
export const UNAVAILABLE_PAGE_MESSAGE = 'Esta página não pode ser traduzida';
export const SITE_ENABLED_SUBTITLE = 'Ativo neste site';
export const SITE_DISABLED_SUBTITLE = 'Desligado neste site';
export const SHOW_ORIGINAL_LABEL = 'Mostrar original';
export const SHOW_TRANSLATION_LABEL = 'Mostrar tradução';
export const START_SERVER_COMMAND = 'uv run kmoverlay serve';
export const NEVER_CONNECTED_FOOTER = 'Nunca conectado';
const LAST_CONNECTION_PREFIX = 'Última conexão';
const LOCAL_SERVER_LABEL = 'Servidor local';
const NETWORK_SERVER_LABEL = 'Servidor na rede';
const FOOTER_SEPARATOR = ' · ';
const PERCENT = 100;

/** Decides what the popup shows. Pure: same input, same output. */
export function buildPopupViewModel(input: PopupViewModelInput): PopupViewModel {
  const server = describeServer(input.settings.serverUrl);
  const host = siteHostFromUrl(input.tabUrl);
  const site = buildSiteView(input.settings, host);
  const problemStatus = findProblemStatus(input.serverStatus, input.previousServerStatus ?? null);

  if (problemStatus !== null) {
    return {
      layout: 'problem',
      connection: buildConnectionView(input.serverStatus),
      problem: { ...buildProblemCopy(problemStatus, server.address), retrying: input.serverStatus === 'checking' },
      site,
      footer: buildLastConnectionFooter(input.lastConnectedAt, input.now),
    };
  }

  return {
    layout: 'connected',
    connection: buildConnectionView(input.serverStatus),
    site,
    languages: buildLanguagesView(input.settings, host, site),
    page: host === null || input.pageStatus === null ? null : buildPageView(input.pageStatus),
    footer: buildServerFooter(server, input.serverStatus),
  };
}

/** "5 de 12 páginas", with the singular when the chapter has one page. */
export function formatPageProgress(translatedImages: number, totalImages: number): string {
  const noun = totalImages === 1 ? 'página' : 'páginas';
  return `${translatedImages} de ${totalImages} ${noun}`;
}

interface ServerDescription {
  address: string;
  isLocal: boolean;
}

function describeServer(serverUrl: string): ServerDescription {
  try {
    return { address: serverAddressLabel(serverUrl), isLocal: isLocalServer(serverUrl) };
  } catch (error) {
    // Stored settings are external input: an invalid address is shown as typed
    // instead of breaking the popup.
    if (error instanceof TypeError) {
      return { address: serverUrl, isLocal: false };
    }
    throw error;
  }
}

function findProblemStatus(current: PopupServerState, previous: ServerStatus | null): ProblemStatus | null {
  const status = current === 'checking' ? previous : current;
  if (status === null || status.state === 'online') {
    return null;
  }
  return status;
}

function buildConnectionView(status: PopupServerState): ConnectionView {
  if (status === 'checking') {
    return { tone: 'neutral', label: CHECKING_LABEL };
  }
  switch (status.state) {
    case 'online':
      return { tone: 'success', label: CONNECTED_LABEL };
    case 'offline':
      return { tone: 'danger', label: OFFLINE_LABEL };
    case 'unauthorized':
    case 'no-permission':
    case 'error':
      return { tone: 'danger', label: PROBLEM_LABEL };
  }
}

function buildProblemCopy(status: ProblemStatus, address: string): Omit<ProblemView, 'retrying'> {
  switch (status.state) {
    case 'offline':
      return {
        title: 'Servidor não encontrado',
        message: `Não foi possível conectar a ${address}. Inicie o servidor no PC e tente de novo:`,
        command: START_SERVER_COMMAND,
      };
    case 'unauthorized':
      return {
        title: 'Token recusado',
        message: `O servidor em ${address} recusou o token. Confira o token nas opções.`,
        command: null,
      };
    case 'no-permission':
      return {
        title: 'Acesso ao servidor não autorizado',
        message: `Abra as opções e clique em Testar conexão para permitir o acesso a ${address}.`,
        command: null,
      };
    case 'error':
      return {
        title: 'O servidor respondeu com erro',
        message: `Resposta inesperada de ${address} (${status.reason}).`,
        command: null,
      };
  }
}

function buildSiteView(settings: Settings, host: string | null): SiteView {
  if (host === null) {
    return { kind: 'unavailable', message: UNAVAILABLE_PAGE_MESSAGE };
  }
  const stored = getSite(settings, host);
  // A site never turned on shows the preferences it will get when it is.
  const preferences = stored ?? createSiteSettings(settings);
  const enabled = stored?.enabled ?? false;
  return {
    kind: 'site',
    host,
    enabled,
    subtitle: enabled ? SITE_ENABLED_SUBTITLE : SITE_DISABLED_SUBTITLE,
    images: preferences.images,
    text: preferences.text,
    contentTogglesDisabled: !enabled,
  };
}

function buildLanguagesView(settings: Settings, host: string | null, site: SiteView): LanguagesView {
  const siteEnabled = site.kind === 'site' && site.enabled;
  return {
    source: {
      options: siteSourceLanguageOptions(),
      value: host === null ? settings.defaultSourceLanguage : resolveSourceLanguage(settings, host),
      disabled: !siteEnabled,
    },
    target: {
      options: targetLanguageOptions(),
      value: settings.targetLanguage,
      disabled: false,
    },
  };
}

function buildPageView(pageStatus: PageStatus): PageView {
  const totalImages = Math.max(0, pageStatus.totalImages);
  // The content script is a separate program; keep its numbers consistent on screen.
  const translatedImages = Math.min(Math.max(0, pageStatus.translatedImages), totalImages);
  return {
    translatedImages,
    totalImages,
    progressPercent: totalImages === 0 ? 0 : Math.round((translatedImages / totalImages) * PERCENT),
    progressLabel: formatPageProgress(translatedImages, totalImages),
    toggleLabel: pageStatus.showingOriginal ? SHOW_TRANSLATION_LABEL : SHOW_ORIGINAL_LABEL,
  };
}

function buildServerFooter(server: ServerDescription, status: PopupServerState): string {
  const parts = [server.isLocal ? LOCAL_SERVER_LABEL : NETWORK_SERVER_LABEL, server.address];
  if (status !== 'checking' && status.state === 'online' && status.gpuName) {
    parts.push(status.gpuName);
  }
  return parts.join(FOOTER_SEPARATOR);
}

function buildLastConnectionFooter(lastConnectedAt: number | null, now: number): string {
  if (lastConnectedAt === null) {
    return NEVER_CONNECTED_FOOTER;
  }
  // A clock moved backwards must not produce a negative duration.
  return `${LAST_CONNECTION_PREFIX} ${formatElapsed(Math.max(0, now - lastConnectedAt))}`;
}
