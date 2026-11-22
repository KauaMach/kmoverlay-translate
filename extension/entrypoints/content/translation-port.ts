import { browser } from 'wxt/browser';
import {
  TRANSLATE_PORT_NAME,
  isTranslateImageResult,
  type TranslateImageRequest,
  type TranslateImageResult,
} from '@/utils/messages';

export const CONNECTION_LOST_REASON = 'A extensão parou de responder; recarregue a página.';
export const INVALID_ANSWER_REASON = 'Resposta inválida da extensão.';

/** A translation in progress; cancelling it stops the work in the background. */
export interface TranslationHandle {
  cancel(): void;
}

/** Starts the translation of one image and calls `onResult` exactly once (unless cancelled). */
export type TranslationStarter = (
  request: TranslateImageRequest,
  onResult: (result: TranslateImageResult) => void,
) => TranslationHandle;

/**
 * Opens one port per image. The background answers once and closes it;
 * closing it from here cancels the download and the server call.
 */
export const startTranslation: TranslationStarter = (request, onResult) => {
  const port = browser.runtime.connect({ name: TRANSLATE_PORT_NAME });
  let settled = false;

  const settle = (result: TranslateImageResult): void => {
    if (!settled) {
      settled = true;
      onResult(result);
    }
  };

  port.onMessage.addListener((message: unknown) => {
    settle(isTranslateImageResult(message) ? message : { state: 'error', reason: INVALID_ANSWER_REASON });
  });
  // The background answers before closing; closing without an answer means it stopped (reload, crash).
  port.onDisconnect.addListener(() => settle({ state: 'error', reason: CONNECTION_LOST_REASON }));
  port.postMessage(request);

  return {
    cancel() {
      if (!settled) {
        settled = true;
        port.disconnect();
      }
    },
  };
};
