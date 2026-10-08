import qrcode from 'qrcode-generator';

/** Owner rule (2026-09-30): every Seazn QR carries the logo in the centre, so error correction is H. */
export const SEAZN_QR_ERROR_CORRECTION = 'H' as const;
export const SEAZN_QR_QUIET_MODULES = 4;
/** The icon covers 0.22 of the symbol: the web's share (apps/web/src/lib/seazn-qr.ts). */
export const SEAZN_QR_ICON_FRACTION = 0.22;
export const SEAZN_QR_ICON_PAD_MODULES = 1;

export type SeaznQrPlan = {
  /** The symbol's version, 1..40. */
  readonly version: number;
  /** The symbol's edge in modules, without the quiet zone. */
  readonly modules: number;
  /** With the quiet zone: the viewBox edge. */
  readonly total: number;
  /**
   * The string the component PAINTS: a run-length path of the dark modules, the quiet zone applied, the logo's
   * square knocked out.
   */
  readonly path: string;
  /** In viewBox units. */
  readonly logo: { readonly x: number; readonly y: number; readonly size: number };
  /** True for a dark module outside the knock-out: the closure `path` was built from. */
  readonly dark: (row: number, column: number) => boolean;
  readonly knocked: (row: number, column: number) => boolean;
};

/**
 * A symbol and where its logo goes, pure. The logo's knock-out is the smallest ODD square of modules that holds
 * the icon plus a one-module pad on every side, so it centres on a module. The symbol's own data modules under
 * it are recovered by error correction H.
 */
export function seaznQrPlan(text: string): SeaznQrPlan {
  const symbol = qrcode(0, SEAZN_QR_ERROR_CORRECTION);
  symbol.addData(text, 'Byte');
  symbol.make();
  const n = symbol.getModuleCount();
  const icon = n * SEAZN_QR_ICON_FRACTION;
  let k = Math.ceil(icon + 2 * SEAZN_QR_ICON_PAD_MODULES);
  if (k % 2 === 0) k += 1;
  const k0 = (n - k) / 2;
  const q = SEAZN_QR_QUIET_MODULES;
  const knocked = (row: number, column: number) =>
    row >= k0 && row < k0 + k && column >= k0 && column < k0 + k;
  const dark = (row: number, column: number) => symbol.isDark(row, column) && !knocked(row, column);
  let path = '';
  for (let row = 0; row < n; row++) {
    for (let column = 0; column < n; column++) {
      if (!dark(row, column)) continue;
      const start = column;
      while (column < n && dark(row, column)) column++;
      path += `M${start + q} ${row + q}h${column - start}v1h-${column - start}z`;
    }
  }
  const at = q + (n - icon) / 2;
  return {
    version: (n - 17) / 4,
    modules: n,
    total: n + 2 * q,
    path,
    logo: { x: at, y: at, size: icon },
    dark,
    knocked,
  };
}
