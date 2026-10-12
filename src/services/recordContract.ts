/**
 * The web's record contract, `contracts/capture-record.v1.json` (vendored at web 53f28ebfc; the owner approved its
 * design on 2026-10-12): what Send record to Seazn posts, and what it reads back. `recordContract.test.ts` holds every
 * value here to the vendored file, so a re-vendor that moves one reds until this file moves with it.
 */

/** `POST /api/v1/capture/codes/{code}/records`: the code's URL as the app holds it (`codeUrl`), then this. */
export const RECORD_PATH = '/records';

/** At most 1000 non-empty lines and 1 MB (1,048,576 bytes) of the body the server reads: the app sends no gzip. */
export const RECORD_MAX_LINES = 1000;
export const RECORD_MAX_BYTES = 1_048_576;

/** The 201's `ref` (the web's P9): `R-` and four to eight upper-case Crockford characters, with no I, L, O or U. */
export const RECORD_REF = /^R-[0-9A-HJKMNP-TV-Z]{4,8}$/;

/**
 * A line's `at`, the beat's (R5): ISO 8601, calendar-exact, with a zone. The pattern is the contract's, character for
 * character; its `date-time` format also wants the seconds, which the pattern leaves optional. Both writers send
 * `2026-10-11T21:19:03.123Z`. `Date.parse` is no check: V8 reads 30 February as 2 March, and takes a time with no
 * seconds or in RFC 2822's words.
 */
export const RECORD_AT =
  /^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))T(?:(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|([+-](?:[01]\d|2[0-3]):[0-5]\d)))$/;
const SECONDS = /T\d\d:\d\d:\d\d/;

export const isRecordTime = (at: unknown): boolean =>
  typeof at === 'string' && RECORD_AT.test(at) && SECONDS.test(at);

/** A line's `level`: absent means info; native writes `***` for a level it does not vet (`SessionRecord.levelWord`). */
export const RECORD_LEVELS: ReadonlySet<string> = new Set([
  'debug',
  'info',
  'warn',
  'error',
  '***',
]);

/**
 * Every key a line may carry, by the contract's class: 92 at 53f28ebfc, which the web took from the allow-list at
 * capture 7ea8f63. Five keys the app writes came after it, and are on no list here until the web adds them
 * (`recordContract.test.ts` names them).
 */
export const RECORD_LINE_KEYS: ReadonlySet<string> = new Set([
  // The line's own.
  'at',
  'kind',
  'level',
  // plain: a field named `kind` is written `field_kind` (CD7). `sid` and `tokenTag` are narrowed by the contract.
  'action',
  'answer',
  'appVersion',
  'attempt',
  'cause',
  'claim',
  'count',
  'delivery',
  'endReason',
  'error',
  'exit',
  'failure',
  'field',
  'field_kind',
  'from',
  'host',
  'intent',
  'key',
  'lastEnd',
  'lock',
  'mode',
  'ms',
  'notReady',
  'op',
  'phase',
  'problem',
  'reason',
  'refusal',
  'result',
  'retryAfterS',
  'rootError',
  'route',
  'scene',
  'shed',
  'side',
  'sid',
  'site',
  'slot',
  'source',
  'startFailed',
  'state',
  'status',
  'tag',
  'to',
  'tokenTag',
  'transport',
  'word',
  // publicUrl.
  'url',
  'playbackUrl',
  'overlayUrl',
  // text.
  'message',
  'problems',
  // scalars: a number, a boolean or null only.
  'audioFps',
  'camera',
  'counted',
  'encodeListed',
  'exitAtMs',
  'failed',
  'gapMs',
  'granted',
  'headroom',
  'held',
  'intervalMs',
  'lagGrowthMs',
  'lagMs',
  'late',
  'listed',
  'minuteEpochMs',
  'msSinceAdvance',
  'ok',
  'on',
  'outageMs',
  'pickHeight',
  'pickWidth',
  'publishedMs',
  'rebaselined',
  'rebuilds',
  'refusedSid',
  'sameArea',
  'sent',
  'sinceLastMs',
  'sound',
  'srtOffered',
  'stalledMs',
  'stopped',
  'suppressed',
  'validated',
  'videoFps',
  'wasLive',
]);

/**
 * Q4 of the web's record design (batch 11's answers): the vendored contract refuses a whole body for one key it does
 * not list, a never key included even masked; by the owner's later ruling (relayed by the web, 2026-10-12) the server
 * drops that line and answers 201. Either way a line the upload's checks passed goes with every such field dropped,
 * which keeps the rest of it, and a line with none goes as written, byte for byte. Share record never comes here: it
 * shares the record as written, masks and all. `line` is a record line (`linesAreSafe` has read it).
 */
export function fitLine(line: string): string {
  const data = JSON.parse(line) as Record<string, unknown>;
  const fields = Object.entries(data);
  const listed = fields.filter(([key]) => RECORD_LINE_KEYS.has(key));
  return listed.length === fields.length ? line : JSON.stringify(Object.fromEntries(listed));
}
