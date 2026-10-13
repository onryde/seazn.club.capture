import { memo, useMemo } from 'react';
import { Image, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { screenLayout, type ScreenLayout } from '@/domain/mode/homeLayout';
import type { Mode } from '@/domain/mode/Mode';
import { BUILT_MODES } from '@/domain/mode/scanOutcome';
import { useBackCloses } from '@/hooks/useBackCloses';
import type { EndedCard as EndedCardValue } from '@/domain/session/endedCard';
import { useEndedCard } from '@/hooks/useEndedNotice';
import { useHome, type HomeActions, type HomeView } from '@/hooks/useHome';
import { useT } from '@/hooks/useLanguage';
import { usePorts } from '@/hooks/usePorts';
import { useHomeLinks } from '@/hooks/useStreamLinks';
import logo from '@/ui/assets/logo-wide-night.png';
import { CodePanel } from '@/ui/components/CodePanel';
import { ContinueCard } from '@/ui/components/ContinueCard';
import type { CardShape } from '@/ui/components/cardShape';
import { DevPaste } from '@/ui/components/DevPaste';
import { DevProbe } from '@/ui/components/DevProbe';
import { EndedCard } from '@/ui/components/EndedCard';
import { HomeFooter } from '@/ui/components/HomeFooter';
import { StatusLine } from '@/ui/components/StatusLine';
import { Tile } from '@/ui/components/Tile';
import { layoutMarker } from '@/ui/layoutMarker';
import { MODES } from '@/ui/modeCopy';
import { colour, layout as metrics, space } from '@/ui/theme/tokens';

/**
 * Layout A (spec §7), portrait: the logo, status, the Stream ended card when there is one, Continue, three tiles
 * (each grows from its content, P7; R11 of the D3 findings design), footer; the panel over all. Landscape follows the
 * phone: one top row (logo, status, Language, version), then the ended card and Continue as one row each, then the
 * three tiles side by side. Back closes the panel (R31).
 * The root says which in `data-layout`, the marker the tests read. Both layouts scroll only when their rows outgrow
 * the window (homeFit.test.ts: landscape, two cards on a small phone; portrait, R11, a card on a 360 × 720 window).
 */
export function HomeScreen() {
  const { view, actions } = useHome();
  useBackCloses(view.panel !== null, actions.closePanel);
  const { width, height } = useWindowDimensions();
  const layout = screenLayout(width, height);
  return (
    <View
      {...layoutMarker('home', layout)}
      style={layout === 'landscape' ? styles.screenLandscape : styles.screen}
    >
      <HomeContent view={view} actions={actions} layout={layout} />
      {view.panel === null ? null : (
        <CodePanel
          outcome={view.panel}
          time={view.panelTime}
          onOpen={actions.openFromPanel}
          onScanAgain={actions.scanAgain}
          onClose={actions.closePanel}
          onTryAgain={actions.retryCheck}
          onConfirmUnpair={actions.confirmUnpair}
          onCancelUnpair={actions.cancelUnpair}
        />
      )}
    </View>
  );
}

/**
 * Everything behind the panel, hidden from screen readers while it is up.
 * `aria-modal` on the sheet holds VoiceOver only; TalkBack needs Home itself
 * hidden. RN 0.86's View already maps `aria-hidden` to Android's
 * `importantForAccessibility="no-hide-descendants"`; the explicit prop keeps
 * that true if the mapping ever changes. react-native-web reads only
 * `aria-hidden`, which is what the tests assert.
 */
function HomeContent({
  view,
  actions,
  layout,
}: {
  view: HomeView;
  actions: HomeActions;
  layout: ScreenLayout;
}) {
  const { appVersion, devTools } = usePorts();
  const ended = useEndedCard();
  const { streamSettings } = useHomeLinks();
  // P6: the gear only while no card stands above the tiles. With Continue the phone may hold a pairing, and Stream
  // Settings from Home assumes none (AGENTS §6); the in-mode Settings, after Continue re-pairs, has the same rows.
  // Sideways the gear's band would also make Home scroll with the Continue card at 800 × 360; the ended card leaves
  // 1 dp (homeFit.test.ts).
  const gear = ended === null && view.continueCode === null ? streamSettings : null;
  const landscape = layout === 'landscape';
  const shape = landscape ? 'row' : 'stacked';
  const behindPanel = view.panel !== null;
  const hidden = {
    'aria-hidden': behindPanel,
    importantForAccessibility: behindPanel ? 'no-hide-descendants' : 'auto',
  } as const;
  const rows = (
    <>
      {landscape ? (
        <View testID="home-top" style={styles.top}>
          <Logo layout={layout} />
          <View style={styles.topStatus}>
            <StatusLine>{view.statusText}</StatusLine>
          </View>
          <HomeFooter version={appVersion} layout={layout} />
        </View>
      ) : (
        <>
          <Logo layout={layout} />
          <StatusLine>{view.statusText}</StatusLine>
        </>
      )}
      <EndedSlot card={ended} shape={shape} />
      <ContinueSlot view={view} actions={actions} shape={shape} />
      <ModeTiles onPress={actions.tapTile} layout={layout} streamSettings={gear} />
      {devTools ? <DevPaste onUse={actions.useRaw} /> : null}
      {devTools ? <DevProbe /> : null}
      {landscape ? null : <HomeFooter version={appVersion} />}
    </>
  );
  // Each layout scrolls only if its rows outgrow the window (landscape: a fatal end's two cards over three tiles on
  // a 640 × 360 phone; portrait, P7 and R11: a card over three tiles on a 360 × 720 one; homeFit.test.ts); when
  // they fit, `flexGrow` makes the tiles take what is left.
  return (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={landscape ? styles.contentLandscape : styles.content}
      {...hidden}
    >
      {rows}
    </ScrollView>
  );
}

/**
 * Home's title is the Seazn Club night logo (spec §7): 200 × 70 upright, 160 × 56 sideways (Q2), named for a
 * screen reader. A brand is not translated, but it stays a dictionary entry (`brand`) with the rest of the copy.
 * The board hangs the file's own empty left edge outside the column, so the wordmark sits on the margin.
 */
function Logo({ layout }: { layout: ScreenLayout }) {
  const { t } = useT();
  return (
    <Image
      source={logo}
      accessibilityRole="image"
      accessibilityLabel={t('brand')}
      resizeMode="contain"
      style={layout === 'landscape' ? styles.logoLandscape : styles.logo}
    />
  );
}

/**
 * The Stream ended card (spec §5), above Continue: only after the phone's Stop or a fatal end left the viewfinder
 * for Home. OK, a new scan or Continue clears it; it is in memory, so a restart does too. Home reads it once and
 * passes it here, since the Stream settings gear hides while it shows (P6).
 */
function EndedSlot({ card, shape }: { card: EndedCardValue | null; shape: CardShape }) {
  const { endedNotice } = usePorts();
  return card === null ? null : <EndedCard card={card} layout={shape} onOk={endedNotice.clear} />;
}

/** The Continue card, only when a left mode still holds a valid code. */
function ContinueSlot({
  view,
  actions,
  shape,
}: {
  view: HomeView;
  actions: HomeActions;
  shape: CardShape;
}) {
  const code = view.continueCode;
  if (code === null || view.continueCopy === null) return null;
  return (
    <ContinueCard
      mode={code.mode}
      copy={view.continueCopy}
      layout={shape}
      onContinue={actions.continueStream}
      onForget={actions.forgetStream}
    />
  );
}

/**
 * The three tiles; the Live Stream tile carries the Stream settings gear when Home gives one (R2, as the owner
 * presented it on 2026-10-12; P6). Its name for a screen reader is `home.streamSettings`.
 */
const ModeTiles = memo(function ModeTiles({
  onPress,
  layout,
  streamSettings,
}: {
  onPress: (mode: Mode) => void;
  layout: ScreenLayout;
  streamSettings: (() => void) | null;
}) {
  const { t } = useT();
  // Memoised so the memoised tile is not handed a new object on every pass.
  const gear = useMemo(
    () =>
      streamSettings === null
        ? undefined
        : { label: t('home.streamSettings'), onPress: streamSettings },
    [streamSettings, t],
  );
  return (
    <View testID="tiles" style={layout === 'landscape' ? styles.tilesRow : styles.tiles}>
      {MODES.map((mode) => (
        <Tile
          key={mode}
          mode={mode}
          available={BUILT_MODES.includes(mode)}
          onPress={onPress}
          layout={layout}
          settings={mode === 'stream' ? gear : undefined}
        />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  screen: { flex: 1, padding: space.md, backgroundColor: colour.ground },
  /** Landscape pads its scroller's content instead (`contentLandscape`), so a scrolled row passes under the edge. */
  screenLandscape: { flex: 1, backgroundColor: colour.ground },
  /** P7 and R11: `flexGrow`, not `flex`, in the portrait scroller: the tiles share the window when they fit. */
  content: { flexGrow: 1, gap: space.sm },
  /** M1 of the Batch 5 review: `flexGrow`, not `flex`, inside the portrait scroller, as the landscape row is. */
  tiles: { flexGrow: 1, gap: space.sm },
  fill: { flex: 1 },
  contentLandscape: {
    flexGrow: 1,
    gap: metrics.homeGap,
    paddingTop: metrics.homePadTop,
    paddingHorizontal: space.md,
    paddingBottom: metrics.homePadBottom,
  },
  /** Board "Home, landscape": the logo, the status and the footer in one row, 16 apart; a wide footer wraps under. */
  top: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.md },
  topStatus: { flex: 1, minWidth: 0 },
  /** `flexGrow`, not `flex`: in a scroller a zero basis would collapse the row to nothing. */
  tilesRow: { flexGrow: 1, flexDirection: 'row', gap: space.sm },
  logo: { ...metrics.logo, marginLeft: -metrics.logoInset },
  logoLandscape: { ...metrics.logoLandscape, marginLeft: -metrics.logoInsetLandscape },
});
