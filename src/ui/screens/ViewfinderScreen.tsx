import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import {
  type TallyState,
  selectAudioLevel,
  selectHoldWindowSeconds,
  selectIsOnAir,
  selectOverlayUrl,
  selectPlaybackUrl,
  selectScoreUpdates,
  selectShed,
  selectStateKind,
  selectStatusLine,
  selectSurvivesBackground,
  selectTally,
} from '@/hooks/engineSelectors';
import { useAppLifecycle } from '@/hooks/useAppLifecycle';
import { useEngine, useEngineSelector, useSnapshotFreshness } from '@/hooks/useCaptureEngine';
import { usePeek } from '@/hooks/usePeek';
import { useSettings } from '@/hooks/useSettings';
import { ActionZone } from '@/ui/components/ActionZone';
import { AudioMeter } from '@/ui/components/AudioMeter';
import { Elapsed } from '@/ui/components/Elapsed';
import { ErrorBoundary } from '@/ui/components/ErrorBoundary';
import { LockNotice } from '@/ui/components/LockNotice';
import { OutputPreview } from '@/ui/components/OutputPreview';
import { OverlayPreview } from '@/ui/components/OverlayPreview';
import { PeekButton } from '@/ui/components/PeekButton';
import { PreviewSurface } from '@/ui/components/PreviewSurface';
import { StatusLine } from '@/ui/components/StatusLine';
import { TallyColumn } from '@/ui/components/TallyColumn';
import { Text } from '@/ui/components/Text';
import { colour, plate, plateInk, space, status } from '@/ui/theme/tokens';

const AUDIO_FLOOR = 0.05;

/**
 * Both directions are guarded, and guarded identically (AGENTS.md §6). At a
 * ground the likely mistake is a mis-tap — a pocket, a tripod pan bar, a
 * volunteer steadying the phone — not a deliberate wrong decision, and it is as
 * costly starting as stopping. Three seconds under a moving fill cannot be done
 * by accident in either direction, and costs the operator three seconds a match.
 */
const COMMIT_HOLD_MS = 3000;

/**
 * Arm and Live are one screen, not two.
 *
 * The scope lock names five screens, but arming and going live differ only in
 * what the column says — and navigating at the exact moment an operator goes
 * live would be both jarring and risky. The viewfinder simply changes state.
 */
export function ViewfinderScreen({
  onOpenSettings,
  onOpenDiagnostics,
}: {
  onOpenSettings: () => void;
  onOpenDiagnostics: () => void;
}) {
  const engine = useEngine();
  const tally = useEngineSelector(selectTally);
  const stateKind = useEngineSelector(selectStateKind);
  const statusText = useEngineSelector(selectStatusLine);
  const audio = useEngineSelector(selectAudioLevel);
  const shed = useEngineSelector(selectShed);
  const overlayUrl = useEngineSelector(selectOverlayUrl);
  const playbackUrl = useEngineSelector(selectPlaybackUrl);
  const scoreUpdates = useEngineSelector(selectScoreUpdates);
  const peek = usePeek();
  const { settings } = useSettings();
  const onAir = useEngineSelector(selectIsOnAir);
  const survivesBackground = useEngineSelector(selectSurvivesBackground);
  const holdWindowSeconds = useEngineSelector(selectHoldWindowSeconds);
  const lifecycle = useAppLifecycle();
  const stale = useSnapshotFreshness();

  // Before air the only thing worth looking at is the overlay, for framing.
  // On air the output is strictly more informative: it carries the overlay
  // *and* proves the compositor is alive, which a local render cannot.
  const peekUrl = onAir ? playbackUrl : overlayUrl;
  const overlayOff = !onAir && !settings.scorePreview;
  // Any shedding means the handset is already in trouble. Press-and-hold makes
  // the ladder's first rung nearly redundant — there is no continuous preview
  // to shed — but spinning up a WebView or a player on a hot phone is still
  // the wrong thing to do.
  // A stale snapshot blocks peeking too: there is no point spinning up a
  // player against a broadcast we cannot currently vouch for.
  const peekBlocked = shed !== null || peekUrl === null || overlayOff || stale;

  return (
    <View
      style={[
        styles.screen,
        // Column on the left is a mirror of the same layout, not a second one.
        settings.controlSide === 'left' ? styles.screenMirrored : null,
      ]}
    >
      <View style={styles.stage}>
        <PreviewSurface label={onAir ? 'Camera preview' : 'Camera preview — framing'} />

        {peek.mounted && peekUrl !== null ? (
          <ErrorBoundary label="Preview unavailable">
            {onAir ? (
              <OutputPreview url={peekUrl} visible={peek.showing} />
            ) : (
              <OverlayPreview
                url={peekUrl}
                visible={peek.showing}
                caption={overlayCaption(scoreUpdates)}
              />
            )}
          </ErrorBoundary>
        ) : null}

        {shed !== null ? (
          <StageEdge edge="top" tone="caution">
            <Text variant="metricUnit" style={styles.edgeNoteText}>
              {shedNote(shed)}
            </Text>
          </StageEdge>
        ) : null}

        {/*
          Advice, not state: the lock rule reads along the bottom edge of the
          stage rather than inside the column, which has no height to give it
          and where its two lines were the reason the column scrolled.

          Yields while a peek is showing. Both previews put their own caption on
          this exact edge, and two sentences stacked on one edge is how both stop
          being read. The peek lasts seconds; the advice is there before and after.
        */}
        {peek.showing ? null : (
          <StageEdge edge="bottom" tone="plain">
            {/*
              The two screens live here, not in the column: they are read and
              tapped at arm's length, once, and the column's height belongs to
              the holds. Mid-match is exactly when someone needs Diagnostics,
              so both are reachable in every state; each screen carries a LIVE
              plate so the broadcast is never out of sight.
            */}
            <View style={styles.links}>
              <Pressable onPress={onOpenSettings} accessibilityRole="button" style={styles.link}>
                <Text variant="control">Settings</Text>
              </Pressable>
              <Pressable onPress={onOpenDiagnostics} accessibilityRole="button" style={styles.link}>
                <Text variant="control">Diagnostics</Text>
              </Pressable>
            </View>
            {survivesBackground ? null : (
              <View style={styles.edgeAdvice}>
                <LockNotice
                  onAir={onAir}
                  holdWindowSeconds={holdWindowSeconds}
                  absences={lifecycle.absences}
                  lastAwayMs={lifecycle.lastAwayMs}
                />
              </View>
            )}
          </StageEdge>
        )}
      </View>

      {/*
        Three zones, each answering one question, separated by rules rather
        than by giving every row a divider: STATE (what is happening), HEALTH
        (is anything wrong), ACTION (what can I do). Bitrate and round-trip
        time are deliberately absent — a volunteer cannot act on "2400 kbps",
        and the status line already carries the actionable version. They live
        on Diagnostics, where someone troubleshooting will look.
      */}
      <TallyColumn side={settings.controlSide}>
        {/*
          While the snapshot is stale the column reports CHECKING in the
          trouble colour rather than whatever the stale snapshot last said —
          which, coming back from an iPhone lock, is almost certainly LIVE.
          That is the lie the freshness signal exists to prevent.
        */}
        {/*
          A solid plate, not a tinted column. State has to be readable
          unfocused from two metres, which is colour and area — a 4px stripe
          and a 12% tint are neither.
        */}
        <View style={[styles.statePlate, { backgroundColor: plateFor(stale ? 'stale' : tally) }]}>
          <Text variant="state" style={styles.stateWord}>
            {stale ? 'CHECKING' : stateWord(stateKind)}
          </Text>
        </View>

        {/* The clock appears when it starts meaning something. A 00:00 before
            anything is running is a placeholder pretending to be data. */}
        {onAir ? (
          <View style={styles.clockSlot}>
            <Elapsed dimmed={stale} />
          </View>
        ) : null}

        <View style={styles.zoneHealth}>
          <AudioMeter level={stale ? 0 : audio} floor={AUDIO_FLOOR} />
          <StatusLine>
            {stale ? staleLine(stateKind, lifecycle.lastAwayMs) : statusText}
          </StatusLine>
        </View>

        {/*
          ZONE 3a · The two holds, both always whole. Nothing in this column
          scrolls any more: a control an operator has to find by scrolling, on a
          tripod, is a control they do not have. Everything that is read rather
          than pressed moved to the stage's bottom edge, which is wide and empty.
        */}
        <View style={styles.zonePeek}>
          <PeekButton
            label={peekLabel(onAir, overlayOff, shed !== null)}
            active={peek.showing}
            disabled={peekBlocked}
            onPress={peek.press}
            onRelease={peek.release}
          />
        </View>

        {/* ZONE 3b · ACTION — pinned to the bottom edge, never scrolled away. */}
        {onAir ? (
          /* Ink, not red. Red is the tally — a state, never an action — and a
             red destructive button would make the colour mean two things. */
          <ActionZone
            label="Hold to stop"
            mode="hold"
            holdMs={COMMIT_HOLD_MS}
            accent={colour.ink}
            onAction={() => engine.send({ kind: 'stop' })}
          />
        ) : stateKind === 'ended' ? (
          // Without this the operator is stranded: a finished session can
          // neither go live again nor get back to the scan screen.
          /* Named for what it does: reset returns to the scan screen. */
          <ActionZone
            label="Scan another"
            mode="tap"
            accent={status.healthy}
            onAction={() => engine.send({ kind: 'reset' })}
          />
        ) : (
          <ActionZone
            label="Hold to go live"
            mode="hold"
            holdMs={COMMIT_HOLD_MS}
            accent={status.healthy}
            disabled={stateKind !== 'armed' || audio < AUDIO_FLOOR}
            reason={goLiveReason(audio)}
            onAction={() => engine.send({ kind: 'start' })}
          />
        )}
      </TallyColumn>
    </View>
  );
}

/**
 * Text over the stage, pinned to an edge and never the middle third (§6).
 *
 * Two edges, two jobs: the top carries device conditions in caution, the bottom
 * carries rules of engagement in plain ink. Solid ground behind the text rather
 * than a scrim — a translucent plate over grass is unreadable outdoors — and a
 * hairline on the stage side so the strip reads as a frame edge, not a caption
 * floating in the picture. Never takes a touch: the stage below it is the shot.
 */
function StageEdge({
  edge,
  tone,
  children,
}: {
  edge: 'top' | 'bottom';
  tone: 'caution' | 'plain';
  children: ReactNode;
}) {
  return (
    <View
      style={[
        styles.edgeNote,
        edge === 'top' ? styles.edgeTop : styles.edgeBottom,
        tone === 'caution' ? styles.edgeCaution : styles.edgePlain,
      ]}
      // `box-none`, not `none`: the strip itself must never swallow a touch
      // meant for the shot behind it, but the links inside it have to be
      // tappable.
      pointerEvents="box-none"
    >
      {children}
    </View>
  );
}

/** Keeps the theme ignorant of the tally vocabulary rather than the reverse. */
function plateFor(tally: TallyState | 'stale'): string {
  switch (tally) {
    case 'live':
      return plate.live;
    case 'ready':
      return plate.healthy;
    case 'trouble':
    case 'stale':
      return plate.degraded;
    case 'idle':
      return plate.inert;
  }
}

/**
 * What to say while we do not know.
 *
 * It reports how long the operator was away — a fact JavaScript owns — and
 * never how much of the hold window is left, which it does not. Native's
 * `disconnectedAt` is not the app's `backgroundedAt`, Cloudflare's clock is
 * neither, and two countdowns on one screen would disagree.
 */
function staleLine(kindBefore: string, lastAwayMs: number | null): string {
  const prefix = lastAwayMs === null ? '' : `Back after ${Math.round(lastAwayMs / 1000)}s. `;
  const subject = kindBefore === 'armed' ? 'Waiting for the camera.' : 'Checking the broadcast…';
  return `${prefix}${subject}`;
}

/**
 * Shown under a disabled Go live, so the control explains itself where it is.
 * Only the audio case can occur: this branch renders only while `armed`.
 */
function goLiveReason(audio: number): string | undefined {
  return audio < AUDIO_FLOOR ? 'No sound yet' : undefined;
}

/**
 * Says why, not merely that. "Unavailable" reads as a fault the operator caused.
 *
 * "Hold to preview" deliberately echoes "Hold to stop" beneath it: the two are
 * the column's controls and both are held. What differs is what the hold means —
 * here the hold is the preview itself, not a confirmation, so it answers
 * instantly (see PeekButton).
 */
function peekLabel(onAir: boolean, overlayOff: boolean, hot: boolean): string {
  if (overlayOff) return 'Score preview off';
  if (hot) return 'Paused, phone is hot';
  return onAir ? 'Hold to preview' : 'Hold to preview score';
}

/**
 * Stated where it is relevant — while the operator is actually looking at the
 * overlay — rather than as a banner they would stop reading after ten minutes.
 */
function overlayCaption(scoreUpdates: 'realtime' | 'polled' | null): string {
  // "On your plan" is billing talk to a volunteer who has no plan.
  if (scoreUpdates === 'polled') return 'Score here updates every 15 seconds';
  // §7 requires saying this once: the operator's score runs AHEAD of viewers',
  // because their picture is local and the broadcast's is delayed.
  return 'Score here runs a few seconds ahead of viewers';
}

/**
 * Device conditions live here and nowhere else (AGENTS.md §8). The status line
 * deliberately says nothing about heat — saying it in both places put the same
 * sentence on screen twice, worded differently, with one copy truncated.
 */
function shedNote(shed: string): string {
  switch (shed) {
    case 'overlay-preview':
      return 'Phone is hot. Score preview paused, still live. Shade it if you can.';
    case 'preview-framerate':
      return 'Phone is hot. Preview slowed to protect the stream. Shade it if you can.';
    default:
      return 'Phone is too hot to hold full quality. Viewers may notice.';
  }
}

function stateWord(kind: string): string {
  switch (kind) {
    case 'armed':
      return 'READY';
    case 'connecting':
      return 'CONNECTING';
    case 'publishing':
    case 'degraded':
      return 'LIVE';
    case 'reconnecting':
      return 'HOLDING';
    case 'ended':
      return 'ENDED';
    default:
      return 'IDLE';
  }
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: colour.ground,
  },
  screenMirrored: {
    flexDirection: 'row-reverse',
  },
  stage: {
    flex: 1,
  },
  // Edges only. Never the middle third — that is the shot being framed.
  edgeNote: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: colour.ground,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
  },
  edgeTop: {
    top: 0,
    borderBottomWidth: 1,
  },
  // The bottom edge carries two things at once — the way back and the advice —
  // so it is a row: controls first, where a thumb expects them, prose after.
  edgeBottom: {
    bottom: 0,
    borderTopWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
  },
  edgeAdvice: {
    flex: 1,
  },
  // Only one side has a width, so a single border colour is unambiguous.
  edgeCaution: {
    borderColor: status.degraded,
  },
  edgePlain: {
    borderColor: colour.rule,
  },
  edgeNoteText: {
    color: status.degraded,
  },
  // ZONE 1 · STATE. A plate, so it carries at two metres. Fixed height, which
  // also removes one of the three variable-height elements in a 375pt column.
  // Full bleed. Every pixel of plate is peripheral signal, and insetting it
  // spent that area on margin.
  statePlate: {
    height: 56,
    justifyContent: 'center',
    paddingHorizontal: space.md,
  },
  stateWord: {
    color: plateInk,
    fontSize: 18,
  },
  clockSlot: {
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    paddingBottom: space.md,
  },
  // ZONE 2 · HEALTH. Meter and sentence belong together: both answer "is
  // anything wrong".
  zoneHealth: {
    borderTopWidth: 1,
    borderTopColor: colour.rule,
    paddingTop: space.md,
    paddingHorizontal: space.md,
    gap: space.md,
  },
  // ZONE 3a takes whatever height is left, so the two holds sit against the
  // bottom bezel where a cold hand finds them, with the slack above rather
  // than between them.
  zonePeek: {
    marginTop: 'auto',
  },
  // Side by side on the stage edge, where width is what there is plenty of —
  // the reason they were stacked was a 150dp column they no longer live in.
  links: {
    flexDirection: 'row',
    gap: space.lg,
  },
  // 44pt, because these are the only way back and they get pressed with cold
  // wet hands. They were 16pt tall and 4pt apart.
  link: {
    minHeight: 44,
    justifyContent: 'center',
  },
});
