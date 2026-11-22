import { h } from '@/utils/dom';
import { formatBytes } from '@/utils/format';
import { createSectionCard } from './page-parts';

/** IndexedDB database of translated images (filled by the content script from Fase 3 on). */
export const IMAGE_CACHE_DATABASE_NAME = 'kmoverlay-image-cache';
export const CONFIRM_CLEAR_CACHE_TEXT = 'Apagar as traduções guardadas neste navegador?';
export const SIZE_UNAVAILABLE_TEXT = 'Tamanho indisponível';
export const CACHE_CLEARED_TEXT = 'Cache limpo.';
export const CACHE_CLEAR_PENDING_TEXT = 'O cache será apagado quando as páginas traduzidas forem fechadas.';
export const CACHE_CLEAR_FAILED_TEXT = 'Não foi possível limpar o cache.';

/** Result of deleting the cache database. */
export type CacheDeletion = 'deleted' | 'blocked';

/** Browser features the section uses, replaceable in tests. */
export interface CacheSectionDependencies {
  estimate(): Promise<StorageEstimate | null>;
  confirm(message: string): boolean;
  deleteDatabase(name: string): Promise<CacheDeletion>;
}

/** Text next to "Neste navegador": the space this extension uses, when the browser tells it. */
export function describeCacheUsage(estimate: StorageEstimate | null): string {
  return typeof estimate?.usage === 'number' ? `${formatBytes(estimate.usage)} em uso` : SIZE_UNAVAILABLE_TEXT;
}

/**
 * Deletes an IndexedDB database. "blocked" means a page still has it open; the
 * browser deletes it as soon as that page closes it, so it is not a failure.
 */
export function deleteIndexedDatabase(name: string, factory: IDBFactory = indexedDB): Promise<CacheDeletion> {
  return new Promise((resolve, reject) => {
    const request = factory.deleteDatabase(name);
    request.addEventListener('success', () => resolve('deleted'));
    request.addEventListener('blocked', () => resolve('blocked'));
    request.addEventListener('error', () => reject(request.error ?? new Error(`Could not delete the "${name}" database.`)));
  });
}

const defaultDependencies: CacheSectionDependencies = {
  // `navigator.storage` is missing on pages that are not a secure context.
  estimate: async () => (navigator.storage ? navigator.storage.estimate() : null),
  confirm: (message) => window.confirm(message),
  deleteDatabase: (name) => deleteIndexedDatabase(name),
};

/** "Cache" section: space used by this browser and a button to clear it. */
export function createCacheSection(dependencies: CacheSectionDependencies = defaultDependencies): HTMLElement {
  const usage = h('span', { class: 'cache-row__usage', 'aria-live': 'polite' }, ['…']);
  const status = h('p', { class: 'field__hint', role: 'status' });

  const refreshUsage = async (): Promise<void> => {
    try {
      usage.textContent = describeCacheUsage(await dependencies.estimate());
    } catch (error) {
      console.error('KMOverlay: could not read the storage estimate.', error);
      usage.textContent = SIZE_UNAVAILABLE_TEXT;
    }
  };

  const clearCache = async (): Promise<void> => {
    if (!dependencies.confirm(CONFIRM_CLEAR_CACHE_TEXT)) {
      return;
    }
    try {
      const result = await dependencies.deleteDatabase(IMAGE_CACHE_DATABASE_NAME);
      status.textContent = result === 'deleted' ? CACHE_CLEARED_TEXT : CACHE_CLEAR_PENDING_TEXT;
    } catch (error) {
      console.error('KMOverlay: could not clear the image cache.', error);
      status.textContent = CACHE_CLEAR_FAILED_TEXT;
    }
    await refreshUsage();
  };

  void refreshUsage();
  return createSectionCard(
    'cache',
    'Cache',
    [
      h('div', { class: 'cache-row' }, [
        h('div', { class: 'cache-row__text' }, [h('span', { class: 'cache-row__title' }, ['Neste navegador']), usage]),
        h('button', { type: 'button', class: 'button button--danger', onClick: () => void clearCache() }, [
          'Limpar cache do navegador',
        ]),
      ]),
      status,
      h('p', { class: 'field__hint' }, [
        'O cache do servidor é compartilhado entre PC e celular e não é apagado aqui.',
      ]),
    ],
    'compact',
  );
}
