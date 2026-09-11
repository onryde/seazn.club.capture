import { useCallback, useEffect, useState } from 'react';
import {
  type LayoutChangeEvent,
  PermissionsAndroid,
  Pressable,
  type PressableStateCallbackType,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
import { useVideoPlayer, VideoView } from 'expo-video';
import { ErrorBoundary } from '@/ui/components/ErrorBoundary';
import { OverlayPreview } from '@/ui/components/OverlayPreview';
import { Text } from '@/ui/components/Text';
import { colour, layout, space } from '@/ui/theme/tokens';
import P5Spike from './P5SpikeModule';
import { P5SpikePreview } from './P5SpikePreview';
import { type SpikeState, useSpike } from './spikeStore';

type Peek = 'off' | 'default' | 'browser';

/** Throwaway P5 screen. Never merged — see docs/superpowers/plans/2026-09-11-p5-android-spike.md. */
export function SpikeScreen() {
  // The operator keeps the screen on at a ground; lock is tested deliberately, mid-run.
  useKeepAwake();
  const denied = useArmOnPermission();
  const [peek, setPeek] = useState<Peek>('off');
  const peekDefault = useCallback(() => setPeek('default'), []);
  const peekBrowser = useCallback(() => setPeek('browser'), []);
  const peekOff = useCallback(() => setPeek('off'), []);
  return (
    <View style={styles.screen}>
      <Stage peek={peek} />
      <View style={styles.column}>
        {denied ? (
          <Text variant="body">Camera or microphone permission denied.</Text>
        ) : (
          <GuardedHud />
        )}
        <Controls onPeekDefault={peekDefault} onPeekBrowser={peekBrowser} onPeekOff={peekOff} />
      </View>
    </View>
  );
}

function useArmOnPermission(): boolean {
  const [denied, setDenied] = useState(false);
  useEffect(() => {
    const { CAMERA, RECORD_AUDIO, POST_NOTIFICATIONS } = PermissionsAndroid.PERMISSIONS;
    void PermissionsAndroid.requestMultiple([CAMERA, RECORD_AUDIO, POST_NOTIFICATIONS]).then(
      (result) => {
        const granted = result[CAMERA] === 'granted' && result[RECORD_AUDIO] === 'granted';
        if (granted) P5Spike.arm();
        else setDenied(true);
      },
    );
  }, []);
  return denied;
}

function useFittedFrame() {
  const [frame, setFrame] = useState<{ width: number; height: number } | null>(null);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    const fitted = Math.min(width, height * layout.previewAspect);
    setFrame({ width: fitted, height: fitted / layout.previewAspect });
  }, []);
  return { frame, onLayout };
}

const selectOverlayUrl = (current: SpikeState) => current.overlayUrl;

/**
 * Preview and overlay share one fitted 16:9 frame, so the overlay covers exactly the picture.
 * The peek is keyed by mode so switching User-Agent builds a fresh player and a fresh boundary.
 */
function Stage({ peek }: { peek: Peek }) {
  const overlayUrl = useSpike(selectOverlayUrl);
  const { frame, onLayout } = useFittedFrame();
  return (
    <View style={styles.stage} onLayout={onLayout}>
      {frame === null ? null : (
        <View style={frame}>
          <P5SpikePreview style={StyleSheet.absoluteFill} />
          {overlayUrl === null ? null : <AlwaysOnOverlay url={overlayUrl} />}
          {peek === 'off' ? null : <OutputCheck key={peek} browserUa={peek === 'browser'} />}
        </View>
      )}
    </View>
  );
}

/** Visible for the whole run: the worst case for heat (N4), not the shipping peek. */
function AlwaysOnOverlay({ url }: { url: string }) {
  return (
    <ErrorBoundary label="Overlay crashed">
      <OverlayPreview url={url} visible caption="P5: overlay always on" />
    </ErrorBoundary>
  );
}

/** A phone UA: what Cloudflare sees from Chrome on this handset. */
const BROWSER_UA =
  'Mozilla/5.0 (Linux; Android 16; NE2211) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';

const selectPlaybackUrl = (current: SpikeState) => current.playbackUrl;

/**
 * U1-S6: the manifest 403s a non-browser UA. The shipping OutputPreview plays
 * with the player's default UA, so find out which one this device's player sends
 * and whether an explicit header survives it.
 *
 * Its own boundary: a player throw must never unmount the preview and overlay
 * whose thermal load is being measured.
 */
function OutputCheck({ browserUa }: { browserUa: boolean }) {
  const url = useSpike(selectPlaybackUrl);
  if (url === null) return null;
  return (
    <ErrorBoundary label="Output check crashed">
      <OutputPlayer url={url} browserUa={browserUa} />
    </ErrorBoundary>
  );
}

function OutputPlayer({ url, browserUa }: { url: string; browserUa: boolean }) {
  const source = browserUa ? { uri: url, headers: { 'User-Agent': BROWSER_UA } } : url;
  const player = useVideoPlayer(source, (instance) => {
    instance.muted = true; // The microphone is live; never play the broadcast out loud.
    instance.play();
  });
  useEffect(() => {
    const tag = browserUa ? 'browser' : 'default';
    const subscription = player.addListener('statusChange', ({ status, error }) => {
      P5Spike.mark(`peek-${tag}-${status}${error ? `-${error.message}` : ''}`);
    });
    return () => subscription.remove();
  }, [player, browserUa]);
  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="contain"
      nativeControls={false}
    />
  );
}

/** Its own boundary: a HUD throw must never unmount the preview and overlay being measured. */
function GuardedHud() {
  return (
    <ErrorBoundary label="HUD crashed">
      <Hud />
    </ErrorBoundary>
  );
}

const selectSample = (current: SpikeState) => current.sample;
const selectLastEvent = (current: SpikeState) => current.lastEvent;

function Hud() {
  const sample = useSpike(selectSample);
  const event = useSpike(selectLastEvent);
  if (sample === null) return <Text variant="metricUnit">{`Waiting… ${event?.kind ?? ''}`}</Text>;
  const live = sample.streaming ? `LIVE ${sample.transport ?? ''}` : 'not publishing';
  const charging = sample.charging ? ' · charging' : '';
  return (
    <View style={styles.hud}>
      <Text variant="metricUnit">{live}</Text>
      <Text variant="metricUnit">{`${decimal(sample.videoBitrate, 0, 1000)} kbps`}</Text>
      <Text variant="metricUnit">{`thermal ${decimal(sample.thermalStatus, 0)} · ${decimal(sample.thermalHeadroom, 2)}`}</Text>
      <Text variant="metricUnit">{`${decimal(sample.batteryPercent, 0)}% · ${decimal(sample.batteryTempC, 1)}°C${charging}`}</Text>
      <Text variant="metricUnit">{`${sample.network}${sample.screenOn ? '' : ' · screen off'}`}</Text>
      <Text variant="metricUnit">{`last: ${event?.kind ?? '—'}`}</Text>
    </View>
  );
}

/**
 * NaN can cross the bridge as null, and a missing reading is null; never let the HUD throw on either.
 * Every number the HUD shows goes through here, whatever its declared type — the bridge does not
 * honour TypeScript. Scaling happens after the guard, because `null / 1000` is a silent 0.
 */
function decimal(value: number | null, digits: number, divisor = 1): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? (value / divisor).toFixed(digits)
    : '—';
}

let markCount = 0;
const startSrt = () => P5Spike.start('srt');
const startRtmps = () => P5Spike.start('rtmps');
const stop = () => P5Spike.stop();
const mark = () => P5Spike.mark(`mark-${(markCount += 1)}`);

type ControlsProps = {
  onPeekDefault: () => void;
  onPeekBrowser: () => void;
  onPeekOff: () => void;
};

/**
 * Seven actions do not fit a 150dp column on a 360dp-tall landscape screen, so
 * they scroll; Stop is pinned below the scroll, never scrolled away and never
 * next to Mark.
 */
function Controls({ onPeekDefault, onPeekBrowser, onPeekOff }: ControlsProps) {
  return (
    <View style={styles.controls}>
      <ScrollView
        style={styles.actions}
        contentContainerStyle={styles.actionsContent}
        persistentScrollbar
      >
        <Action label="Start SRT" onPress={startSrt} />
        <Action label="Start RTMPS" onPress={startRtmps} />
        <Action label="Mark" onPress={mark} />
        <Action label="Peek default UA" onPress={onPeekDefault} />
        <Action label="Peek browser UA" onPress={onPeekBrowser} />
        <Action label="Peek off" onPress={onPeekOff} />
      </ScrollView>
      <HoldAction label="Hold to stop" onHold={stop} />
    </View>
  );
}

function Action({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={styles.action}>
      <Text variant="control">{label}</Text>
    </Pressable>
  );
}

/** Long enough that a brushed tap never counts; short enough to do in gloves. */
const HOLD_MS = 1000;

const holdStyle = ({ pressed }: PressableStateCallbackType) =>
  pressed ? [styles.hold, styles.holding] : styles.hold;

/**
 * AGENTS.md §6: Go Live is a tap, Stop is hold-to-confirm. There is no onPress,
 * so a tap does nothing — a mis-tap must never end a three-hour soak.
 */
function HoldAction({ label, onHold }: { label: string; onHold: () => void }) {
  return (
    <Pressable
      onLongPress={onHold}
      delayLongPress={HOLD_MS}
      accessibilityRole="button"
      accessibilityHint="Press and hold for one second"
      style={holdStyle}
    >
      <Text variant="control">{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, flexDirection: 'row', backgroundColor: colour.ground },
  stage: { flex: 1, backgroundColor: colour.stage, alignItems: 'center', justifyContent: 'center' },
  column: { width: layout.columnWidth, padding: space.sm, gap: space.sm },
  hud: { gap: space.xs },
  controls: { flex: 1, gap: space.md },
  actions: { flex: 1 },
  actionsContent: { flexGrow: 1, justifyContent: 'flex-end', gap: space.xs },
  action: {
    minHeight: 44,
    justifyContent: 'center',
    borderTopWidth: 1,
    borderTopColor: colour.rule,
  },
  hold: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: space.sm,
    borderWidth: 1,
    borderColor: colour.ink3,
  },
  holding: { backgroundColor: colour.surface2 },
});
