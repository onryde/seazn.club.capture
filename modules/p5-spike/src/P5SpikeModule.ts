import { NativeModule, requireNativeModule } from 'expo';

export type SpikeSample = {
  readonly atMs: number;
  readonly thermalStatus: number;
  readonly thermalHeadroom: number;
  readonly batteryPercent: number;
  readonly batteryTempC: number;
  readonly charging: boolean;
  readonly currentMicroAmps: number;
  readonly network: string;
  readonly screenOn: boolean;
  readonly streaming: boolean;
  readonly transport: string | null;
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
