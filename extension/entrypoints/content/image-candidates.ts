/** Smaller images are icons, avatars or ads, not comic pages. */
export const MIN_IMAGE_SIDE_PX = 300;

/**
 * Protocols the background script can download. `blob:` URLs belong to the
 * page and cannot be read from the background; they are left for later.
 */
const FETCHABLE_PROTOCOLS = new Set(['http:', 'https:', 'data:']);

/** True when the image (already loaded) is big enough to be a page or a strip slice. */
export function isLargeEnough(image: HTMLImageElement): boolean {
  return image.naturalWidth >= MIN_IMAGE_SIDE_PX && image.naturalHeight >= MIN_IMAGE_SIDE_PX;
}

/**
 * Absolute URL of the picture the browser shows (`currentSrc` follows `srcset`
 * and `<picture>`), or `null` when the background cannot download it.
 */
export function translatableImageUrl(image: HTMLImageElement, baseUrl: string = document.baseURI): string | null {
  const source = image.currentSrc || image.getAttribute('src') || '';
  if (source === '') {
    return null;
  }
  try {
    const url = new URL(source, baseUrl);
    return FETCHABLE_PROTOCOLS.has(url.protocol) ? url.href : null;
  } catch (error) {
    if (error instanceof TypeError) {
      return null;
    }
    throw error;
  }
}
