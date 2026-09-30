import type { ScanResult, ScanUnavailableReason } from './CodeScannerPort';

const REASONS: readonly ScanUnavailableReason[] = ['noPlayServices', 'installing', 'failed'];
const FAILED: ScanResult = { outcome: 'unavailable', reason: 'failed' };

/** Native is a boundary: its answer is parsed, never trusted (AGENTS §4). */
export function toScanResult(value: unknown): ScanResult {
  if (typeof value !== 'object' || value === null) return FAILED;
  const record = value as Record<string, unknown>;
  switch (record.outcome) {
    case 'scanned':
      return typeof record.raw === 'string' ? { outcome: 'scanned', raw: record.raw } : FAILED;
    case 'cancelled':
      return { outcome: 'cancelled' };
    case 'unavailable': {
      const reason = REASONS.find((known) => known === record.reason);
      return reason === undefined ? FAILED : { outcome: 'unavailable', reason };
    }
    default:
      return FAILED;
  }
}
