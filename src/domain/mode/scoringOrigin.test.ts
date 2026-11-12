import { describe, expect, it } from 'vitest';
import type { Mode } from '@/domain/mode/Mode';
import { scoringOrigin } from '@/domain/mode/scoringOrigin';

// Where Remote Scoring's Back goes (S4 design §6): from Match Day, to the list, named for the court; from anything
// else, Home as S2 has it.
const OPEN = { fixtureId: '7b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e', courtName: 'Court 1' };

describe('scoringOrigin', () => {
  it('from Match Day, Back is the list, labelled with the court', () => {
    expect(scoringOrigin('matchday', OPEN)).toEqual({ back: 'matchday', label: '‹ Court 1' });
  });

  it('with the mode active but no match open, Back is Home', () => {
    expect(scoringOrigin('matchday', null)).toEqual({ back: 'home' });
  });

  it.each<[Mode | null]>([['scoring'], ['stream'], [null]])(
    'a match open while %s is the active mode is not Match Day’s: Back is Home',
    (active) => {
      expect(scoringOrigin(active, OPEN)).toEqual({ back: 'home' });
    },
  );

  it('a court name is shown as it is, however long or odd', () => {
    expect(scoringOrigin('matchday', { ...OPEN, courtName: 'Centre Court {1}' })).toEqual({
      back: 'matchday',
      label: '‹ Centre Court {1}',
    });
  });

  it('a court with no name still names the way back', () => {
    expect(scoringOrigin('matchday', { ...OPEN, courtName: '' })).toEqual({
      back: 'matchday',
      label: '‹',
    });
  });
});
