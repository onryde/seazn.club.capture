import { cricketPadRules } from '@seazn/engine/pad';
import type {
  CricketBallTap,
  CricketExtra,
  CricketPadKey,
  CricketStep,
  CricketStepOption,
} from '@/domain/scoring/cricketTypes';

/**
 * The run keys and the extras sheets (S2-4 spec §4.2; rulings 73, 79, 80; plan Task 11). A run key is one ball: 0 to 3
 * off the bat, and the 4 and 6 keys are boundaries (`boundary`, ruling 73; an all-run 4 or 6 is More's, ruling 79). An
 * extra's key opens a sheet that stays until a choice or Cancel, with no timer:
 * - a wide asks the runs run, 0 to 4, and records one wide extra of the engine's own run plus them (`wideDefaultRuns`:
 *   the engine counts the wide's run in `extras.runs`, so a wide and two run is runs 3);
 * - a no-ball asks the runs off the bat (0, 1, 2, 3, 4, 6; a 4 or 6 off the bat is a boundary) or the runs run, 1 to 4,
 *   sent as one no-ball extra of the engine's run plus them (a ball carries one extra); "run 0" is bat 0, not offered;
 * - a bye and a leg-bye ask 1 to 4.
 * Each ends in "+ Out", the wicket steps for this delivery (`cricketWicket.ts`).
 */

/** The extras a key opens a sheet for: every kind but the penalty, which is More's (ruling 79). */
export type SheetExtra = Exclude<CricketExtra['kind'], 'penalty'>;

/** + Out's id, on every extras sheet. */
export const OUT_CHOICE = 'out';

const TITLE: Readonly<Record<SheetExtra, CricketPadKey>> = {
  wide: 'scoring.cricket.key.wide',
  noball: 'scoring.cricket.key.noBall',
  bye: 'scoring.cricket.key.bye',
  legbye: 'scoring.cricket.key.legBye',
};

/** The runs each sheet's rows offer: off the bat (`bat`) and run (`ran`), as the spec lists them. */
const OFFERED: Readonly<
  Record<SheetExtra, { readonly bat: readonly number[]; readonly ran: readonly number[] }>
> = {
  wide: { bat: [], ran: [0, 1, 2, 3, 4] },
  noball: { bat: [0, 1, 2, 3, 4, 6], ran: [1, 2, 3, 4] },
  bye: { bat: [], ran: [1, 2, 3, 4] },
  legbye: { bat: [], ran: [1, 2, 3, 4] },
};

/** The bat keys a boundary is: the 4 and the 6 (ruling 73). */
function boundaryOf(bat: number): 4 | 6 | null {
  return bat === 4 || bat === 6 ? bat : null;
}

/** A run key's ball: `runs` off the bat, a boundary for the 4 and the 6. */
export function runBall(runs: number): CricketBallTap {
  return { bat: runs, extra: null, boundary: boundaryOf(runs), wicket: null };
}

/** The ball an extra of `kind` with no runs off the bat and none run is: the base the wicket steps start from. */
export function extraBase(kind: SheetExtra): CricketBallTap {
  return { bat: 0, extra: { kind, runs: ownRun(kind) }, boundary: null, wicket: null };
}

/** The runs the engine gives a wide or a no-ball by itself; a bye's are only those run. */
function ownRun(kind: SheetExtra): number {
  if (kind === 'wide') return cricketPadRules.wideDefaultRuns;
  return kind === 'noball' ? cricketPadRules.noBallDefaultRuns : 0;
}

/** The sheet an extra's key opens. */
export function extrasSheet(kind: SheetExtra): CricketStep {
  const { bat, ran } = OFFERED[kind];
  const group: CricketPadKey =
    kind === 'bye' || kind === 'legbye'
      ? 'scoring.cricket.extras.runs'
      : 'scoring.cricket.extras.ran';
  const options: CricketStepOption[] = [
    ...bat.map((runs) => key(`bat.${runs}`, runs, 'scoring.cricket.extras.bat')),
    ...ran.map((runs) => key(`ran.${runs}`, runs, group)),
    { id: OUT_CHOICE, label: { key: 'scoring.cricket.extras.out' }, tone: 'standard' },
  ];
  return { name: `extras.${kind}`, title: { key: TITLE[kind] }, body: null, options };
}

function key(id: string, runs: number, group: CricketPadKey): CricketStepOption {
  return { id, label: String(runs), tone: 'standard', group };
}

/** The ball a choice on an extra's sheet records, or none for + Out and for an id the sheet does not offer. */
export function extrasChoice(kind: SheetExtra, id: string): CricketBallTap | null {
  const [how, count] = id.split('.');
  const runs = Number(count);
  const { bat, ran } = OFFERED[kind];
  if (how === 'bat' && bat.includes(runs)) {
    return {
      bat: runs,
      extra: { kind, runs: ownRun(kind) },
      boundary: boundaryOf(runs),
      wicket: null,
    };
  }
  if (how === 'ran' && ran.includes(runs)) {
    return { bat: 0, extra: { kind, runs: ownRun(kind) + runs }, boundary: null, wicket: null };
  }
  return null;
}
