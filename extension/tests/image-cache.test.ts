import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { deleteIndexedDatabase } from '@/entrypoints/options/cache-section';
import { createImageCache, IMAGE_CACHE_DATABASE_NAME, imageCacheKey } from '@/utils/image-cache';

const PAGE = { imageDataUrl: 'data:image/webp;base64,AAAA', pipelineVersion: 'ocr-1+rapidocr-1+ollama:gemma3:4b:prompt-2' };
/** Each data URL character counts as 2 bytes. */
const BYTES_PER_PAGE = PAGE.imageDataUrl.length * 2;

describe('createImageCache', () => {
  it('keys pages by image hash and languages', () => {
    expect(imageCacheKey('abc', 'en', 'pt-BR')).toBe('abc|en|pt-BR');
  });

  it('stores and returns translated pages, and counts them', async () => {
    const cache = createImageCache({ factory: new IDBFactory() });

    expect(await cache.get('missing')).toBeNull();
    await cache.put('page-1', PAGE);
    await cache.put('page-2', PAGE);

    expect(await cache.get('page-1')).toEqual(PAGE);
    expect(await cache.stats()).toEqual({ pages: 2, bytes: 2 * BYTES_PER_PAGE });
  });

  it('drops the least recently used pages beyond the size limit', async () => {
    let clock = 0;
    const cache = createImageCache({
      factory: new IDBFactory(),
      maxBytes: 2 * BYTES_PER_PAGE,
      now: () => ++clock,
    });
    await cache.put('old', PAGE);
    await cache.put('used', PAGE);
    await cache.get('old'); // reading it makes it recent again

    await cache.put('new', PAGE);

    expect(await cache.get('used')).toBeNull();
    expect(await cache.get('old')).toEqual(PAGE);
    expect(await cache.get('new')).toEqual(PAGE);
    expect((await cache.stats()).pages).toBe(2);
  });

  it('lets the options page delete it and works again afterwards', async () => {
    const factory = new IDBFactory();
    const cache = createImageCache({ factory });
    await cache.put('page-1', PAGE);

    // The open connection closes itself, so the deletion is not blocked.
    await expect(deleteIndexedDatabase(IMAGE_CACHE_DATABASE_NAME, factory)).resolves.toBe('deleted');

    expect(await cache.get('page-1')).toBeNull();
    await cache.put('page-2', PAGE);
    expect(await cache.get('page-2')).toEqual(PAGE);
  });
});
