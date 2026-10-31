/**
 * The scoring pad as the kit draws it (S2; owner rulings, 2026-10-31): sport-agnostic. A sport's pure function builds
 * one from its own display state (`badmintonPad.ts`), and the kit in `src/ui/components` draws any of them, so a second
 * sport is a second function and not a second screen kit.
 *
 * Words are dictionary keys with their fills. `K` is the sport's own key union: the kit translates with the app's
 * `MessageKey`, so a key the dictionaries lack fails to compile where the kit takes it, and the domain never imports
 * the dictionaries (AGENTS §3: domain is pure, and i18n may name domain, not the reverse).
 */

/** Layout A (owner, 2026-10-31): the first side is the top half, the second side the bottom one. */
export type PadSide = 'first' | 'second';

/** A fill: a value as it is (a name, a number), or words of its own (a sanction's level, translated in turn). */
export type PadVar<K extends string> = string | number | PadText<K>;

export type PadText<K extends string> = {
  readonly key: K;
  readonly vars?: Readonly<Record<string, PadVar<K>>>;
};

/** One side's half: tapping it gives that side the rally (or the sport's unit of scoring). */
export type PadHalf<K extends string> = {
  readonly side: PadSide;
  /** The side's names as the organiser typed them; partners joined. Never translated. */
  readonly label: string;
  /** The big value, read across a court: "11". A string, so a sport can show "AD" or "15". */
  readonly value: string;
  /** The line under it ("Games 1"), or none. */
  readonly sub: PadText<K> | null;
  /** The serving marker. */
  readonly serving: boolean;
  /** What a tap does, said to a screen reader ("Tap to award the rally"). */
  readonly hint: PadText<K>;
  readonly tappable: boolean;
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

/** Why the pad is not taking taps, said on a card (the web pad's own states, `device.*`). */
export type PadStateCard =
  | { readonly kind: 'notStarted' }
  | { readonly kind: 'resultRecorded' }
  | { readonly kind: 'viewOnly' }
  | { readonly kind: 'linkInvalid' }
  | { readonly kind: 'updateNeeded'; readonly unsent: number };

export type PadView<K extends string> = {
  /** Top, then bottom (layout A). */
  readonly halves: readonly [PadHalf<K>, PadHalf<K>];
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
 * Any sport's pad under a card: the halves stop taking taps and the tools go. Undo stays only under a recorded result,
 * whose card tells the scorer to use it on a mistake in this phone's own taps (the web's `device.resultRecorded`); a
 * view-only match keeps the last tap with no Undo, and a card in place of the pad or of the controls drops the last
 * tap with it. A card replaces one already there. No card: the pad as it is.
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
