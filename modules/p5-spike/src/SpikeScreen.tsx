import { useCallback, useEffect, useState } from 'react';
import { type LayoutChangeEvent, PermissionsAndroid, Pressable, StyleSheet, View } from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
import { ErrorBoundary } from '@/ui/components/ErrorBoundary';
import { OverlayPreview } from '@/ui/components/OverlayPreview';
import { Text } from '@/ui/components/Text';
import { colour, layout, space } from '@/ui/theme/tokens';
import P5Spike from './P5SpikeModule';
import { P5SpikePreview } from './P5SpikePreview';
import { type SpikeState, useSpike } from './spikeStore';

/** Throwaway P5 screen. Never merged — see docs/superpowers/plans/2026-09-11-p5-android-spike.md. */
export function SpikeScreen() {
  // The operator keeps the screen on at a ground; lock is tested deliberately, mid-run.
  useKeepAwake();
  const denied = useArmOnPermission();
  return (
    <View style={styles.screen}>
      <Stage />
      <View style={styles.column}>
        {denied ? <Text variant="body">Camera or microphone permission denied.</Text> : <Hud />}
        <Controls />
      </View>
    </View>
  );
}

function useArmOnPermission(): boolean {
  const [denied, setDenied] = useState(false);
  useEffect(() => {
    const { CAMERA, RECORD_AUDIO, POST_NOTIFICATIONS } = PermissionsAndroid.PERMISSIONS;
    void PermissionsAndroid.requestMultiple([CAMERA, RECORD_AUDIO, POST_NOTIFICATIONS]).then((result) => {
      const granted = result[CAMERA] === 'granted' && result[RECORD_AUDIO] === 'granted';
      if (granted) P5Spike.arm();
      else setDenied(true);
    });
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

/** Preview and overlay share one fitted 16:9 frame, so the overlay covers exactly the picture. */
function Stage() {
  const overlayUrl = useSpike(selectOverlayUrl);
  const { frame, onLayout } = useFittedFrame();
  return (
    <View style={styles.stage} onLayout={onLayout}>
      {frame === null ? null : (
        <View style={frame}>
          <P5SpikePreview style={StyleSheet.absoluteFill} />
          {overlayUrl === null ? null : <AlwaysOnOverlay url={overlayUrl} />}
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

const selectSample = (current: SpikeState) => current.sample;
const selectLastEvent = (current: SpikeState) => current.lastEvent;

function Hud() {
  const sample = useSpike(selectSample);
  const event = useSpike(selectLastEvent);
  if (sample === null) return <Text variant="metricUnit">{`Waiting… ${event?.kind ?? ''}`}</Text>;
  const live = sample.streaming ? `LIVE ${sample.transport ?? ''}` : 'not publishing';
  return (
    <View style={styles.hud}>
      <Text variant="metricUnit">{live}</Text>
      <Text variant="metricUnit">{`${Math.round(sample.videoBitrate / 1000)} kbps`}</Text>
      <Text variant="metricUnit">{`thermal ${sample.thermalStatus} · ${decimal(sample.thermalHeadroom, 2)}`}</Text>
      <Text variant="metricUnit">{`${sample.batteryPercent}% · ${decimal(sample.batteryTempC, 1)}°C${sample.charging ? ' · charging' : ''}`}</Text>
      <Text variant="metricUnit">{`${sample.network}${sample.screenOn ? '' : ' · screen off'}`}</Text>
      <Text variant="metricUnit">{`last: ${event?.kind ?? '—'}`}</Text>
    </View>
  );
}

/** NaN can cross the bridge as null, and a missing reading is null; never let the HUD throw on either. */
function decimal(value: number | null, digits: number): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—';
}

let markCount = 0;
const startSrt = () => P5Spike.start('srt');
const startRtmps = () => P5Spike.start('rtmps');
const stop = () => P5Spike.stop();
const mark = () => P5Spike.mark(`mark-${(markCount += 1)}`);

function Controls() {
  return (
    <View style={styles.controls}>
      <Action label="Start SRT" onPress={startSrt} />
      <Action label="Start RTMPS" onPress={startRtmps} />
      <Action label="Stop" onPress={stop} />
      <Action label="Mark" onPress={mark} />
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

const styles = StyleSheet.create({
  screen: { flex: 1, flexDirection: 'row', backgroundColor: colour.ground },
  stage: { flex: 1, backgroundColor: colour.stage, alignItems: 'center', justifyContent: 'center' },
  column: { width: layout.columnWidth, padding: space.sm, gap: space.sm },
  hud: { gap: space.xs },
  controls: { marginTop: 'auto', gap: space.xs },
  action: {
    minHeight: 44,
    justifyContent: 'center',
    borderTopWidth: 1,
    borderTopColor: colour.rule,
  },
});
