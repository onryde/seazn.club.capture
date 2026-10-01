import { httpsOrigin } from '@/domain/credentials/wire';

/**
 * I1: the overlay WebView keeps to its own page's origin — https, the same
 * host and the same port. Everything else is refused, never handed to another
 * app: another https host, http, `intent:`, `tel:`, `about:blank`, and the
 * userinfo and backslash tricks `httpsOrigin` already declines to read. An
 * overlay URL with no https origin trusts nothing.
 */
export function staysOnOverlayOrigin(overlayUrl: string, target: string): boolean {
  const origin = httpsOrigin(overlayUrl);
  return origin !== null && httpsOrigin(target) === origin;
}

const ANY_HOST = /^[a-z][a-z0-9+.-]*:\/\/([^/?#@:\\\s]+)(?::\d+)?(?:[/?#]|$)/i;

/**
 * The host a refused navigation aimed at, for the session record: never its
 * path, query or userinfo, which can carry anything. `null` when the URL has
 * no host this can read safely (`tel:`, `about:blank`, userinfo).
 */
export function navigationHost(url: string): string | null {
  return ANY_HOST.exec(url)?.[1]?.toLowerCase() ?? null;
}
