import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeSavedCode } from '@/domain/mode/savedCode';
import { liveCricketSeed } from '@/services/fakeCricketPad';
import { STORE_KEYS } from '@/services/modeStore';
import { FAKE_SCORING_SECRET } from '../../../test/fakeScoringLinkPort';
import { TEST_NOW } from '../../../test/fakePorts';
import { flush, launchApp } from '../../../test/routedApp';
import { linkKey } from '../../../test/scoringHomeFixtures';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

// The OUT sheet's dismissal kinds in the scorer's own language (T19 fix 5, Part 4; device run 11: fr and nl read "Bowled",
// "Caught"). The words are written out here, literal, from the dictionary files; the sheet is the real one, from a cold
// start on the pad. Whether the words are the ones each country's scorers use is a native cricket scorer's review.

const LINK = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };
const SEED = liveCricketSeed();

const SAVED = {
  [STORE_KEYS.active]: 'scoring',
  [STORE_KEYS.code('scoring')]: encodeSavedCode({
    mode: 'scoring',
    raw: '',
    slot: null,
    savedAt: TEST_NOW,
    expiresAt: null,
    stream: null,
    scoring: { fixtureId: SEED.fixtureId, label: 'Match 7' },
  }),
  [linkKey(SEED.fixtureId)]: JSON.stringify({ ...LINK, sportKey: 'cricket' }),
};

const SHEETS = [
  [
    'fr',
    'Éliminé',
    [
      'Quilles renversées',
      'Attrapé',
      'LBW',
      'Éliminé en course',
      'Éliminé par le gardien',
      'Wicket touché',
      'Gêne du terrain',
      'Double frappe',
    ],
  ],
  [
    'nl',
    'Uit',
    [
      'Weggebowld',
      'Gevangen',
      'LBW',
      'Run out',
      'Gestumpt',
      'Wicket geraakt',
      'Veld gehinderd',
      'Bal twee keer geraakt',
    ],
  ],
  [
    'es',
    'Eliminado',
    [
      'Derribado',
      'Cogido',
      'LBW',
      'Eliminado en carrera',
      'Eliminado por stumping',
      'Golpeó el wicket',
      'Obstruir el campo',
      'Golpear la bola dos veces',
    ],
  ],
] as const;

describe('the OUT sheet’s dismissal kinds', () => {
  it.each(SHEETS)(
    'in %s, the kinds are the language’s words, not English',
    async (language, out, kinds) => {
      await launchApp({ scoringSeed: SEED, kvSeed: SAVED, deviceLanguages: [language] });
      await flush(1_500);
      act(() => fireEvent.click(screen.getByRole('button', { name: out })));
      await flush(400);
      const sheet = within(screen.getByTestId('step-sheet'));
      const shown = sheet.getAllByRole('button').map((one) => one.textContent);
      for (const kind of kinds) expect(shown, kind).toContain(kind);
      for (const english of [
        'Bowled',
        'Caught',
        'Stumped',
        'Hit wicket',
        'Obstructing the field',
      ]) {
        expect(shown, english).not.toContain(english);
      }
    },
  );
});
