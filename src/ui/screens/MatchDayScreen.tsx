import { memo, useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import {
  bannerFor,
  courtCardsAt,
  isEmptyDay,
  noonOf,
  sendingByCourt,
  venuesOf,
  type MatchDay,
  type Row,
} from '@/domain/matchday/matchDay';
import { useFormatDay, useFormatTime } from '@/hooks/useFormatTime';
import { useT } from '@/hooks/useLanguage';
import { useMatchDay, type MatchDayList } from '@/hooks/useMatchDay';
import { useRowWords } from '@/hooks/useRowWords';
import { useBackToHome } from '@/hooks/useStreamLinks';
import { ApprovalBanner } from '@/ui/components/ApprovalBanner';
import { CourtCard } from '@/ui/components/CourtCard';
import { GhostButton } from '@/ui/components/GhostButton';
import { MatchRow } from '@/ui/components/MatchRow';
import { SubScreenHeader } from '@/ui/components/SubScreenHeader';
import { Text } from '@/ui/components/Text';
import { colour, layout, radius, space } from '@/ui/theme/tokens';

/**
 * Match Day's list (MD-2 Task 4; S4 design §5, layout B), portrait: the way back to Home, then the competition, the
 * code's scope and its day, the approval waiting, one card per court (filtered by venue on a competition code over two
 * venues), the matches on no court yet and the online boards. Offline, the last copy shows under the time it was read;
 * with none, "Offline" and Try again. A pull reads the day again. Nothing here opens a match yet (Task 5), and ⋯ comes
 * with Exit (Task 7).
 */
export function MatchDayScreen() {
  const { t } = useT();
  const toHome = useBackToHome();
  const list = useMatchDay();
  return (
    <View testID="matchday-screen" style={styles.screen}>
      <View style={styles.bar}>
        <SubScreenHeader
          title={t('mode.matchday')}
          onBack={toHome}
          plate={false}
          backLabel={t('stream.home')}
        />
      </View>
      <MatchDayBody list={list} />
    </View>
  );
}

const MatchDayBody = memo(function MatchDayBody({ list }: { readonly list: MatchDayList }) {
  if (list.day !== null) return <DayList list={list} day={list.day} />;
  if (list.state === 'offline') return <OfflineEmpty retry={list.refresh} />;
  return <Opening />;
});

/** No copy and no answer yet: Task 3's words, so the route is never empty. */
const Opening = memo(function Opening() {
  const { t } = useT();
  return (
    <View style={styles.middle}>
      <Text variant="title">{t('matchday.loading.title')}</Text>
      <Text variant="body">{t('matchday.loading.body')}</Text>
    </View>
  );
});

/** A saved code with no copy and no connection (the dispatch's ruling 1): no list, and a way to ask again. */
const OfflineEmpty = memo(function OfflineEmpty({ retry }: { readonly retry: () => void }) {
  const { t } = useT();
  return (
    <View style={styles.middle}>
      <Text variant="title">{t('matchday.offlineEmpty')}</Text>
      <GhostButton label={t('panel.tryAgain')} onPress={retry} />
    </View>
  );
});

const REFRESH_COLOURS = [colour.lime];

const DayList = memo(function DayList({
  list,
  day,
}: {
  readonly list: MatchDayList;
  readonly day: MatchDay;
}) {
  const { t } = useT();
  const banner = useMemo(() => bannerFor(day), [day]);
  const offlineAt = list.state === 'offline' ? list.updatedAt : null;
  // react-native-web draws no pull and drops `onRefresh`: the pull is the device check's. Try again and the poll
  // call the same `refresh`.
  const pull = (
    <RefreshControl
      refreshing={false}
      onRefresh={list.refresh}
      tintColor={colour.lime}
      colors={REFRESH_COLOURS}
      progressBackgroundColor={colour.surface}
    />
  );
  return (
    <ScrollView style={styles.list} contentContainerStyle={styles.column} refreshControl={pull}>
      <DayHeader day={day} offlineAt={offlineAt} />
      {banner === null ? null : <ApprovalBanner banner={banner} />}
      <Courts day={day} unsent={list.unsent} />
      <RowSection
        title={`${t('matchday.noCourt')} · ${day.noCourt.length}`}
        rows={day.noCourt}
        zone={day.tz}
      />
      <RowSection title={t('matchday.online')} rows={day.online} zone={day.tz} />
      {isEmptyDay(day) ? <Text variant="body">{t('matchday.empty')}</Text> : null}
    </ScrollView>
  );
});

/** "SAFE Open · Hall A · Sat 3 Oct": the code's own day, said in UTC from its noon so no zone moves it. */
const DayHeader = memo(function DayHeader({
  day,
  offlineAt,
}: {
  readonly day: MatchDay;
  readonly offlineAt: Date | null;
}) {
  const { t } = useT();
  const dayWord = useFormatDay()(noonOf(day.day), 'UTC');
  const time = useFormatTime();
  const scope =
    day.scope.kind === 'competition' ? t('matchday.scope.competition') : day.scope.label;
  return (
    <View style={styles.header}>
      <Text variant="controlInk" numberOfLines={2}>
        {t('matchday.header', { competition: day.competition.name, scope, day: dayWord })}
      </Text>
      {offlineAt === null ? null : (
        <Text variant="control" numberOfLines={1} style={styles.offline}>
          {t('matchday.offline', { time: time(offlineAt, day.tz) })}
        </Text>
      )}
    </View>
  );
});

const Courts = memo(function Courts({
  day,
  unsent,
}: {
  readonly day: MatchDay;
  readonly unsent: ReadonlyMap<string, number>;
}) {
  const [venue, setVenue] = useState<string | null>(null);
  const venues = useMemo(() => venuesOf(day), [day]);
  const cards = useMemo(() => courtCardsAt(day, venue), [day, venue]);
  const sending = useMemo(() => sendingByCourt(day, unsent), [day, unsent]);
  // A venue picked that has left the day shows every court again (`courtCardsAt`), and no chip is lit for it.
  const picked = venue !== null && venues.includes(venue) ? venue : null;
  return (
    <>
      {venues.length === 0 ? null : <VenueChips venues={venues} picked={picked} pick={setVenue} />}
      {cards.map((card) => (
        <CourtCard
          key={card.courtId}
          card={card}
          sending={sending.get(card.courtId) ?? 0}
          zone={day.tz}
        />
      ))}
    </>
  );
});

type Pick = (venue: string | null) => void;

/** On a competition code over two venues or more (S4 design §5): All venues, then each venue, one lit. */
const VenueChips = memo(function VenueChips({
  venues,
  picked,
  pick,
}: {
  readonly venues: readonly string[];
  readonly picked: string | null;
  readonly pick: Pick;
}) {
  const { t } = useT();
  return (
    <View style={styles.chips}>
      <VenueChip label={t('matchday.venues.all')} venue={null} lit={picked === null} pick={pick} />
      {venues.map((venue) => (
        <VenueChip key={venue} label={venue} venue={venue} lit={picked === venue} pick={pick} />
      ))}
    </View>
  );
});

/**
 * One venue chip, a `touch` tall target. Lit, a lime outline and lime words; unlit, a lilac hairline. `aria-selected`,
 * as IconButton has it: Pressable reads it as the selected state on the phone, and react-native-web renders only it.
 */
const VenueChip = memo(function VenueChip({
  label,
  venue,
  lit,
  pick,
}: {
  readonly label: string;
  readonly venue: string | null;
  readonly lit: boolean;
  readonly pick: Pick;
}) {
  const press = useCallback(() => pick(venue), [pick, venue]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      aria-selected={lit}
      onPress={press}
      style={lit ? styles.chipLit : styles.chip}
    >
      <Text variant="control" numberOfLines={1} style={lit ? styles.chipWordLit : styles.chipWord}>
        {label}
      </Text>
    </Pressable>
  );
});

/** The matches on no court yet, or the online boards: a heading and read-only rows (online rows never open). */
const RowSection = memo(function RowSection({
  title,
  rows,
  zone,
}: {
  readonly title: string;
  readonly rows: readonly Row[];
  readonly zone: string;
}) {
  const words = useRowWords(zone);
  if (rows.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text variant="diagSection">{title}</Text>
      <View style={styles.sectionRows}>
        {rows.map((row) => (
          <MatchRow key={row.fixtureId} {...words(row)} />
        ))}
      </View>
    </View>
  );
});

const chipBase = {
  minHeight: layout.touch,
  justifyContent: 'center',
  paddingHorizontal: space.md,
  borderRadius: radius.card,
  borderWidth: layout.cardBorder,
} as const;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colour.ground },
  bar: { paddingHorizontal: space.md, paddingTop: space.md, paddingBottom: space.sm },
  list: { flex: 1 },
  column: { gap: space.md, paddingHorizontal: space.md, paddingBottom: space.md },
  middle: { flex: 1, justifyContent: 'center', gap: space.md, padding: space.md },
  header: { gap: space.xs },
  offline: { color: colour.caution },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { ...chipBase, borderColor: colour.ink3 },
  chipLit: { ...chipBase, borderColor: colour.lime },
  chipWord: { color: colour.ink2 },
  chipWordLit: { color: colour.lime },
  section: { gap: space.sm },
  sectionRows: {
    paddingHorizontal: layout.matchDayCardPad,
    borderRadius: radius.card,
    borderWidth: layout.cardBorder,
    borderColor: colour.rule,
    backgroundColor: colour.surface,
  },
});
