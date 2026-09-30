/**
 * The phone's own code scanner (spec §3). A promise, deliberately: AGENTS §2's
 * "intents, not RPC" protects the long-lived stream session, and a scan is a
 * one-shot screen the operator completes or backs out of while nothing is live.
 */
export type ScanUnavailableReason = 'noPlayServices' | 'installing' | 'failed';

export type ScanResult =
  | { readonly outcome: 'scanned'; readonly raw: string }
  | { readonly outcome: 'cancelled' }
  | { readonly outcome: 'unavailable'; readonly reason: ScanUnavailableReason };

export interface CodeScannerPort {
  /** Resolves when the operator scans or backs out. Never call twice concurrently. */
  scan(): Promise<ScanResult>;
  /** Intent: fetch the scanner ahead of first use. Never throws. */
  prepare(): void;
}
