import { NativeModule, requireNativeModule } from 'expo';

export type SpikeSample = {
  readonly atMs: number;
  readonly thermalStatus: number;
  readonly thermalHeadroom: number;
  readonly batteryPercent: number;
  /** null when the platform gave no reading. */
  readonly batteryTempC: number | null;
  readonly charging: boolean;
  /** null when unsupported (API 28+ reports it; older platforms report 0). */
  readonly currentMicroAmps: number | null;
  readonly network: string;
  readonly screenOn: boolean;
  readonly streaming: boolean;
  readonly transport: string | null;
  /** Measured endpoint throughput in bits per second (not the encoder target); 0 when not streaming. */
  readonly videoBitrate: number;
  /** Cumulative encoded frames handed to the endpoint since arm; null before arm (F-P5-4). */
  readonly videoFrames: number | null;
  readonly audioFrames: number | null;
  /** SRT's own counters (cumulative per socket) and readings; null unless a connected SRT socket answered. */
  readonly srtPacketsWritten: number | null;
  readonly srtPacketsRetransmitted: number | null;
  readonly srtPacketsWriteLost: number | null;
  readonly srtPacketsWriteDropped: number | null;
  readonly srtRttMs: number | null;
  readonly srtSndBufMs: number | null;
  readonly srtFlightSizePkts: number | null;
  readonly srtBandwidthMbps: number | null;
  /** The bitrate regulator's video target in bits per second (F-P5-5); null when none is in force. */
  readonly videoTargetBitrate: number | null;
  /** Native's account of the picture (F-P5-6). The HUD says LIVE only for `ok`. */
  readonly videoState: VideoState;
  /**
   * The watchdog's video frame rate over its 3000 ms window, one decimal (F-P5-9). null when not
   * publishing, or before the first full window of a publish.
   */
  readonly videoFps: number | null;
  /** Another app opened a camera while live and has not released it (F-P5-9). Evidence only. */
  readonly cameraContended: boolean;
  /**
   * The system is silencing this app's recording, as it did for a whole phone call (F-P5-8). The
   * audio frames still count, so only this says the broadcast is silent. false below Android 10.
   */
  readonly micSilenced: boolean;
};

/**
 * VideoStallWatchdog.kt's states. `ok` means video frames are advancing in the current publish.
 * `idle` means not publishing, or no frame yet. `failed` means auto-recovery has stopped.
 * `starved` means frames advance below a rate floor (F-P5-9); it is surfaced, never recovered.
 */
export type VideoState = 'ok' | 'starved' | 'stalled' | 'recovering' | 'failed' | 'idle';

export type SpikeEvent = { readonly kind: string; readonly atMs: number } & Readonly<
  Record<string, unknown>
>;

type Events = {
  onSample: (sample: SpikeSample) => void;
  onEvent: (event: SpikeEvent) => void;
};

declare class P5SpikeModule extends NativeModule<Events> {
  arm(): void;
  start(transport: 'srt' | 'rtmps'): void;
  stop(): void;
  mark(label: string): void;
  logPath(): string;
}

export default requireNativeModule<P5SpikeModule>('P5Spike');
