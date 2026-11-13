import { describe, expect, it } from 'vitest';
import { withCard } from '@/domain/scoring/padView';
import { foldTableTennis } from '@/domain/scoring/tableTennisFold';
import { tableTennisPad } from '@/domain/scoring/tableTennisPad';
import { SINGLES, anchored, ledgerOf } from '../../../test/tableTennisLedger';

// `withCard` drops a half's call (a half under a card takes no tap): pinned for table tennis, a sport that sets `call` itself.
// Home leads 10-8, so the top half has game point on an open pad.
const open = () => {
  const folded = foldTableTennis({
    bootstrap: SINGLES,
    ledger: ledgerOf(anchored('H', ('HA'.repeat(8) + 'HH').slice(1))),
    queued: [],
    ownEventIds: [],
    toss: null,
  });
  if (folded.kind !== 'folded') throw new Error(`did not fold: ${folded.reason}`);
  return tableTennisPad(folded.display);
};

describe('withCard: a call on a half', () => {
  it('has a plate on the open pad (the contrast), and none under a card, both halves not tappable', () => {
    const view = open();
    expect(view.halves[0]?.call?.text).toEqual({ key: 'scoring.pad.call.gamePoint' });
    const under = withCard(view, {
      kind: 'resultRecorded',
      undoLeft: null,
      title: { key: 'scoring.tabletennis.hint' },
    });
    expect(under.halves.map((half) => [half.tappable, half.call ?? null])).toEqual([
      [false, null],
      [false, null],
    ]);
  });
});
