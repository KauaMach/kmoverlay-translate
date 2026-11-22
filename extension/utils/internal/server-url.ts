// Lives outside the top level of `utils/` so WXT's auto-import scan does not
// expose it twice: `server-status.ts` re-exports it as the public entry point,
// and `settings.ts` imports it from here to avoid an import cycle.

const SERVER_PROTOCOLS = new Set(['http:', 'https:']);
const TRAILING_SLASHES = /\/+$/;

/**
 * Validates a server address typed by the user and returns it without a
 * trailing slash, or `null` when it is not an http(s) URL. Addresses with
 * credentials are rejected because the token is the only supported secret.
 */
export function normalizeServerUrl(value: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch (error) {
    if (error instanceof TypeError) {
      return null;
    }
    throw error;
  }
  if (!SERVER_PROTOCOLS.has(parsed.protocol) || parsed.username !== '' || parsed.password !== '') {
    return null;
  }
  const path = parsed.pathname.replace(TRAILING_SLASHES, '');
  return `${parsed.protocol}//${parsed.host}${path}`;
}
