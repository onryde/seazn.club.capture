import { expect } from 'vitest';
import { layout, space } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';
import { loadFont } from '../../../test/fontMetrics';
import { linesOf } from '../../../test/textFit';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';

// Shared by the cricket fit files (cricketFit.board/keys/totals/lines.test.ts): fonts, width helpers and fixture
// constants. Not a test file and not a barrel. Each file reads its keys through its own `reader()` and sweeps its own
// prefixes; cricketFit.sweep.test.ts proves the prefixes partition every cricket key.

export const LANGUAGES = [
  ['en', en],
  ['es', es],
  ['fr', fr],
  ['nl', nl],
] as const;
export type Dictionary = Readonly<Record<string, string>>;
export const WIDTHS = [320, 360] as const;

export const barlow600 = loadFont('barlow-condensed-600');
export const barlow700 = loadFont('barlow-condensed-700');
export const geist500 = loadFont('geist-500');
export const geist400 = loadFont('geist-400');
export const mono = loadFont('geist-mono-400');

/** A file's one reader of dictionary text: every key a fit case reads goes through `said`; `swept` is what the file read. */
export function reader() {
  const swept = new Set<string>();
  const said = (dictionary: Dictionary, key: string): string => {
    const text = dictionary[key] ?? '';
    expect(text, key).not.toBe('');
    swept.add(key);
    return text;
  };
  return { said, swept };
}
export const fill = (text: string, vars: Readonly<Record<string, string | number>>) =>
  Object.entries(vars).reduce(
    (out, [name, value]) => out.replace(`{${name}}`, String(value)),
    text,
  );

/** `scoreCompact`: Barlow Condensed 700 at 64, tabular digits (`zero.tf`); the slash at its own advance. */
export const scoreWidth = (text: string) =>
  [...text].reduce(
    (sum, char) =>
      sum +
      (/\d/.test(char)
        ? barlow700.advanceOfName('zero.tf')
        : barlow700.advance(char.codePointAt(0) ?? 0)) *
        typeScale.scoreCompact.fontSize,
    0,
  );
/** `label`: Barlow Condensed 600 at 20, as typed. The overs beside the score, a batter's and the bowler's names. */
export const labelWidth = (text: string) => barlow600.width(text, typeScale.label.fontSize);
/** `control`: Geist 500 at 14. The innings line and the chase line. */
export const controlWidth = (text: string) => geist500.width(text, typeScale.control.fontSize);
/** `metricValue`: Geist Mono 400 at 16. A batter's runs (balls) and the bowler's O-M-R-W. */
export const figuresWidth = (text: string) => mono.width(text, typeScale.metricValue.fontSize);
/** `metricUnit`: Geist 500 at 12. The over's label and a free hit beside it. */
export const unitWidth = (text: string) => geist500.width(text, typeScale.metricUnit.fontSize);

/** The pad's column: the screen less its padding (space.md a side). */
export const column = (width: number) => width - 2 * space.md;
/** A crease row: the striker's mark, then the name, then the figures, `space.xs` apart. */
export const nameRoom = (width: number, figures: string) =>
  column(width) - space.md - 2 * space.xs - figuresWidth(figures);

/** The batting team's name over the score (T19 fix 5): a usual one, and the longest the fit tests carry. */
export const TEAM_TWELVE = 'Hillcrest CC';
export const TEAM_LONGEST = 'Southern Districts Cricket Association XI';

/** The longest numbers a board can show: an unlimited innings' score and overs, a long chase, a long spell. */
export const SCORE = '999/10';
export const OVERS = '189.5';
/** Three digits of overs at Barlow's widest digit: the overs' box (`layout.boardOvers`) holds any the board shows. */
export const WIDEST_OVERS = '888.8';
export const CHASE = { runs: 999, count: 120 };
export const BATTER = '199 (120)';
export const SPELL = '35.4-10-120-10';
/** The longest name a crease row must show at least a part of: the room must hold its first word. */
export const LONG_NAME = 'Wolstenholme-Fitzgerald';

/** A person with a long double-barrelled name, as a team sheet can hold one (26 characters). */
export const PERSON = 'M. Wolstenholme-Fitzgerald';

/** `body`: Geist 400 at 15. Rules, hints, the scorecard's notes. */
export const bodyOf = (text: string) => geist400.width(text, typeScale.body.fontSize);
/** `status`: Geist 400 at 13.5. A scorecard line's how-out. */
export const statusOf = (text: string) => geist400.width(text, typeScale.status.fontSize);
/** Caps and letter-spacing as a display role sets them: `panelTitle`, `action`, `state`. */
export const capsOf = (role: 'panelTitle' | 'action' | 'state') => (text: string) =>
  barlow700.width(text.toUpperCase(), typeScale[role].fontSize) +
  typeScale[role].letterSpacing * [...text].length;
/** A ghost button's box: its word at `control`, `space.md` padding and the border a side. */
export const ghostBox = (text: string) => controlWidth(text) + 2 * space.md + 2 * layout.iconBorder;
/** A `Button`'s box: its caps label and `space.xl` a side, at least 200. */
export const buttonBox = (text: string) => Math.max(200, capsOf('action')(text) + 2 * space.xl);
/**
 * Every word of a text fits the room: what wraps is never broken mid-word, and nothing overflows. A word is what lies
 * between spaces and hyphens: the line breaker (UAX 14, on Android ICU) may break after a hyphen, which `linesOf` does
 * not model, so a hyphenated name is held to its halves. Whether a name really breaks there is the device check's.
 */
export const wordsFit = (text: string, room: number, measure: (text: string) => number) =>
  text.split(/ |(?<=-)/).every((piece) => measure(piece) <= room);

export const RESULT_KEYS = [
  'runs.other',
  'wickets.other',
  'innings_and_runs.other',
  'super_over',
  'boundary_count',
  'win',
  'award',
  'tie',
  'draw',
  'no_result',
  'double_walkover',
].map((key) => `scoring.cricket.result.${key}`);
/** The fixtures' side names are twelve characters; a thirty-character club's is the long case. */
export const TWELVE = 'Hillcrest CC';
export const THIRTY = 'Bishops Stortford Cricket Club';

/**
 * Which fit file owns which `scoring.cricket.` keys: a prefix is `scoring.cricket.` + the entry, matched as the whole key
 * or its dotted ancestor (`=` first: the whole key only). Each file's sweep asks that its own fit cases read every key it owns; `cricketFit.sweep.test.ts`
 * asks that every key in the dictionary is owned by exactly one file, so a new key with no owner, or two, is a red test.
 * (Another file may read a key it does not own: a result word is measured in the keys' file and again in the lines'.)
 */
export const CRICKET_PREFIX = 'scoring.cricket.';
export type FitFile = 'board' | 'keys' | 'totals' | 'lines';
export const OWNED: Readonly<Record<FitFile, readonly string[]>> = {
  board: [
    'board.chase.other',
    'board.freeHit',
    'board.innings',
    'board.joined',
    'board.need',
    'board.over',
    'board.overLast',
    'board.overs',
    'board.summary',
    'board.superOver',
    'setup.opener',
    'toss',
  ],
  keys: [
    'board.onStrike',
    'bowling',
    'break.chase.other',
    'break.closed',
    'break.line',
    'break.superOver',
    'break.tied',
    'break.tiedAgain',
    'break.title',
    'change',
    'closing',
    'confirm',
    'extras',
    'interruption',
    'key',
    'more',
    'other',
    'out.kind',
    'players',
    'powerplay',
    'result.award',
    'result.boundary_count',
    'result.double_walkover',
    'result.draw',
    'result.innings_and_runs.other',
    'result.no_result',
    'result.runs.other',
    'result.super_over',
    'result.tie',
    'result.wickets.other',
    'result.win',
    'retire',
    'review',
    'revise',
    'setup.startInnings',
    'wicket',
  ],
  totals: ['totals'],
  lines: [
    'ball',
    'board.chase.one',
    'break.chase.one',
    'break.lead',
    'break.level',
    'break.need',
    'card',
    'entry',
    'event',
    'history',
    'last',
    '=out',
    'out.fielder',
    'out.fielders',
    'result.innings_and_runs.one',
    'result.runs.one',
    'result.wickets.one',
    'rules',
    'setup.back',
    'setup.bowler',
    'setup.down',
    'setup.next',
    'setup.openers',
    'setup.order',
    'setup.orderHint',
    'setup.up',
    'tallyNone',
    'tallySaid',
  ],
};
export const FIT_FILES = Object.keys(OWNED) as readonly FitFile[];
export const ownsKey = (file: FitFile, key: string): boolean =>
  OWNED[file].some((entry) => {
    const exact = entry.startsWith('=');
    const prefix = CRICKET_PREFIX + (exact ? entry.slice(1) : entry);
    return key === prefix || (!exact && key.startsWith(`${prefix}.`));
  });
/** Every `scoring.cricket.` key in English: the keys the other languages must have too. */
export const cricketKeys = (dictionary: Dictionary = en): readonly string[] =>
  Object.keys(dictionary).filter((key) => key.startsWith(CRICKET_PREFIX));

/** The keys no fit case read. An empty list is a failure, not an empty answer: a sweep of nothing proves nothing. */
export function unmeasured(keys: readonly string[], read: ReadonlySet<string>): readonly string[] {
  if (keys.length === 0) throw new Error(`no ${CRICKET_PREFIX} keys to sweep`);
  return keys.filter((key) => !read.has(key));
}
