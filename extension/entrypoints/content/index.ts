import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { isContentRequest, reportQueueSize } from '@/utils/messages';
import { loadSettings, watchSettings } from '@/utils/settings';
import { createPageTranslator } from './page-translator';
import { createProximityObserver } from './proximity-observer';
import { startTranslation } from './translation-port';

/** Marks the page once the script runs, because the background may inject it again. */
const STARTED_FLAG = '__kmoverlayPageTranslatorStarted';

type ContentScope = typeof globalThis & { [STARTED_FLAG]?: boolean };

export default defineContentScript({
  // Registered by the background only on the sites the user turned on (see utils/content-script-registration.ts).
  registration: 'runtime',
  main(context) {
    const scope = globalThis as ContentScope;
    if (scope[STARTED_FLAG]) {
      return;
    }
    scope[STARTED_FLAG] = true;

    const translator = createPageTranslator(location.hostname, {
      startTranslation,
      createProximityObserver,
      reportQueueSize: (pending) => {
        reportQueueSize(pending).catch((error: unknown) => {
          console.error('KMOverlay: could not update the badge.', error);
        });
      },
    });

    const handleMessage = (message: unknown, _sender: unknown, sendResponse: (response: unknown) => void) => {
      if (!isContentRequest(message)) {
        return undefined;
      }
      if (message.type === 'toggle-original') {
        translator.toggleOriginal();
      }
      const status = translator.pageStatus();
      // While the site is off there is nothing to report: no answer means "no translator" to the popup.
      if (status !== null) {
        sendResponse(status);
      }
      return undefined;
    };

    browser.runtime.onMessage.addListener(handleMessage);
    const stopWatching = watchSettings((settings) => translator.applySettings(settings));
    loadSettings().then(
      (settings) => translator.applySettings(settings),
      (error: unknown) => console.error('KMOverlay: could not load the settings.', error),
    );

    // An extension update or reload invalidates this script; a new one takes over.
    context.onInvalidated(() => {
      translator.stop();
      stopWatching();
      browser.runtime.onMessage.removeListener(handleMessage);
      scope[STARTED_FLAG] = false;
    });
  },
});
