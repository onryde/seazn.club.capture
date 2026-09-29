import type { CodeScannerPort, ScanResult } from './CodeScannerPort';

export type FakeCodeScanner = CodeScannerPort & {
  /** Results handed out in order. An empty queue behaves like the operator backing out. */
  queue(...results: ScanResult[]): void;
  /** The next scan stays open until the returned function is called — a scanner on screen. */
  deferNext(): (result: ScanResult) => void;
  readonly scans: number;
  readonly prepared: number;
};

export function createFakeCodeScanner(): FakeCodeScanner {
  const pending: ScanResult[] = [];
  let deferred: Promise<ScanResult> | null = null;
  let scans = 0;
  let prepared = 0;
  return {
    queue: (...results) => {
      pending.push(...results);
    },
    deferNext: () => {
      let finish: (result: ScanResult) => void = () => undefined;
      deferred = new Promise((resolve) => {
        finish = resolve;
      });
      return (result) => finish(result);
    },
    scan: async () => {
      scans += 1;
      if (deferred !== null) {
        const open = deferred;
        deferred = null;
        return open;
      }
      return pending.shift() ?? { outcome: 'cancelled' };
    },
    prepare: () => {
      prepared += 1;
    },
    get scans() {
      return scans;
    },
    get prepared() {
      return prepared;
    },
  };
}
