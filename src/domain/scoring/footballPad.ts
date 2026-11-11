import { doneSaid, undoneSaid, type FootballWords } from '@/domain/scoring/footballHistory';
import { footballRuleRows } from '@/domain/scoring/footballRules';
import type { FootballDisplay, FootballPadKey, FootballSide } from '@/domain/scoring/footballTypes';
import {
  withCard,
  type PadCard,
  type PadHalf,
  type PadLastTap,
  type PadMarks,
  type PadSide,
  type PadStart,
  type PadStateCard,
  type PadSync,
  type PadText,
  type PadTool,
  type PadView,
} from '@/domain/scoring/padView';

/**
 * Football on the pad (S2-5 design §6; plan P Task 8): the kit's view of the match. The teams are the halves, home on
 * top, each with its goals (in the shootout, "5 (4)": the match score, then the kicks scored) and its cards as marks; no
 * half takes a tap, the columns' buttons do (`footballBoard`). The bottom row is End of period, while one can be
 * recorded, and More. The fold decides every fact; the pad only draws it.
 */

type Tool = PadTool<FootballPadKey>;
type Text = PadText<FootballPadKey>;

const SYNCED: PadSync = { kind: 'synced' };

export function footballPad(
  display: FootballDisplay,
  sync: PadSync = SYNCED,
): PadView<FootballPadKey> {
  const halves = [half(display, 'first'), half(display, 'second')] as const;
  const view: PadView<FootballPadKey> = {
    halves,
    tally: { shown: '', said: tallySaid(halves) },
    details: { context: display.context, rules: footballRuleRows(display.cfg) },
    start: startOf(display),
    // No strip (owner ruling 146): the clock bar's period line says Extra time, Penalties and the break, so a fact line
    // above the clock would only be an empty band, and the clock sits directly under the header.
    strip: [],
    lastTap: lastTapOf(display),
    sync,
    tools: toolsOf(display),
    card: null,
  };
  return withCard(view, cardOf(display));
}

/** The score as a screen reader says it ("Score: Home FC 2, Away FC 1"). */
const tallySaid = (halves: readonly [PadHalf<FootballPadKey>, PadHalf<FootballPadKey>]): Text => ({
  key: 'scoring.football.tallySaid',
  vars: {
    first: halves[0].label,
    firstGoals: halves[0].value,
    second: halves[1].label,
    secondGoals: halves[1].value,
  },
});

/** The words the pad needs of the match: the teams' names and the config its minutes are counted in. */
export const footballWords = (display: FootballDisplay): FootballWords => ({
  names: { first: display.sides.first.name, second: display.sides.second.name },
  cfg: display.cfg,
});

/**
 * Home's Finished card's score (design §6.7): first side first, the shootout's kicks in brackets ("5–5 (4–1)"). Numbers
 * and punctuation only, as a sport's `resultLine` must be. Nothing until the match is decided, nor for an abandoned one,
 * which was never decided.
 */
export function footballResultLine(display: FootballDisplay): string {
  if (display.phase !== 'decided' || display.enginePhase === 'abandoned') return '';
  const score = `${display.goals.first}–${display.goals.second}`;
  const { shootout } = display;
  return shootout === null
    ? score
    : `${score} (${shootout.scored.first}–${shootout.scored.second})`;
}

/** The card over the score: a recorded result once the match is decided; an abandoned match decided nothing. */
function cardOf(display: FootballDisplay): PadStateCard | null {
  if (display.phase !== 'decided') return null;
  return display.enginePhase === 'abandoned'
    ? { kind: 'cancelled' }
    : { kind: 'resultRecorded', undoLeft: null };
}

// ---------------------------------------------------------------------------------------------------------------
// The halves
// ---------------------------------------------------------------------------------------------------------------

function half(display: FootballDisplay, seat: PadSide): PadHalf<FootballPadKey> {
  const team = display.sides[seat];
  return {
    side: seat,
    label: team.name,
    value: valueOf(display, seat),
    periods: null,
    sub: null,
    marks: marksOf(team),
    serving: null,
    plate: null,
    action: null,
    // Home carries the lime bar, away the lilac, as the match label does (design §6.2).
    bar: seat === 'first' ? 'lit' : 'dim',
    hint: { key: 'scoring.football.hint' },
    tappable: false,
  };
}

/** The goals; once there is a shootout, the goals and then the kicks scored, "5 (4)". */
function valueOf(display: FootballDisplay, seat: PadSide): string {
  const goals = String(display.goals[seat]);
  const { shootout } = display;
  return shootout === null ? goals : `${goals} (${shootout.scored[seat]})`;
}

/** One caution per yellow card and one dismissal per red (a second yellow sends off: it is a red), each said by name. */
function marksOf(team: FootballSide): PadMarks<FootballPadKey> {
  const cards: PadCard[] = [
    ...Array<PadCard>(team.cards.yellow).fill('caution'),
    ...Array<PadCard>(team.cards.red).fill('dismissal'),
  ];
  const said = cards.map((card): Text => ({
    key: card === 'caution' ? 'scoring.football.card.yellow' : 'scoring.football.card.red',
  }));
  return { clock: false, cards, said };
}

// ---------------------------------------------------------------------------------------------------------------
// Before the start, the strip, the last tap, the tools
// ---------------------------------------------------------------------------------------------------------------

/** Before the match starts: the two teams, top first, and Start match at once: football has no toss to pick here. */
function startOf(display: FootballDisplay): PadStart<FootballPadKey> | null {
  if (display.phase !== 'notStarted') return null;
  return {
    ask: { key: 'scoring.football.start.ask' },
    needsToss: false,
    sides: [
      { side: 'first', label: display.sides.first.name },
      { side: 'second', label: display.sides.second.name },
    ],
  };
}

function lastTapOf(display: FootballDisplay): PadLastTap<FootballPadKey> | null {
  const did = display.lastTap;
  if (did === null) return null;
  const words = footballWords(display);
  if (did.kind === 'undone') return { text: undoneSaid(words, did.tap), undo: false };
  return { text: doneSaid(words, did), undo: display.undoable };
}

const MORE: Tool = {
  id: 'more',
  label: { key: 'scoring.football.tool.more' },
  detail: null,
  kind: 'standard',
  enabled: true,
};

/**
 * The bottom row (design §6.4): End of period, named for what it ends, while the engine takes a marker (only ever in a
 * period in play: `legalPeriodMarkers` offers none before kick-off, in the shootout or once over, so the fold's `marker`
 * is null there) and anything stands after the start (never tied to the clock, so a match scored without it can still
 * end a period); then More. Before kick-off and in the shootout, More alone.
 */
function toolsOf(display: FootballDisplay): readonly Tool[] {
  const { marker } = display;
  if (marker === null || !display.kickedOff) return [MORE];
  const period: Tool = {
    id: 'period',
    label: { key: `scoring.football.end.${marker}` },
    detail: null,
    kind: 'standard',
    enabled: true,
  };
  return [period, MORE];
}
