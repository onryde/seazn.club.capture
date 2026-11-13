import { err, ok } from '@/domain/Result';
import { parseRefusal } from '@/domain/matchday/refusalWire';
import { all, field, oneOf, scalar, successData, word, type Read } from '@/domain/matchday/wire';

/**
 * `POST /api/v1/match-day-code/fixtures/{id}/scoring-link`, opening a match (capture-matchday-open.v1; S4 Match Day
 * design §6, §9.4). Its 200 is the match's own scoring link and the sport whose pad it opens, or "finished": nothing to
 * score. A match outside the code's scope is never a 200: it is the refusal 403 MD_OUT_OF_SCOPE ({@link openRefused}).
 * The url is a credential: it goes to the one caller that asked, and no error here ever names it.
 */
export type OpenAnswer =
  | { readonly kind: 'link'; readonly url: string; readonly sportKey: string }
  | { readonly kind: 'finished' }
  | { readonly kind: 'refused'; readonly code: 'MD_OUT_OF_SCOPE' };

/** The contract's `url` pattern: the printed QR's `/score/dl_…` link, https only. */
const SCORING_LINK = /^https:\/\/[^/]+\/score\/dl_[A-Za-z0-9_-]{43}$/;

const KIND: ReadonlyMap<string, 'link' | 'finished'> = new Map([
  ['link', 'link'],
  ['finished', 'finished'],
]);

const FINISHED: OpenAnswer = { kind: 'finished' };
const OUT_OF_SCOPE: OpenAnswer = { kind: 'refused', code: 'MD_OUT_OF_SCOPE' };

const scoringLink = scalar(
  (raw) => (typeof raw === 'string' && SCORING_LINK.test(raw) ? raw : undefined),
  'expected a scoring link',
);

/** The open's 200, or why it was refused. */
export function parseOpen(body: unknown): Read<OpenAnswer> {
  const data = successData(body);
  if (!data.ok) return data;
  const kind = field(oneOf(KIND))(data.value, 'kind', '');
  if (!kind.ok) return kind;
  if (kind.value === 'finished') return ok(FINISHED);
  const link = all({
    url: field(scoringLink)(data.value, 'url', ''),
    sportKey: field(word)(data.value, 'sport_key', ''),
  });
  return link.ok ? ok({ kind: 'link', ...link.value }) : err(link.error);
}

/** A refused open: MD_OUT_OF_SCOPE is the open's own answer; any other word is the code's, and is null here. */
export function openRefused(status: number, body: unknown): OpenAnswer | null {
  return parseRefusal(status, body)?.code === 'MD_OUT_OF_SCOPE' ? OUT_OF_SCOPE : null;
}
