/**
 * A made-up Match Day code (MD-2; S4 design §3): `md_` and 43 base64url characters, the shape the web mints. Never
 * paste a real code into a test: it is a bearer that opens every match of a day.
 */
export const FIXTURE_DAY_TOKEN = 'md_Fake-Day_0123456789abcdefghijklmnopqrstuvwx';

/** The day's QR: `https://<build host>/day/md_…` (S4 design §9 item 2). */
export const dayLink = (host = 'stg.seazn.club', token: string = FIXTURE_DAY_TOKEN): string =>
  `https://${host}/day/${token}`;
