import type { DiagnosticsSection } from '@/hooks/diagnostics';
import type { MessageKey } from '@/i18n/messages';

export type DiagRow = {
  readonly key: MessageKey;
  readonly section: string | null;
  readonly label: string;
  readonly value: string;
};

/**
 * Owner, Q1 (2026-10-07): the Settings card shows these nine rows, in the board's order. The rest of
 * Diagnostics (target, fps, audio, resent, dropped, data, camera, drain, charging, the last result,
 * failures) and the Engine section stay out of the card. Share record still sends the whole record.
 */
export const SETTINGS_DIAG_ROWS: readonly MessageKey[] = [
  'diag.transport',
  'diag.bitrate',
  'diag.rtt',
  'diag.delivery',
  'diag.lag',
  'diag.checked',
  'diag.battery',
  'diag.thermal',
  'diag.hbSent',
];

/**
 * Q1's rows in the board's order, picked by key and so by nothing the language changes. A section's
 * name is on its first row only; the card draws that as the section column. A key no section has
 * is left out, and the count test (nine) is what notices it.
 */
export function settingsDiagRows(sections: readonly DiagnosticsSection[]): readonly DiagRow[] {
  const found = new Map(
    sections.flatMap((section, at) => section.rows.map((row) => [row.key, { at, section, row }])),
  );
  const named = new Set<number>();
  return SETTINGS_DIAG_ROWS.flatMap((key) => {
    const hit = found.get(key);
    if (hit === undefined) return [];
    const first = !named.has(hit.at);
    named.add(hit.at);
    return [
      {
        key,
        section: first ? hit.section.title : null,
        label: hit.row.label,
        value: hit.row.value,
      },
    ];
  });
}
