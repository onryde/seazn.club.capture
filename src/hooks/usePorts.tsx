import { createContext, useContext, type ReactNode } from 'react';
import type { CaptureEnginePort } from '@/engine/CaptureEnginePort';
import type { FakeCaptureEngine } from '@/engine/FakeCaptureEngine';
import { EngineProvider } from '@/hooks/useCaptureEngine';
import type { CodeScannerPort } from '@/scanner/CodeScannerPort';
import type {
  BackPort,
  ForegroundPort,
  MotionPort,
  NavigationPort,
  OrientationLockPort,
  SplashPort,
} from '@/services/devicePorts';
import type { KeyValueStore } from '@/services/KeyValueStore';
import type { ModeStore } from '@/services/modeStore';
import type { ScanFlight } from '@/services/scanFlight';

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
  readonly kv: KeyValueStore;
  readonly modeStore: ModeStore;
  /** Home's scan in flight, which the reopen gate leaves alone (I2). */
  readonly scanFlight: ScanFlight;
  readonly motion: MotionPort;
  readonly orientationLock: OrientationLockPort;
  readonly back: BackPort;
  readonly foreground: ForegroundPort;
  readonly navigation: NavigationPort;
  readonly splash: SplashPort;
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
