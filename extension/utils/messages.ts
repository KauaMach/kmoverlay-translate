import { browser } from 'wxt/browser';
import { isSourceLanguage, isTargetLanguage, type SourceLanguage, type TargetLanguage } from './languages';
import { isServerStatus, type ServerStatus } from './server-status';

/** Sent by the content script when its queue changes, for the badge of the toolbar icon. */
export interface QueueChangedMessage {
  type: 'queue-changed';
  pending: number;
}

/** Requests handled by the background script. */
export type BackgroundRequest = { type: 'check-server' } | QueueChangedMessage;

/** Name of the port a content script opens to translate one image; disconnecting it cancels the work. */
export const TRANSLATE_PORT_NAME = 'translate-image';

/** First (and only) message a content script sends on a translation port. */
export interface TranslateImageRequest {
  url: string;
  sourceLanguage: SourceLanguage;
  targetLanguage: TargetLanguage;
  priority: 'visible' | 'prefetch';
}

/** Answer of the background script on a translation port. */
export type TranslateImageResult = { state: 'translated'; imageDataUrl: string } | { state: 'error'; reason: string };

/** Requests handled by the content script (registered from Fase 3 on). */
export type ContentRequest = { type: 'get-page-status' } | { type: 'toggle-original' };

/** What the content script reports about the current page. */
export interface PageStatus {
  translatedImages: number;
  totalImages: number;
  showingOriginal: boolean;
}

/**
 * Error texts (Chrome and Firefox) for a tab that has no listener for the
 * message, or whose listener finished without answering.
 */
const NO_ANSWER_ERRORS = ['Receiving end does not exist', 'message port closed before a response was received'];

/** Type guard for messages the background script handles. */
export function isBackgroundRequest(message: unknown): message is BackgroundRequest {
  if (!isRecord(message)) {
    return false;
  }
  return message.type === 'check-server' || (message.type === 'queue-changed' && isCount(message.pending));
}

/** Type guard for the request a content script sends on a translation port. */
export function isTranslateImageRequest(value: unknown): value is TranslateImageRequest {
  return (
    isRecord(value) &&
    typeof value.url === 'string' &&
    isSourceLanguage(value.sourceLanguage) &&
    isTargetLanguage(value.targetLanguage) &&
    (value.priority === 'visible' || value.priority === 'prefetch')
  );
}

/** Type guard for the answer the background script sends on a translation port. */
export function isTranslateImageResult(value: unknown): value is TranslateImageResult {
  if (!isRecord(value)) {
    return false;
  }
  return (
    (value.state === 'translated' && typeof value.imageDataUrl === 'string') ||
    (value.state === 'error' && typeof value.reason === 'string')
  );
}

/** Type guard for messages the content script handles. */
export function isContentRequest(message: unknown): message is ContentRequest {
  return isRecord(message) && (message.type === 'get-page-status' || message.type === 'toggle-original');
}

/** Tells the background script how many images of this tab are waiting, for the badge. */
export async function reportQueueSize(pending: number): Promise<void> {
  const message: QueueChangedMessage = { type: 'queue-changed', pending };
  try {
    await browser.runtime.sendMessage(message);
  } catch (error) {
    // The background does not answer this message; only real failures matter.
    if (!isNoAnswerError(error)) {
      throw error;
    }
  }
}

/** Asks the background script to check the configured server. */
export async function requestServerCheck(): Promise<ServerStatus> {
  const request: BackgroundRequest = { type: 'check-server' };
  const response: unknown = await browser.runtime.sendMessage(request);
  if (!isServerStatus(response)) {
    throw new Error('The background script returned an invalid server status.');
  }
  return response;
}

/**
 * Sends a request to the content script of a tab. Resolves to `null` when the
 * page has no content script (not enabled, not loaded yet, or a browser page)
 * or when it did not answer. Other failures (e.g. a closed tab) are rethrown.
 */
export async function sendToContentScript(tabId: number, request: ContentRequest): Promise<unknown> {
  try {
    return await browser.tabs.sendMessage(tabId, request);
  } catch (error) {
    if (isNoAnswerError(error)) {
      return null;
    }
    throw error;
  }
}

/** True for the errors browsers give when nobody listens to a message, or nobody answers it. */
function isNoAnswerError(error: unknown): boolean {
  const message = errorMessage(error);
  return NO_ANSWER_ERRORS.some((text) => message.includes(text));
}

/** Status of the page in a tab, or `null` when there is no content script to answer. */
export async function requestPageStatus(tabId: number): Promise<PageStatus | null> {
  const response = await sendToContentScript(tabId, { type: 'get-page-status' });
  return isPageStatus(response) ? response : null;
}

/** Type guard for the content script's answer to `get-page-status`. */
export function isPageStatus(value: unknown): value is PageStatus {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return isCount(record.translatedImages) && isCount(record.totalImages) && typeof record.showingOriginal === 'boolean';
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Message of a rejection. Firefox can reject with errors from another realm,
 * where `instanceof Error` is false, so any object with a string message counts.
 */
function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return String(error);
}
