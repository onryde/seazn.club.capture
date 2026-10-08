/**
 * A short fingerprint of a QR plan's painted path (FNV-1a, 32 bits, hex). The SeaznQr stand-in (setup-ui.ts) carries it
 * as `data-digest`, so a test can tell WHICH link a code was drawn for without the link or the whole path in the
 * markup: the test computes the same digest from the real encoder's plan for the link it expects.
 */
export function pathDigest(path: string): string {
  let hash = 0x811c9dc5;
  for (let at = 0; at < path.length; at += 1) {
    hash ^= path.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
