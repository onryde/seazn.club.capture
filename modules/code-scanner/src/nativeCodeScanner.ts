import { requireOptionalNativeModule } from 'expo';
import type { CodeScannerPort, ScanResult } from './CodeScannerPort';
import { toScanResult } from './toScanResult';

type NativeCodeScanner = { scan(): Promise<unknown>; prepare(): void };

/**
 * Optional, so a build without the module (Expo Go, a web export) degrades to
 * "the scanner didn't open" instead of crashing at import.
 */
export function createNativeCodeScanner(): CodeScannerPort {
  const native = requireOptionalNativeModule<NativeCodeScanner>('CodeScanner');
  return {
    scan: async (): Promise<ScanResult> => {
      if (native === null) return { outcome: 'unavailable', reason: 'failed' };
      try {
        return toScanResult(await native.scan());
      } catch {
        return { outcome: 'unavailable', reason: 'failed' };
      }
    },
    prepare: () => {
      try {
        native?.prepare();
      } catch {
        // Preparing is a convenience; the first scan still installs it.
      }
    },
  };
}
