/**
 * The scoring pad as the kit draws it (S2; owner rulings, 2026-10-31): sport-agnostic. A sport's pure function builds
 * one from its own display state (`badmintonPad.ts`), and the kit in `src/ui/components` draws any of them, so a second
 * sport is a second function and not a second screen kit.
 *
 * Words are dictionary keys with their fills. `K` is the sport's own key union: the kit translates with the app's
 * `MessageKey`, so a key the dictionaries lack fails to compile where the kit takes it, and the domain never imports
 * the dictionaries (AGENTS §3: domain is pure, and i18n may name domain, not the reverse).
 */

import type { MatchContext } from '@/domain/scoring/matchContext';

/** Layout A (owner, 2026-10-31): the first side is the top half, the second side the bottom one. */
export type PadSide = 'first' | 'second';

/** A fill: a value as it is (a name, a number), or words of its own (a sanction's level, translated in turn). */
export type PadVar<K extends string> = string | number | PadText<K>;

export type PadText<K extends string> =
  { readonly key: K; readonly vars?: PadFills<K>; readonly count?: undefined } | PadCounted<K>;

/**
 * Words whose form follows a count, by the web's plural convention (`key.one`, `key.other`): `key` names the `.other`
 * form (only such a key takes a count), the language's own rule picks the form for `count` (the translator's `tp`),
 * and `{count}` is filled with it.
 */
export type PadCounted<K extends string> = {
  readonly key: Extract<K, `${string}.other`>;
  readonly vars?: PadFills<K>;
  readonly count: number;
};

export type PadFills<K extends string> = Readonly<Record<string, PadVar<K>>>;

/** A half's edge bar: the kit draws `lit` in the LED lime and `dim` in lilac (the tokens are the kit's, the choice the sport's). */
export type PadBar = 'lit' | 'dim';

/**
 * A card the kit draws at a half's top-right corner (owner ruling 56, 2026-11-04): the family of its colour, never a
 * colour. `caution` is the umpire's yellow and `dismissal` the red (the web's `--sport-caution` and
 * `--sport-dismissal`); the kit maps each to its token.
 */
export type PadCard = 'caution' | 'dismissal';

/**
 * The marks at a half's top-right corner, after the serving plate (owner ruling 56): a stopwatch while the sport's
 * clock rule is in force (table tennis's Expedite), on both halves, then the side's cards. `said` is what a screen
 * reader hears for them in the half's name (the drawings are hidden from it), the card's name before the clock's
 * words: one entry for each mark that is drawn, none when nothing is.
 */
export type PadMarks<K extends string> = {
  readonly clock: boolean;
  readonly cards: readonly PadCard[];
  readonly said: readonly PadText<K>[];
};

/** One side's half: tapping it gives that side the rally (or the sport's unit of scoring). */
export type PadHalf<K extends string> = {
  readonly side: PadSide;
  /** The side's names as the organiser typed them; partners joined. Never translated. */
  readonly label: string;
  /** The big value, read across a court: "11". A string, so a sport can show "AD" or "15". */
  readonly value: string;
  /** The side's score in every finished game (a set, in another sport), in the bottom row; null before one is over. */
  readonly periods: PadPeriods<K> | null;
  /**
   * The words after the boxes in the bottom row, or none: table tennis's doubles server ("M. Wong serves"). A sanction
   * is a mark now (`marks`), no longer words here (owner ruling 56).
   */
  readonly sub: PadText<K> | null;
  /** The side's clock and cards, drawn in the top-right corner (owner ruling 56). */
  readonly marks: PadMarks<K>;
  /** The serving plate, on the serving side's half only; null on the other, and on both once the match is over. */
  readonly serving: PadServing<K> | null;
  /**
   * A word drawn on a plate in the half's head, after the names (chess's WHITE and BLACK): the sport's own label for the
   * side, never a serving claim, so it is not the lime serving plate but a neutral one, and it is kept after the match ends
   * (a scoresheet keeps the colours). A screen reader hears the word in the half's name. Null for a sport with none, and
   * for every set-based half.
   */
  readonly plate: PadText<K> | null;
  /**
   * The visible label of the tap, drawn in the bottom row in place of the kit's word "Tap" while the half takes a tap
   * (chess: "White won · A. Sharma", so the scorer sees what the tap records). A screen reader still hears `hint`. Null:
   * the kit draws "Tap" (every set-based half).
   */
  readonly action: PadText<K> | null;
  /**
   * The bar at the half's left edge, which the sport decides (owner, 2026-11-02: the lime follows the server): `lit`
   * is the LED lime and `dim` the lilac. Decorative: a screen reader hears the serving plate's words, never the bar.
   */
  readonly bar: PadBar;
  /**
   * What a tap does, said to a screen reader ("Tap to award the rally"). The half shows the one word "Tap" in the
   * bottom row while it takes a tap, in every sport and for every side (owner ruling 56: no side name; it supersedes
   * ruling 14's "Tap: rally to …"), so the kit says that word itself and nothing here carries it.
   */
  readonly hint: PadText<K>;
  readonly tappable: boolean;
};

/**
 * A side's finished games (owner ruling 16, 2026-10-31: a TV scoreboard's boxes): its score in each, in game order,
 * and the same said to a screen reader, in one or more parts the half's name reads in order ("Games: 21", "Game 2: 9,
 * disqualified").
 */
export type PadPeriods<K extends string> = {
  readonly scores: readonly PadPeriodScore<K>[];
  readonly said: readonly PadText<K>[];
};

/**
 * One finished game's box: the side's score in it, whether the side won it (the box the kit marks lime), and a short
 * mark drawn small beside the score when the game ended otherwise (badminton's DQ: owner ruling 18, 2026-10-31).
 */
export type PadPeriodScore<K extends string> = {
  readonly value: string;
  readonly won: boolean;
  readonly mark?: PadText<K>;
};

/**
 * The serving plate's words ("Serving · right": owner ruling 17, 2026-10-31, the service court on the plate), and the
 * same said to a screen reader in the half's name ("Serving, right service court").
 */
export type PadServing<K extends string> = {
  readonly shown: PadText<K>;
  readonly said: PadText<K>;
};

/**
 * A fact in the strip above the halves. A sport always sends the same slots in the same order, so each slot's width
 * is reserved and the strip never shifts; a fact the pad does not know leaves its slot empty (`text` null), never a
 * dash.
 */
export type PadStripItem<K extends string> = {
  readonly slot: string;
  readonly text: PadText<K> | null;
};

/** What the last tap did, in a sentence, and whether Undo (the one Undo, owner 2026-10-31) is offered. */
export type PadLastTap<K extends string> = {
  readonly text: PadText<K>;
  readonly undo: boolean;
};

/**
 * Whether this phone's taps have reached the server (owner, 2026-11-02: a badge, not words). `synced` shows nothing;
 * `sending` is the lime badge; `offline` (no network), `refused` (a link the door shut) and `stalled` (the server keeps
 * answering and never takes the tap: `stallOf`) are the same badge in caution orange.
 */
export type PadSync =
  | { readonly kind: 'synced' }
  | { readonly kind: 'sending'; readonly count: number }
  | { readonly kind: 'offline'; readonly count: number }
  | { readonly kind: 'refused'; readonly count: number }
  | { readonly kind: 'stalled'; readonly count: number }
  /** The server needs a newer app (a 426, or its bootstrap said so): the taps are kept until the phone is updated. */
  | { readonly kind: 'outdated'; readonly count: number }
  /** The reconnect question stands (owner ruling 43): other scorers' events landed, and nothing is sent until the scorer answers. */
  | { readonly kind: 'asked'; readonly count: number };

/** One side's name and score in the reconnect question, as the pad's half names them. */
export type PadAskSide = { readonly label: string; readonly value: string };

/**
 * The reconnect question the pad's sheet asks (owner ruling 43, 2026-11-02): how many events were scored elsewhere and
 * still stand, how many taps of this phone wait, and the score as the server has it without them, top side first.
 */
export type PadAsk = {
  readonly foreign: number;
  readonly queued: number;
  readonly score: readonly [PadAskSide, PadAskSide];
};

/**
 * A tool's weight: `primary` is the lime plate, `standard` an outline, `destructive` the caution outline (never red:
 * red means ON AIR, AGENTS §5).
 */
export type PadToolKind = 'primary' | 'standard' | 'destructive';

export type PadTool<K extends string> = {
  readonly id: string;
  readonly label: PadText<K>;
  /**
   * What a screen reader hears in place of `label`, when the drawn label is shortened to fit the row (a sport whose tool
   * row is narrower than its words at the smallest phone): the full word. None when the label is read as drawn.
   */
  readonly said?: PadText<K>;
  /** A second line as typed, never translated: the side a per-side tool acts on. */
  readonly detail: string | null;
  readonly kind: PadToolKind;
  readonly enabled: boolean;
};

/**
 * One entry on the match's sheet, as History lists it (owner ruling 21, 2026-10-31; view only): what it did, in the
 * last-tap line's words; the score after it, top first, where it moved the score; who recorded it; whether Undo took
 * it back, which leaves it in its place; and whether it is this phone's tap the server has not accepted yet, shown on
 * top as sending (design §6.4).
 */
export type PadHistoryRow<K extends string> = {
  readonly said: PadText<K>;
  readonly score: string | null;
  readonly by: 'thisPhone' | 'otherScorer';
  readonly undone: boolean;
  readonly sending: boolean;
};

/** A period's entries under its heading ("Game 2"), newest first; History lists the newest period first. */
export type PadHistoryGroup<K extends string> = {
  readonly heading: PadText<K>;
  readonly rows: readonly PadHistoryRow<K>[];
};

/** Why the pad is not taking taps, said on a card (the web pad's own states, `device.*`). */
export type PadStateCard =
  | { readonly kind: 'notStarted' }
  /**
   * `undoLeft`: the whole seconds this phone's Undo stays open (owner, 2026-11-03), or null once it is closed or never
   * was. A sport's pad says null; `withUndoWindow` (`undoWindow.ts`) fills it from the phone's clock.
   */
  | { readonly kind: 'resultRecorded'; readonly undoLeft: number | null }
  /**
   * The organiser's lock: the match is finalized and the card says so. Also the card of a View-only screen whose reason
   * this build does not know, which keeps what the card said before it had reasons.
   */
  | { readonly kind: 'viewOnly' }
  /**
   * A decided match whose result the web has carried forward (it moved the competition on, so it refuses this link a
   * write; Task 8d). Not `viewOnly`: nobody finalized it, and the card must not say they did.
   */
  | { readonly kind: 'carriedForward' }
  /** A cancelled match: nothing was decided, and nobody finalized anything (the web's `device.scan.viewOnly.cancelled`). */
  | { readonly kind: 'cancelled' }
  /** A seat with no entrant in a match that is not to be played, a bye (the web's `device.scan.viewOnly.noOpponent`). */
  | { readonly kind: 'noOpponent' }
  | { readonly kind: 'linkInvalid' }
  | { readonly kind: 'updateNeeded'; readonly unsent: number };

/**
 * The match's tally of periods won, in the header (owner, 2026-11-01: "0:0 with lime light in place of preview"): shown
 * top side first, as the halves are ("1:0"), and said with the sides' names ("Games: A. Sharma 1, L. Chen 0"). Chess is
 * the one exception to the order (plan S2-3, the Batch A review's ruling): its result is written as a scoresheet writes
 * it, White's score first ("1–0", "0–1"), whichever seat holds White, so `shown` may read the second side first there;
 * its `said` names each player with the point.
 */
export type PadTally<K extends string> = {
  readonly shown: string;
  readonly said: PadText<K>;
};

/** One row of a sport's rules table (owner, 2026-11-01, option A): "Format" and "Best of 3 games". */
export type PadRuleRow<K extends string> = {
  readonly label: PadText<K>;
  readonly value: PadText<K>;
};

/**
 * What the match is and how it is played (owner, 2026-11-01): where it sits, and the sport's rules as label and value
 * rows. The Start screen, the Not started card and the Match details sheet draw both, as one `MatchCard`.
 */
export type PadMatchDetails<K extends string> = {
  readonly context: MatchContext;
  readonly rules: readonly PadRuleRow<K>[];
};

/**
 * Before the match starts (owner, 2026-11-01: "it show the player, match info and ask to start", option A): the
 * question, and the two sides to pick from, as typed, top first. The kit draws the match details above it and Start
 * match under it, which records the pick. A sport with no serve to pick sets `needsToss` false (plan S2-3 Task 2): the kit
 * then draws no question and no picker, Start match is ready at once and starts with no side. `sides` stays the two
 * names either way.
 */
export type PadStart<K extends string> = {
  readonly ask: PadText<K>;
  /** Whether Start match waits for a side to be picked (who serves first); false when the sport has no such pick. */
  readonly needsToss: boolean;
  readonly sides: readonly [PadStartSide<K>, PadStartSide<K>];
};

/**
 * One side on the Start screen, the name as typed. `plate` is the word the side's half will carry (`PadHalf.plate`): with no
 * serve to pick (`needsToss` false) the kit draws each name with its plate as a read-only row, so the scorer sees who holds
 * what before Start match. None for a sport without plates.
 */
export type PadStartSide<K extends string = string> = {
  readonly side: PadSide;
  readonly label: string;
  readonly plate?: PadText<K> | null;
};

export type PadView<K extends string> = {
  /** Top, then bottom (layout A). */
  readonly halves: readonly [PadHalf<K>, PadHalf<K>];
  readonly tally: PadTally<K>;
  readonly details: PadMatchDetails<K>;
  /** The Start screen's question, in the halves' place, while the match has not started; null once it has. */
  readonly start: PadStart<K> | null;
  readonly strip: readonly PadStripItem<K>[];
  readonly lastTap: PadLastTap<K> | null;
  readonly sync: PadSync;
  readonly tools: readonly PadTool<K>[];
  readonly card: PadStateCard | null;
};

/**
 * Where a card sits: `instead` of the pad, when there is nothing to score (not started, a dead link); `withScore`, above
 * the halves still showing the score (a recorded result, a view-only match); or `forControls`, in the place of the
 * last-tap line and the tools: an app too old to score, whose pad stays on screen view only (owner ruling 8) while the
 * banner's buttons are the way on. Above the halves its buttons would leave a half too short for the score
 * (padFit.test.ts).
 */
export type CardPlacement = 'instead' | 'withScore' | 'forControls';

export function cardPlacement(card: PadStateCard): CardPlacement {
  if (card.kind === 'notStarted' || card.kind === 'linkInvalid') return 'instead';
  return card.kind === 'updateNeeded' ? 'forControls' : 'withScore';
}

/**
 * Whether the link names a match, so the top bar offers its Rules (owner ruling 15, 2026-10-31) and its History (owner
 * ruling 21): on the pad and under every card but a dead link's, which names none.
 */
export function matchKnown(card: PadStateCard | null): boolean {
  return card?.kind !== 'linkInvalid';
}

/**
 * Whether the last-tap line has an Undo at all: not under a recorded result whose Undo window is closed (owner,
 * 2026-11-03), where the card tells the scorer to ask the organiser. Everywhere else it stays in its place, disabled
 * when it is not offered, so the sentence beside it never changes width.
 */
export function hasUndoCell(card: PadStateCard | null): boolean {
  return !(card?.kind === 'resultRecorded' && card.undoLeft === null);
}

/** The cards under which the pad lets the screen go (`holdsScreen`, below, says why). */
const SCREEN_RELEASED: ReadonlySet<PadStateCard['kind']> = new Set([
  'viewOnly',
  'carriedForward',
  'cancelled',
  'noOpponent',
  'linkInvalid',
  'updateNeeded',
]);

/**
 * Whether the pad keeps the phone's screen on under this card (owner ruling 9, the screen stays on while the pad shows;
 * applied by the controller on 2026-11-02): on the pad and under the two cards the scorer is still waiting on (the match
 * not open yet, a recorded result). Off under the six that need a person to act or end the scorer's part, which have
 * nothing left to wait for: the organiser's lock (view only), a result carried forward (the organiser's to correct), a
 * cancelled match and one with no opponent (nothing to score, ever), a dead link, and an app to update (as the
 * full-screen `outdated` state).
 *
 * A recorded result holds the screen after its Undo window has closed too (the controller's ruling, 2026-11-03): the
 * organiser may finalise the result while the scorer watches the card, so the 45 s of Undo are not what the screen is
 * held for.
 */
export function holdsScreen(card: PadStateCard | null): boolean {
  return card === null || !SCREEN_RELEASED.has(card.kind);
}

/**
 * Any sport's pad under a card: the halves stop taking taps and the tools go. Undo stays only under a recorded result,
 * whose card tells the scorer to use it on a mistake in this phone's own taps (the web's `device.resultRecorded`) for
 * as long as its window is open (`undoWindow.ts`); a
 * view-only match keeps the last tap with no Undo, and a card in place of the pad or of the controls drops the last
 * tap with it. A card replaces one already there, and takes the Start screen away: nothing is started under a card. No
 * card: the pad as it is.
 */
export function withCard<K extends string>(
  view: PadView<K>,
  card: PadStateCard | null,
): PadView<K> {
  if (card === null) return view;
  const [top, bottom] = view.halves;
  return {
    ...view,
    halves: [
      { ...top, tappable: false },
      { ...bottom, tappable: false },
    ],
    tools: [],
    start: null,
    lastTap: lastTapUnder(view.lastTap, card),
    card,
  };
}

function lastTapUnder<K extends string>(
  lastTap: PadLastTap<K> | null,
  card: PadStateCard,
): PadLastTap<K> | null {
  if (lastTap === null || cardPlacement(card) !== 'withScore') return null;
  return card.kind === 'resultRecorded' ? lastTap : { ...lastTap, undo: false };
}
