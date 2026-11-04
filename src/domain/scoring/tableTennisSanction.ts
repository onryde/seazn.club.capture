import { tabletennisPadRules } from '@seazn/engine/pad';
import type { PadSide } from '@/domain/scoring/padView';
import {
  levelSheet,
  personSheet,
  playerChosen,
  type SanctionSheet,
} from '@/domain/scoring/setBasedSanction';
import { cardWord } from '@/domain/scoring/tableTennisHistory';
import { isCardLevel } from '@/domain/scoring/tableTennisLedgerHistory';
import type {
  TableTennisPadKey,
  TableTennisSanctionLevel,
  TableTennisSide,
} from '@/domain/scoring/tableTennisPad';

/**
 * The umpire's cards, step by step (design §4.7; the owner's ruling 52, 2026-11-03): the level (yellow is `warning`, red
 * is `penalty`), then the player, only if the side has more than one. A side with one player is stamped at once; a side
 * with no named player is recorded by the side, with no person (S2-1: a team named only). There is no confirm step and
 * no ending: table tennis declares no sanction ending, and a red card's point is the umpire's to tap as a point. Badminton's
 * twin is `badmintonSanction`; what the two ask alike is the set-based sports' to share (`setBasedSanction`).
 */

/** The cards the engine lists, in its order (`tabletennisPadRules.sanctionLevels`): never a list of our own. */
const LEVELS: readonly TableTennisSanctionLevel[] =
  tabletennisPadRules.sanctionLevels.filter(isCardLevel);

export type CardStep =
  | { readonly step: 'level'; readonly side: PadSide }
  | {
      readonly step: 'person';
      readonly side: PadSide;
      readonly level: TableTennisSanctionLevel;
    };

/** A card to record: the side, the level and the player, or null when the side names no player. */
export type TableTennisCard = {
  readonly side: PadSide;
  readonly level: TableTennisSanctionLevel;
  readonly person: string | null;
};

/** The next step, or the card to record. */
export type CardMove =
  | { readonly kind: 'step'; readonly step: CardStep }
  | { readonly kind: 'record'; readonly card: TableTennisCard };

/** The sheet's words: the pad's own (the Card tool, the card levels) and the generic "Who?". */
export type CardKey = TableTennisPadKey | 'scoring.sanction.who';

export type CardSheet = SanctionSheet<CardKey>;

type Sides = Readonly<Record<PadSide, TableTennisSide>>;

export function startCard(side: PadSide): CardStep {
  return { step: 'level', side };
}

/** A choice the step does not offer leaves the step as it is. */
export function chooseCard(step: CardStep, choice: string, sides: Sides): CardMove {
  const stay: CardMove = { kind: 'step', step };
  switch (step.step) {
    case 'level': {
      const level = LEVELS.find((each) => each === choice);
      return level === undefined ? stay : afterLevel(step.side, level, sides[step.side]);
    }
    case 'person': {
      const person = playerChosen(sides[step.side], choice);
      if (person === undefined) return stay;
      return { kind: 'record', card: { side: step.side, level: step.level, person } };
    }
  }
}

/** The player is asked only of a pair; one player is the card's, and no player makes it the side's. */
function afterLevel(
  side: PadSide,
  level: TableTennisSanctionLevel,
  { players }: TableTennisSide,
): CardMove {
  const [only, ...more] = players;
  if (only === undefined) return { kind: 'record', card: { side, level, person: null } };
  if (more.length === 0) return { kind: 'record', card: { side, level, person: only } };
  return { kind: 'step', step: { step: 'person', side, level } };
}

export function cardSheet(step: CardStep, sides: Sides): CardSheet {
  switch (step.step) {
    case 'level':
      return levelSheet<CardKey>(
        { key: 'scoring.tabletennis.sheet.card' },
        sides[step.side],
        LEVELS.map((level) => ({ id: level, label: cardWord(level), tone: 'standard' })),
      );
    case 'person':
      return personSheet<CardKey>(
        { key: 'scoring.sanction.who' },
        sides[step.side],
        cardWord(step.level),
      );
  }
}
