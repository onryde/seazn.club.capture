import { memo, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { SetupTeam } from '@/domain/scoring/cricketSetup';
import { useT } from '@/hooks/useLanguage';
import { TossPicker, type TossOption } from '@/ui/components/TossPicker';
import { layout, space } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';

type Side = SetupTeam['id'];
type Elected = 'bat' | 'bowl';

/**
 * Cricket's toss on the whole screen (owner ruling 83, 2026-11-07: "in toss, choose team and bat or bow, can we use more
 * space on that screen?"): two halves of equal height in the board's place, under the top bar. The top asks "Who won the
 * toss?" over the two team names (the web asks Home/Away; spec §4.1 gap 1); the bottom asks "{team} chose to…" over Bat
 * and Bowl, greyed with "Team" in place of the name until a team is picked, so nothing moves when it is. Both are the kit's
 * `TossPicker`, filling its half. A team tap is held by the hook (a second one changes it); Bat or Bowl records the toss.
 * The questions are `title` and Bat and Bowl `tally`, the preview's sizes (Batch 3 fix round 1, M7); a team's name stays
 * at `label`, since at `tally` a club's word is wider than a button at 320 or 360 dp and Android would break it.
 */
export const CricketToss = memo(function CricketToss({
  teams,
  winner,
  onWinner,
  onElect,
}: {
  readonly teams: readonly [SetupTeam, SetupTeam];
  readonly winner: Side | null;
  readonly onWinner: (side: Side) => void;
  readonly onElect: (elected: Elected) => void;
}) {
  const { t } = useT();
  const team = teams.find((one) => one.id === winner)?.label ?? t('scoring.cricket.toss.team');
  const elect = useMemo<readonly [TossOption<Elected>, TossOption<Elected>]>(
    () => [
      { id: 'bat', label: t('scoring.cricket.toss.bat') },
      { id: 'bowl', label: t('scoring.cricket.toss.bowl') },
    ],
    [t],
  );
  return (
    <View testID="cricket-toss" style={styles.toss}>
      <View testID="toss-half-won" style={styles.half}>
        <TossPicker
          fill
          ask={t('scoring.cricket.toss.ask')}
          options={teams}
          picked={winner}
          onPick={onWinner}
        />
      </View>
      <View testID="toss-half-chose" style={styles.half}>
        <TossPicker
          fill
          ask={t('scoring.cricket.toss.chose', { team })}
          options={elect}
          picked={null}
          onPick={onElect}
          disabled={winner === null}
          big
        />
      </View>
    </View>
  );
});

/** Bat or Bowl's button: one `tally` line, its padding and its border (TossPicker's `box`). */
const BIG_BUTTON = typeScale.tally.lineHeight + 2 * space.sm + 2 * layout.iconBorder;

/**
 * A half never shrinks below what it draws: the question's kept lines in `title`, the gap, and its taller button. The two
 * have the same flex and the same floor, so they share the room equally whatever either says.
 */
const HALF_MIN =
  layout.padTossAskLines * typeScale.title.lineHeight +
  space.sm +
  Math.max(layout.padTossHeight, BIG_BUTTON);

const styles = StyleSheet.create({
  toss: { flex: 1, gap: space.lg },
  half: { flex: 1, minHeight: HALF_MIN },
});
