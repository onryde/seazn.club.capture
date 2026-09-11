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
};

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
