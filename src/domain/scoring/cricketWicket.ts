import { cricketPadRules } from '@seazn/engine/pad';
import type {
  CricketBallTap,
  CricketBallWicketKind,
  CricketDisplay,
  CricketExtra,
  CricketStep,
} from '@/domain/scoring/cricketTypes';

/**
 * The wicket steps (S2-4 spec §4.3; plan Tasks 11 and 12): Out, or an extra's + Out, opens them for the delivery being
 * recorded (`base`, the ball with its extra and runs), and each step is asked only when it has a choice. The kinds are
 * the engine's for this delivery (`cricketPadRules`), never a hand copy, and never retired or timed out on a ball.
 */

/** A wicket being recorded: the delivery it comes on, and the answers so far. */
export type WicketFlow = {
  readonly base: CricketBallTap;
  readonly kind: CricketBallWicketKind | null;
};

/** The kinds never recorded on a ball: each would add a legal ball nobody bowled (spec §4.3). */
const NOT_ON_A_BALL: readonly string[] = ['retired', 'timedout'];

function isBallKind(kind: string): kind is CricketBallWicketKind {
  return !NOT_ON_A_BALL.includes(kind);
}

/**
 * How a batter can be out on this delivery, in the engine's order: off a wide or a no-ball only the engine's sets for
 * them, and while a free hit is due only its free-hit set as well (the web's rule: the pad never offers what the engine
 * would refuse).
 */
export function wicketKinds(
  display: CricketDisplay,
  extra: CricketExtra | null,
): readonly CricketBallWicketKind[] {
  const {
    wicketKinds: all,
    wideDismissalKinds,
    noBallDismissalKinds,
    freeHitDismissalKinds,
  } = cricketPadRules;
  const allowed =
    extra?.kind === 'wide'
      ? wideDismissalKinds
      : extra?.kind === 'noball'
        ? noBallDismissalKinds
        : all;
  return all
    .filter((kind) => allowed.includes(kind))
    .filter((kind) => !display.freeHit || freeHitDismissalKinds.includes(kind))
    .filter(isBallKind);
}

export function startWicket(base: CricketBallTap): WicketFlow {
  return { base, kind: null };
}

/** The step on screen: how out. */
export function wicketStep(flow: WicketFlow, display: CricketDisplay): CricketStep {
  return {
    name: 'wicket.kind',
    title: { key: 'scoring.cricket.wicket.how' },
    body: null,
    options: wicketKinds(display, flow.base.extra).map((kind) => ({
      id: kind,
      label: { key: `scoring.cricket.out.kind.${kind}` },
      tone: 'standard',
    })),
  };
}

/** A choice on the step: the ball to record, the striker out; or none for a kind the step does not offer. */
export function chooseWicket(
  flow: WicketFlow,
  display: CricketDisplay,
  id: string,
): { readonly done: CricketBallTap } | null {
  const kind = wicketKinds(display, flow.base.extra).find((one) => one === id);
  const striker = display.crease?.striker.id;
  if (kind === undefined || striker === undefined) return null;
  return {
    done: {
      ...flow.base,
      wicket: { kind, out: striker, fielder: null, fielderAssist: null, incoming: null },
    },
  };
}
