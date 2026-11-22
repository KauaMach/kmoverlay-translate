/** IndexedDB database of translated pages, shared by the background (writes) and the options page. */
export const IMAGE_CACHE_DATABASE_NAME = 'kmoverlay-image-cache';
/** Translated pages kept in this browser; beyond this size the least recently used go first. */
export const MAX_CACHE_BYTES = 200 * 1024 * 1024;

const DATABASE_VERSION = 1;
/** Small records (key, version, size, last use), read when deciding what to drop. */
const ENTRIES_STORE = 'entries';
/** The translated pictures, kept apart so the eviction never has to load them. */
const IMAGES_STORE = 'images';
/** JavaScript strings are UTF-16; a fair estimate of the stored size of a data URL. */
const BYTES_PER_CHARACTER = 2;

/** A translated page as stored in the cache. */
export interface CachedTranslation {
  imageDataUrl: string;
  /** Version of the server pipeline that made it; another version means it is stale. */
  pipelineVersion: string;
}

/** What the options page shows about the cache. */
export interface CacheStats {
  pages: number;
  bytes: number;
}

/** Cache of translated pages in this browser. */
export interface ImageCache {
  /** The stored translation, or `null`; a hit counts as a recent use. */
  get(key: string): Promise<CachedTranslation | null>;
  /** Stores a translation and drops the least recently used ones beyond the size limit. */
  put(key: string, translation: CachedTranslation): Promise<void>;
  stats(): Promise<CacheStats>;
}

export interface ImageCacheOptions {
  /** IndexedDB to use; tests pass an in-memory one. */
  factory?: IDBFactory;
  maxBytes?: number;
  now?: () => number;
}

interface EntryRecord {
  key: string;
  pipelineVersion: string;
  size: number;
  lastUsed: number;
}

interface ImageRecord {
  key: string;
  imageDataUrl: string;
}

/** Key of a page: the hash of the original image and the languages it was translated between. */
export function imageCacheKey(imageSha256: string, sourceLanguage: string, targetLanguage: string): string {
  return `${imageSha256}|${sourceLanguage}|${targetLanguage}`;
}

/** Opens the cache lazily; the connection closes by itself when the options page clears it. */
export function createImageCache(options: ImageCacheOptions = {}): ImageCache {
  const maxBytes = options.maxBytes ?? MAX_CACHE_BYTES;
  const now = options.now ?? Date.now;
  let connection: Promise<IDBDatabase> | null = null;

  const database = (): Promise<IDBDatabase> => {
    connection ??= openDatabase(options.factory ?? indexedDB).then(
      (db) => {
        // Another page deletes the database ("Limpar cache"): let it, and reopen on the next use.
        db.onversionchange = () => {
          db.close();
          connection = null;
        };
        return db;
      },
      (error: unknown) => {
        connection = null;
        throw error;
      },
    );
    return connection;
  };

  return {
    async get(key) {
      const transaction = (await database()).transaction([ENTRIES_STORE, IMAGES_STORE], 'readwrite');
      const completion = transactionDone(transaction);
      const entries = transaction.objectStore(ENTRIES_STORE);
      const entry = await requestResult<EntryRecord | undefined>(entries.get(key));
      const image = entry && (await requestResult<ImageRecord | undefined>(transaction.objectStore(IMAGES_STORE).get(key)));
      if (entry && image) {
        entries.put({ ...entry, lastUsed: now() });
      }
      await completion;
      return entry && image ? { imageDataUrl: image.imageDataUrl, pipelineVersion: entry.pipelineVersion } : null;
    },

    async put(key, translation) {
      const db = await database();
      const transaction = db.transaction([ENTRIES_STORE, IMAGES_STORE], 'readwrite');
      const completion = transactionDone(transaction);
      const entry: EntryRecord = {
        key,
        pipelineVersion: translation.pipelineVersion,
        size: translation.imageDataUrl.length * BYTES_PER_CHARACTER,
        lastUsed: now(),
      };
      transaction.objectStore(ENTRIES_STORE).put(entry);
      transaction.objectStore(IMAGES_STORE).put({ key, imageDataUrl: translation.imageDataUrl } satisfies ImageRecord);
      await completion;
      await evict(db, maxBytes);
    },

    async stats() {
      const transaction = (await database()).transaction(ENTRIES_STORE, 'readonly');
      const entries = await requestResult<EntryRecord[]>(transaction.objectStore(ENTRIES_STORE).getAll());
      return { pages: entries.length, bytes: entries.reduce((total, entry) => total + entry.size, 0) };
    },
  };
}

/** Drops the least recently used pages until the cache fits in `maxBytes`. */
async function evict(db: IDBDatabase, maxBytes: number): Promise<void> {
  const transaction = db.transaction([ENTRIES_STORE, IMAGES_STORE], 'readwrite');
  const completion = transactionDone(transaction);
  const entries = await requestResult<EntryRecord[]>(transaction.objectStore(ENTRIES_STORE).getAll());
  let total = entries.reduce((sum, entry) => sum + entry.size, 0);
  for (const entry of entries.sort((a, b) => a.lastUsed - b.lastUsed)) {
    if (total <= maxBytes) {
      break;
    }
    transaction.objectStore(ENTRIES_STORE).delete(entry.key);
    transaction.objectStore(IMAGES_STORE).delete(entry.key);
    total -= entry.size;
  }
  await completion;
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  const request = factory.open(IMAGE_CACHE_DATABASE_NAME, DATABASE_VERSION);
  request.onupgradeneeded = () => {
    request.result.createObjectStore(ENTRIES_STORE, { keyPath: 'key' });
    request.result.createObjectStore(IMAGES_STORE, { keyPath: 'key' });
  };
  return requestResult(request);
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
  });
}
