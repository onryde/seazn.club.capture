import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import {
  bannerFor,
  courtCardsAt,
  isEmptyDay,
  noCourtStake,
  noonOf,
  sendingByCourt,
  venuesOf,
  type Approval,
  type MatchDay,
  type Row,
  type Stake,
} from '@/domain/matchday/matchDay';
import { isBounce } from '@/domain/scoring/bounce';
import { useFormatDay, useFormatTime } from '@/hooks/useFormatTime';
import { useT } from '@/hooks/useLanguage';
import { usePorts } from '@/hooks/usePorts';
import { useMatchDay, type MatchDayList } from '@/hooks/useMatchDay';
import { useOpenFromMatchDay } from '@/hooks/useOpenFromMatchDay';
import { usePullRefresh } from '@/hooks/usePullRefresh';
import { useBackCloses } from '@/hooks/useBackCloses';
import { useMatchDayExit } from '@/hooks/useMatchDayExit';
import { useRowWords } from '@/hooks/useRowWords';
import { useBackToHome } from '@/hooks/useStreamLinks';
import type { MessageKey } from '@/i18n/messages';
import { ApprovalScreen } from '@/ui/screens/ApprovalScreen';
import { ApprovalBanner } from '@/ui/components/ApprovalBanner';
import { CourtCard } from '@/ui/components/CourtCard';
import { ExitMatchDaySheet } from '@/ui/components/ExitMatchDaySheet';
import { GhostButton } from '@/ui/components/GhostButton';
import { IconButton } from '@/ui/components/IconButton';
import { MatchRow } from '@/ui/components/MatchRow';
import { StakeLine } from '@/ui/components/StakeLine';
import { SubScreenHeader } from '@/ui/components/SubScreenHeader';
import { Text } from '@/ui/components/Text';
import { colour, layout, radius, space } from '@/ui/theme/tokens';

/**
 * Match Day's list (MD-2 Task 4; S4 design §5, layout B), portrait: the way back to Home, then the competition, the
 * code's scope and its day, the approval waiting, one card per court (filtered by venue on a competition code over two
 * venues), the matches on no court yet and the online boards. Offline, the last copy shows under the time it was read;
 * with none, "Offline" and Try again. A pull reads the day again. A tap on a court's match opens it in Remote Scoring
 * (Task 5; S4 design §6), and Back from there returns here, scrolled to that court. ⋯ holds Exit (Task 7; design §4): it
 * asks first, and never discards a tap.
 */
export function MatchDayScreen() {
  const { t } = useT();
  const bounce = useBounce();
  const { quiet } = bounce;
  const home = useBackToHome(quiet);
  const list = useMatchDay();
  const [line, say] = useState<MessageKey | null>(null);
  const opening = useOpenFromMatchDay({ say, refresh: list.refresh });
  const cameBackTo = useCameBackFrom();
  const opened = useOpenedIds(list.updatedAt);
  const { reviewing, review, closeReview, sent } = useReview(bounce);
  const exit = useMatchDayExit(bounce.note);
  useBackCloses(exit.sheet !== null, exit.stay);
  // The overlay's Back sits where the list's does: a second tap of a double tap must not go Home.
  const toHome = useCallback(() => {
    if (!quiet()) home();
  }, [quiet, home]);
  const askExit = useCallback(() => {
    if (!quiet()) exit.ask();
  }, [quiet, exit]);
  const covered = reviewing !== null || exit.sheet !== null;
  // A touch that lands as the review closes is the finger's own bounce, and must not act on the list beneath it.
  const open = useCallback(
    (row: Row, courtName: string) => (quiet() ? Promise.resolve() : opening(row, courtName)),
    [opening, quiet],
  );
  const body = { list, line, open, cameBackTo, opened, review };
  return (
    <View testID="matchday-screen" style={styles.screen}>
      <View
        style={styles.screen}
        aria-hidden={covered}
        importantForAccessibility={covered ? 'no-hide-descendants' : 'auto'}
      >
        <View style={styles.bar}>
          <SubScreenHeader
            title={t('mode.matchday')}
            onBack={toHome}
            plate={false}
            backLabel={t('stream.home')}
            end={<IconButton glyph="more" label={t('matchday.menu')} onPress={askExit} />}
          />
        </View>
        <MatchDayBody {...body} />
      </View>
      {reviewing === null ? null : (
        <ApprovalScreen
          approval={reviewing}
          refresh={list.refresh}
          onClose={closeReview}
          sent={sent}
        />
      )}
      {exit.sheet === null ? null : (
        <ExitMatchDaySheet stake={exit.sheet} onStay={exit.stay} onExit={exit.exit} />
      )}
    </View>
  );
}

/**
 * The moment an overlay (the approval's review, Exit's question) last closed. For `BOUNCE_MS` after it a press that is
 * not deliberate (a row, the banner's Review, ⋯, the list's own Back, Android's Back) is ignored: the finger that pressed
 * Back, Stay or Close can land again on whatever the list shows beneath it (s2-3 saw a real Cancel then Swap mis-tap).
 */
function useBounce() {
  const { clock } = usePorts();
  const closedAt = useRef<number | null>(null);
  const quiet = useCallback(
    () => closedAt.current !== null && isBounce(clock().getTime() - closedAt.current),
    [clock],
  );
  const note = useCallback(() => {
    closedAt.current = clock().getTime();
  }, [clock]);
  return useMemo(() => ({ quiet, note }), [quiet, note]);
}

/** The approval under review, if any; closing it opens the bounce window. */
function useReview({ quiet, note }: ReturnType<typeof useBounce>) {
  const [reviewing, setReviewing] = useState<Approval | null>(null);
  const sent = useRef(new Set<string>()).current;
  const review = useCallback(
    (approval: Approval) => {
      if (!quiet()) setReviewing(approval);
    },
    [quiet],
  );
  const closeReview = useCallback(() => {
    note();
    setReviewing(null);
  }, [note]);
  return { reviewing, review, closeReview, sent };
}

/**
 * The court of the match this list has come back from, read once as the list mounts, and the match is then no longer
 * open (a kill on the list reopens the list, not the pad it left). Null when the list was not reached from a pad.
 */
function useCameBackFrom(): string | null {
  const { matchDayStore, logger } = usePorts();
  const [court] = useState(() => matchDayStore.openMatch()?.courtName ?? null);
  useEffect(() => {
    if (matchDayStore.openMatch() == null) return;
    matchDayStore.clearOpen().catch(() => logger.warn('matchday.open-clear-refused'));
  }, [matchDayStore, logger]);
  return court;
}

const NONE_OPENED: ReadonlySet<string> = new Set();

/**
 * The matches this phone has opened from Match Day, read again with each read of the day: a finished row opens only
 * when its link is held (the finished answer carries none), and is otherwise not a control. Until the read lands, none.
 */
function useOpenedIds(readAt: Date | null): ReadonlySet<string> {
  const { matchDayStore } = usePorts();
  const [opened, setOpened] = useState(NONE_OPENED);
  useEffect(() => {
    let alive = true;
    void matchDayStore.opened().then((ids) => alive && setOpened(new Set(ids)));
    return () => {
      alive = false;
    };
  }, [matchDayStore, readAt]);
  return opened;
}

type BodyProps = {
  readonly list: MatchDayList;
  readonly line: MessageKey | null;
  readonly open: (row: Row, courtName: string) => Promise<void>;
  readonly cameBackTo: string | null;
  readonly opened: ReadonlySet<string>;
  readonly review: (approval: Approval) => void;
};

const MatchDayBody = memo(function MatchDayBody({
  list,
  line,
  open,
  cameBackTo,
  opened,
  review,
}: BodyProps) {
  if (list.day !== null)
    return (
      <DayList
        list={list}
        day={list.day}
        line={line}
        open={open}
        cameBackTo={cameBackTo}
        opened={opened}
        review={review}
      />
    );
  if (list.state === 'offline') return <OfflineEmpty retry={list.refresh} reading={list.reading} />;
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

/**
 * A saved code with no copy and no connection (the dispatch's ruling 1): no list, and a way to ask again. While a read
 * is out (Try again's, or the poll's) it says the day is being fetched and Try again waits (review M4): never a tap that
 * shows nothing for 8 s.
 */
const OfflineEmpty = memo(function OfflineEmpty({
  retry,
  reading,
}: {
  readonly retry: () => void;
  readonly reading: boolean;
}) {
  const { t } = useT();
  return (
    <View style={styles.middle}>
      <Text variant="title">{t('matchday.offlineEmpty')}</Text>
      {reading ? <Text variant="body">{t('matchday.loading.body')}</Text> : null}
      <GhostButton label={t('panel.tryAgain')} onPress={retry} disabled={reading} />
    </View>
  );
});

const REFRESH_COLOURS = [colour.lime];

const DayList = memo(function DayList({
  list,
  day,
  line,
  open,
  cameBackTo,
  opened,
  review,
}: {
  readonly list: MatchDayList;
  readonly day: MatchDay;
  readonly line: MessageKey | null;
  readonly open: BodyProps['open'];
  readonly cameBackTo: string | null;
  readonly opened: ReadonlySet<string>;
  readonly review: BodyProps['review'];
}) {
  const { t } = useT();
  const { scroller, onSlot } = useScrollToCourt(cameBackTo);
  const banner = useMemo(() => bannerFor(day), [day]);
  const offlineAt = list.state === 'offline' ? list.updatedAt : null;
  // react-native-web draws no pull and drops its props: the spinner is the device check's, its rule
  // `usePullRefresh`'s (tested). Try again and the poll call the same `refresh`.
  const { refreshing, onRefresh } = usePullRefresh(list.refresh, list.reading);
  const pull = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor={colour.lime}
      colors={REFRESH_COLOURS}
      progressBackgroundColor={colour.surface}
    />
  );
  return (
    <ScrollView
      ref={scroller}
      style={styles.list}
      contentContainerStyle={styles.column}
      refreshControl={pull}
    >
      <DayHeader day={day} offlineAt={offlineAt} />
      {line === null ? null : (
        <Text variant="control" style={styles.offline}>
          {t(line)}
        </Text>
      )}
      {banner === null ? null : <ApprovalBanner banner={banner} onReview={review} />}
      <Courts day={day} unsent={list.unsent} open={open} onSlot={onSlot} opened={opened} />
      <RowSection
        title={`${t('matchday.noCourt')} · ${day.noCourt.length}`}
        rows={day.noCourt}
        zone={day.tz}
        stake={noCourtStake(day, list.unsent)}
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

/**
 * Back from a pad scrolls the list to the court the match was opened from (S4 design §6), once, when that court's card
 * has been laid out: a refresh, a poll or a venue chip never scrolls it again. A court no longer on the day scrolls
 * nothing.
 */
function useScrollToCourt(court: string | null) {
  const scroller = useRef<ScrollView>(null);
  const done = useRef(false);
  const onSlot = useCallback(
    (name: string, y: number) => {
      if (court === null || name !== court || done.current) return;
      done.current = true;
      scroller.current?.scrollTo({ y, animated: false });
    },
    [court],
  );
  return { scroller, onSlot };
}

const Courts = memo(function Courts({
  day,
  unsent,
  open,
  onSlot,
  opened,
}: {
  readonly day: MatchDay;
  readonly unsent: ReadonlyMap<string, number | null>;
  readonly opened: ReadonlySet<string>;
  readonly open: BodyProps['open'];
  readonly onSlot: (courtName: string, y: number) => void;
}) {
  const [venue, setVenue] = useState<string | null>(null);
  const [expanded, flip] = useExpandedCourts(day);
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
          stake={sending.get(card.courtId) ?? NO_STAKE}
          zone={day.tz}
          onOpen={open}
          onSlot={onSlot}
          opened={opened}
          expanded={expanded.has(card.courtId)}
          onToggle={flip}
        />
      ))}
    </>
  );
});

/**
 * The courts showing every finished match, by court id: the screen's own state, not stored, so a reload starts
 * collapsed. A court that is down to one finished match or none (the day read again) forgets its flag, so it does not
 * come back open when a second one arrives.
 */
function useExpandedCourts(
  day: MatchDay,
): readonly [ReadonlySet<string>, (courtId: string) => void] {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const flip = useCallback(
    (courtId: string) =>
      setExpanded((now) => {
        const next = new Set(now);
        if (!next.delete(courtId)) next.add(courtId);
        return next;
      }),
    [],
  );
  useEffect(() => {
    const many = new Set(day.courts.filter((c) => c.finished.length > 1).map((c) => c.courtId));
    setExpanded((now) => {
      const kept = new Set([...now].filter((id) => many.has(id)));
      return kept.size === now.size ? now : kept;
    });
  }, [day]);
  return [expanded, flip];
}

const NO_STAKE: Stake = { count: 0, unreadable: false };

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

/**
 * The matches on no court yet, or the online boards: a heading and read-only rows (online rows never open). The matches
 * on no court say what they still hold unsent, as a court does (review M2); online boards are never scored here.
 */
const RowSection = memo(function RowSection({
  title,
  rows,
  zone,
  stake,
}: {
  readonly title: string;
  readonly rows: readonly Row[];
  readonly zone: string;
  readonly stake?: Stake;
}) {
  const words = useRowWords(zone);
  if (rows.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text variant="diagSection">{title}</Text>
      {stake === undefined ? null : <StakeLine stake={stake} />}
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
