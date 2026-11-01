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

/** One side's half: tapping it gives that side the rally (or the sport's unit of scoring). */
export type PadHalf<K extends string> = {
  readonly side: PadSide;
  /** The side's names as the organiser typed them; partners joined. Never translated. */
  readonly label: string;
  /** The big value, read across a court: "11". A string, so a sport can show "AD" or "15". */
  readonly value: string;
  /** The side's score in every finished game (a set, in another sport), in the bottom row; null before one is over. */
  readonly periods: PadPeriods<K> | null;
  /** The words after them in the bottom row (badminton: the side's heaviest sanction), or none. */
  readonly sub: PadText<K> | null;
  /** The serving plate, on the serving side's half only; null on the other, and on both once the match is over. */
  readonly serving: PadServing<K> | null;
  /** What a tap does, said to a screen reader ("Tap to award the rally"). */
  readonly hint: PadText<K>;
  /**
   * What a tap does as the half shows it, naming the side ("Tap: rally to A. Sharma"; owner ruling 14, 2026-10-31). On
   * screen only while the half takes a tap; a screen reader hears `hint` instead, so it is never read twice.
   */
  readonly hintLine: PadText<K>;
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

/** Whether this phone's taps have reached the server. */
export type PadSync =
  | { readonly kind: 'synced' }
  | { readonly kind: 'sending'; readonly count: number }
  | { readonly kind: 'offline'; readonly count: number }
  | { readonly kind: 'refused'; readonly count: number };

/**
 * A tool's weight: `primary` is the lime plate, `standard` an outline, `destructive` the caution outline (never red:
 * red means ON AIR, AGENTS §5).
 */
export type PadToolKind = 'primary' | 'standard' | 'destructive';

export type PadTool<K extends string> = {
  readonly id: string;
  readonly label: PadText<K>;
  /** A second line as typed, never translated: the side a per-side tool acts on. */
  readonly detail: string | null;
  readonly kind: PadToolKind;
  readonly enabled: boolean;
};

/**
 * One entry on the match's sheet, as History lists it (owner ruling 21, 2026-10-31; view only): what it did, in the
 * last-tap line's words; the score after it, top first, where it moved the score; who recorded it; and whether Undo took
 * it back, which leaves it in its place.
 */
export type PadHistoryRow<K extends string> = {
  readonly said: PadText<K>;
  readonly score: string | null;
  readonly by: 'thisPhone' | 'otherScorer';
  readonly undone: boolean;
};

/** A period's entries under its heading ("Game 2"), newest first; History lists the newest period first. */
export type PadHistoryGroup<K extends string> = {
  readonly heading: PadText<K>;
  readonly rows: readonly PadHistoryRow<K>[];
};

/** Why the pad is not taking taps, said on a card (the web pad's own states, `device.*`). */
export type PadStateCard =
  | { readonly kind: 'notStarted' }
  | { readonly kind: 'resultRecorded' }
  | { readonly kind: 'viewOnly' }
  | { readonly kind: 'linkInvalid' }
  | { readonly kind: 'updateNeeded'; readonly unsent: number };

/**
 * The match's tally of periods won, in the header (owner, 2026-11-01: "0:0 with lime light in place of preview"): shown
 * top side first, as the halves are ("1:0"), and said with the sides' names ("Games: A. Sharma 1, L. Chen 0").
 */
export type PadTally<K extends string> = {
  readonly shown: string;
  readonly said: PadText<K>;
};

/**
 * What the match is and how it is played (owner, 2026-11-01): where it sits, and the sport's rule lines. The Match
 * details sheet and the Not started card draw both, from the same components.
 */
export type PadMatchDetails<K extends string> = {
  readonly context: MatchContext;
  readonly rules: readonly PadText<K>[];
};

/**
 * Before the match starts (owner, 2026-11-01: "it show the player, match info and ask to start", option A): the
 * question, and the two sides to pick from, as typed, top first. The kit draws the match details above it and Start
 * match under it, which records the pick.
 */
export type PadStart<K extends string> = {
  readonly ask: PadText<K>;
  readonly sides: readonly [PadStartSide, PadStartSide];
};

export type PadStartSide = { readonly side: PadSide; readonly label: string };

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
 * Any sport's pad under a card: the halves stop taking taps and the tools go. Undo stays only under a recorded result,
 * whose card tells the scorer to use it on a mistake in this phone's own taps (the web's `device.resultRecorded`); a
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
