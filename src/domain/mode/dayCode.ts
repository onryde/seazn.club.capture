import { DAY_PATH, HTTPS_LINK } from '@/domain/mode/recognise';

/**
 * A Match Day code as the port sends it (S4 design §3, §9): the origin its link names and the link's `md_` token, a
 * bearer for every match of the day. Never log it, print it or put it in a test snapshot.
 */
export type SavedDayCode = { readonly origin: string; readonly token: string };

/**
 * The code a day link names, read by the recogniser's own patterns (`recognise.ts`): `https://`, a host of the build's
 * (no userinfo, no port), `/day/md_…`. The saved code keeps the QR whole (`code.matchday`), so this is how its origin
 * and token are read back; anything else, a link this build would not recognise included, names no code.
 */
export function dayCodeOf(raw: string, hosts: readonly string[]): SavedDayCode | null {
  const match = HTTPS_LINK.exec(raw.trim());
  if (match === null) return null;
  const host = (match[1] ?? '').toLowerCase();
  if (!hosts.includes(host)) return null;
  const token = DAY_PATH.exec(match[2] ?? '')?.[1];
  return token === undefined ? null : { origin: `https://${host}`, token };
}
