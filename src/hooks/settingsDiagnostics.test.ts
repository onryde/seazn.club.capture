import { describe, expect, it } from 'vitest';
import type { Telemetry } from '@/engine/CaptureEnginePort';
import { createFakeCaptureEngine, type FakeScene } from '@/engine/FakeCaptureEngine';
import { diagnosticsSections } from '@/hooks/diagnostics';
import { settingsDiagRows } from '@/hooks/settingsDiagnostics';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import type { Lang } from '@/i18n/language';
import { createTranslator } from '@/i18n/translate';

const NOW = Date.parse('2026-10-03T13:00:00Z');

/** The sections the way `diagnostics.test.ts` builds them: the fake engine's scene, read at NOW. */
function sectionsFor(scene: FakeScene, telemetry: Partial<Telemetry> = {}, lang: Lang = 'en') {
  const engine = createFakeCaptureEngine(() => NOW);
  engine.scene(scene);
  engine.patch(telemetry);
  const sections = diagnosticsSections(engine.getSnapshot(), NOW, createTranslator(lang));
  engine.dispose();
  return sections;
}

/**
 * Owner, Q1 (2026-10-07): the board's 9 rows, in the board's order. The section keys are
 * diagnostics.ts's own. A literal, never read from the code under test (F13).
 */
const Q1_ROWS = [
  ['diag.transport', 'diag.section.link'],
  ['diag.bitrate', null],
  ['diag.rtt', null],
  ['diag.delivery', 'diag.section.delivery'],
  ['diag.lag', null],
  ['diag.checked', null],
  ['diag.battery', 'diag.section.device'],
  ['diag.thermal', null],
  ['diag.hbSent', 'diag.section.heartbeat'],
] as const;

describe("Settings' Diagnostics rows (Q1, spec §6)", () => {
  it("shows Q1's rows, in the board's order, each section named once on its first row", () => {
    const rows = settingsDiagRows(sectionsFor('live'));
    expect(rows).toHaveLength(9); // Q1's count, a literal (anti-vacuity: 0 rows would fail)
    expect(rows.map((row) => row.key)).toEqual(Q1_ROWS.map(([key]) => key));
    expect(rows.map((row) => row.section)).toEqual(
      Q1_ROWS.map(([, section]) => (section === null ? null : en[section])),
    );
    expect(rows.some((row) => row.key.startsWith('diag.engine'))).toBe(false);
  });

  // The labels and values come from the dictionary and the live table in diagnostics.test.ts.
  it('reads each row as its label and its live value', () => {
    expect(settingsDiagRows(sectionsFor('live')).map((row) => [row.label, row.value])).toEqual([
      ['Transport', 'SRT'],
      ['Bitrate', '2840 kbps'],
      ['Round trip', '48 ms'],
      ['Viewers receiving', 'Yes'],
      ['Behind live', '9.2 s'],
      ['Checked', '1.5 s ago'],
      ['Battery', '74%'],
      ['Heat', 'Normal'],
      ['Last sent', '4 s ago'],
    ]);
  });

  // Question 2, an empty reading: a phone that has measured nothing still has its nine rows, as dashes.
  it('keeps all nine rows when nothing has been measured, the values as dashes', () => {
    const rows = settingsDiagRows(sectionsFor('stopped'));
    expect(rows).toHaveLength(9);
    expect(rows.map((row) => row.key)).toEqual(Q1_ROWS.map(([key]) => key));
    expect(rows.find((row) => row.key === 'diag.battery')?.value).toBe('—');
    expect(rows.find((row) => row.key === 'diag.hbSent')?.value).toBe('—');
  });

  // Question 2: no sections, no rows, and no throw.
  it('is empty for no sections', () => {
    expect(settingsDiagRows([])).toEqual([]);
  });

  // Question 1, a second call: the next report's values, with the rows as they were.
  it('follows the next report on a second call', () => {
    const first = settingsDiagRows(sectionsFor('live'));
    const second = settingsDiagRows(sectionsFor('live', { bitrateKbps: 2950 }));
    expect(first.find((row) => row.key === 'diag.bitrate')?.value).toBe('2840 kbps');
    expect(second.find((row) => row.key === 'diag.bitrate')?.value).toBe('2950 kbps');
    expect(second.map((row) => row.key)).toEqual(first.map((row) => row.key));
  });

  // The order is the list's, not the sections': the sort key is perturbed, so a pass-through of
  // the input order fails here.
  it("orders by the board, whatever order the sections arrive in, and names each section's first row", () => {
    const rows = settingsDiagRows([...sectionsFor('live')].reverse());
    expect(rows.map((row) => row.key)).toEqual(Q1_ROWS.map(([key]) => key));
    expect(rows.map((row) => row.section)).toEqual(
      Q1_ROWS.map(([, section]) => (section === null ? null : en[section])),
    );
  });

  // Question 4, another language: the same keys, the language's own labels and section names.
  it('selects by key, so the Spanish card has the same nine rows', () => {
    const rows = settingsDiagRows(sectionsFor('live', {}, 'es'));
    expect(rows.map((row) => row.key)).toEqual(Q1_ROWS.map(([key]) => key));
    expect(rows.map((row) => row.section)).toEqual(
      Q1_ROWS.map(([, section]) => (section === null ? null : es[section])),
    );
    expect(rows.map((row) => row.label)).toEqual(Q1_ROWS.map(([key]) => es[key]));
  });
});
