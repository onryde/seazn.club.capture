import { createContext, useContext, type ReactNode } from 'react';
import type { CaptureEnginePort } from '@/engine/CaptureEnginePort';
import type { FakeCaptureEngine } from '@/engine/FakeCaptureEngine';
import { EngineProvider } from '@/hooks/useCaptureEngine';
import type { CodeScannerPort } from '@/scanner/CodeScannerPort';
import type { DescriptorPort } from '@/services/descriptorPort';
import type {
  BackPort,
  ForegroundPort,
  MotionPort,
  NavigationPort,
  OrientationLockPort,
  SharePort,
  SplashPort,
} from '@/services/devicePorts';
import type { KeyValueStore } from '@/services/KeyValueStore';
import type { Logger } from '@/services/logger';
import type { ModeStore } from '@/services/modeStore';
import type { HomeIntent } from '@/services/homeIntent';
import type { ScanFlight } from '@/services/scanFlight';
import type { SessionRecord } from '@/services/sessionRecord';
import type { StreamSettingsStore } from '@/services/streamSettingsStore';
import type { Surfaces } from '@/services/surfaces';

/**
 * Everything native, in one object that never changes after launch — which is
 * why it may live in context (AGENTS §8: context never carries state that
 * ticks). Built once in the root layout; tests build it from fakes.
 */
export type Ports = {
  readonly engine: CaptureEnginePort;
  /** The fake engine's extra controls, for the development-only buttons. Null in release. */
  readonly devEngine: FakeCaptureEngine | null;
  readonly scanner: CodeScannerPort;
  /** The server's word on a scanned stream code (spec §2). */
  readonly descriptor: DescriptorPort;
  readonly kv: KeyValueStore;
  readonly modeStore: ModeStore;
  /** Home's scan in flight, which the reopen gate leaves alone (I2). */
  readonly scanFlight: ScanFlight;
  /** Ended's "Scan another", taken by Home once it is ready (D24). */
  readonly homeIntent: HomeIntent;
  /** Score preview on or off, controls left or right (spec §4 Settings, D23). */
  readonly streamSettings: StreamSettingsStore;
  readonly motion: MotionPort;
  readonly orientationLock: OrientationLockPort;
  readonly back: BackPort;
  readonly foreground: ForegroundPort;
  readonly navigation: NavigationPort;
  readonly splash: SplashPort;
  /** The native views the viewfinder draws (D16). */
  readonly surfaces: Surfaces;
  /** The one levelled logger (AGENTS §11); its entries land in `record`, scrubbed. */
  readonly logger: Logger;
  /** The session record Diagnostics shows and shares (spec §4). */
  readonly record: SessionRecord;
  /** The system share sheet, for Diagnostics' Share record (D21). */
  readonly share: SharePort;
  readonly clock: () => Date;
  readonly hosts: readonly string[];
  readonly deviceLanguages: readonly (string | null)[];
  readonly phoneZone: string;
  readonly appVersion: string;
  readonly devTools: boolean;
};

const PortsContext = createContext<Ports | null>(null);

export function PortsProvider({ ports, children }: { ports: Ports; children: ReactNode }) {
  return (
    <PortsContext.Provider value={ports}>
      <EngineProvider engine={ports.engine}>{children}</EngineProvider>
    </PortsContext.Provider>
  );
}

export function usePorts(): Ports {
  const ports = useContext(PortsContext);
  if (ports === null) throw new Error('usePorts must be used inside a PortsProvider');
  return ports;
}
