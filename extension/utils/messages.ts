import { browser } from 'wxt/browser';
import { isServerStatus, type ServerStatus } from './server-status';

/** Requests handled by the background script. */
export type BackgroundRequest = { type: 'check-server' };

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

/** Type guard for messages the background script answers. */
export function isBackgroundRequest(message: unknown): message is BackgroundRequest {
  return typeof message === 'object' && message !== null && 'type' in message && message.type === 'check-server';
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
    const message = errorMessage(error);
    if (NO_ANSWER_ERRORS.some((text) => message.includes(text))) {
      return null;
    }
    throw error;
  }
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
