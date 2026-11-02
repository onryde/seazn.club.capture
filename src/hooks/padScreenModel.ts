import type { BadmintonPadKey } from '@/domain/scoring/badmintonPad';
import type { PadLineWords } from '@/domain/scoring/padLine';
import type { PadSide, PadView } from '@/domain/scoring/padView';
import type { HalfFlash } from '@/domain/scoring/tapFlash';
import type { PadSheetView } from '@/hooks/usePadSheets';
import type { MessageKey } from '@/i18n/messages';

/**
 * What the badminton pad screen is drawn from (plan S2-1 Task 9, Interfaces): the real match's hook and the design
 * preview both return it, so Task 11 swaps one for the other and nothing in the screen's JSX changes.
 */
export type { PadLineWords, PadSheetView };

/** Every action the screen sends: the preview's, less its row's `pick`, plus what only a real match has. */
export type PadActions = {
  readonly home: () => void;
  readonly tapHalf: (side: PadSide) => void;
  readonly undo: () => void;
  readonly tool: (id: string) => void;
  readonly choose: (id: string) => void;
  readonly cancel: () => void;
  /** Match details' Close and dim: quiet in the bounce window of the sheet opening (review M2, `usePadSheets`). */
  readonly dismiss: () => void;
  readonly saveScore: (first: string, second: string) => void;
  readonly recordEnding: () => void;
  readonly voidSanction: () => void;
  /** The update banner's two buttons: the store's listing, and this match's scoring link in the browser. */
  readonly update: () => void;
  readonly browser: () => void;
  /** Match details (owner ruling 15, then 2026-11-01): where the match sits and its rules, in a sheet over the pad. */
  readonly details: () => void;
  /** History (owner ruling 21): every entry on the sheet, newest first, in a cover over the pad; view only. */
  readonly history: () => void;
  /** The Start screen (owner, 2026-11-01, option A): who serves first, picked; then Start match, a tap. */
  readonly pickServer: (side: PadSide) => void;
  readonly start: () => void;
};

/** The pad itself: the plan's `PadScreenModel`, with `kind` so the screen can tell it from the states that replace it. */
export type PadScreenModel = {
  readonly kind: 'pad';
  readonly view: PadView<BadmintonPadKey>;
  readonly sheet: PadSheetView | null;
  readonly line: PadLineWords;
  /** What the update banner's buttons said when the store or the browser would not open; null otherwise. */
  readonly cardNote: MessageKey | null;
  /** The last tap on a half that counted, for its flash (owner ruling 14). */
  readonly flash: HalfFlash;
  /** The Start screen's pick of who serves first; none until the scorer picks, and none once the match starts. */
  readonly toss: PadSide | null;
  readonly actions: PadActions;
};

/**
 * What `useScoringMatch` answers: the pad, or the state that takes its place and is said in words (Task 11 draws them):
 * - `loading`: the first read is on its way, or (`offline`) it could not be made and none is cached.
 * - `linkGone`: no link is saved for the match, or the link is dead and nothing of the match is cached.
 * - `unreadable`: a file this phone keeps for the match cannot be read (`queue`: Dismiss clears it; `link`: the secure
 *   store did not answer).
 * - `unsupportedSport`, `tooLarge`, `unfoldable`: the match cannot be scored here, said, never a blank.
 * - `outdated`: the server needs a newer app and the match cannot be folded to show behind the banner.
 */
export type ScoringMatch =
  | PadScreenModel
  | { readonly kind: 'loading'; readonly offline: boolean }
  | { readonly kind: 'linkGone' }
  | { readonly kind: 'unreadable'; readonly what: 'queue' | 'link' }
  | { readonly kind: 'unsupportedSport'; readonly sportKey: string }
  | { readonly kind: 'tooLarge' }
  | { readonly kind: 'unfoldable'; readonly reason: 'sides' | 'cfg' | 'ledger' }
  | { readonly kind: 'outdated'; readonly unsent: number };
