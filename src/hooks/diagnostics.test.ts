import { describe, expect, it } from 'vitest';
import type { CameraState, Telemetry } from '@/engine/CaptureEnginePort';
import { createFakeCaptureEngine, type FakeScene } from '@/engine/FakeCaptureEngine';
import { PAIR } from '@/engine/testing/pairIntent';
import { UNREPORTED } from '@/engine/unreported';
import { diagnosticsSections } from '@/hooks/diagnostics';
import en from '@/i18n/en.json';
import type { Lang } from '@/i18n/language';
import { createTranslator } from '@/i18n/translate';

const NOW = Date.parse('2026-10-03T13:00:00Z');

function rowsFor(
  scene: FakeScene,
  change: { telemetry?: Partial<Telemetry>; camera?: CameraState | null } = {},
  lang: Lang = 'en',
): Record<string, string> {
  const engine = createFakeCaptureEngine(() => NOW);
  engine.scene(scene);
  if (change.telemetry !== undefined) engine.patch(change.telemetry);
  if (change.camera !== undefined) engine.setCamera(change.camera);
  const sections = diagnosticsSections(engine.getSnapshot(), NOW, createTranslator(lang));
  engine.dispose();
  return Object.fromEntries(
    sections.flatMap((section) => section.rows.map((row) => [row.label, row.value])),
  );
}

describe('diagnosticsSections (spec §4)', () => {
  it('reads the live link, delivery, phone and heartbeat', () => {
    expect(rowsFor('live')).toEqual({
      Transport: 'SRT',
      Bitrate: '2840 kbps',
      Target: '3000 kbps',
      Video: '30 fps',
      'Sending audio': '47 packets/s',
      'Round trip': '48 ms',
      Resent: '240 of 120000',
      Dropped: '3',
      'Viewers receiving': 'Yes',
      'Behind live': '9.2 s',
      Checked: '1.5 s ago',
      'Data used': '312 MB',
      Camera: 'This app',
      Battery: '74%',
      Drain: '18%/h',
      Charging: 'No',
      Heat: 'Normal',
      'Last sent': '4 s ago',
      'Last result': 'Accepted',
      Failures: '0',
      'Last report': '0 s ago',
      'Record lines refused': '0',
      'Record lines dropped': '0',
    });
  });

  it('names its five sections, the engine last', () => {
    const engine = createFakeCaptureEngine(() => NOW);
    const titles = diagnosticsSections(engine.getSnapshot(), NOW, createTranslator('en')).map(
      (section) => section.title,
    );
    engine.dispose();
    expect(titles).toEqual(['Link', 'Delivery', 'Phone', 'Heartbeat', 'Engine']);
  });

  // Task 5: Settings' card picks its rows by key, never by translated text, so a row says which
  // message it was made from. The count is the table above: 23 rows, each a distinct key.
  it('gives every row the message key its label was translated from', () => {
    const engine = createFakeCaptureEngine(() => NOW);
    engine.scene('live');
    const sections = diagnosticsSections(engine.getSnapshot(), NOW, createTranslator('en'));
    engine.dispose();
    const rows = sections.flatMap((section) => section.rows);
    expect(rows).toHaveLength(23);
    expect(new Set(rows.map((row) => row.key)).size).toBe(23);
    for (const row of rows)
      expect({ key: row.key, label: row.label }).toEqual({
        key: row.key,
        label: en[row.key],
      });
  });

  it('says what is unknown rather than inventing a number', () => {
    expect(rowsFor('fell-back')).toMatchObject({
      Transport: 'RTMPS',
      'Round trip': '—',
      Resent: '—',
      Dropped: '—',
    });
    expect(rowsFor('paired-ready')).toMatchObject({ Transport: '—', Bitrate: '—', Target: '—' });
  });

  // Carry 11: a field native has no reading for is a dash, never 0 and never healthy.
  it.each([
    ['bitrateKbps', 'Bitrate'],
    ['targetBitrateKbps', 'Target'],
    ['encodedVideoFps', 'Video'],
    ['audioPacketsPerSecond', 'Sending audio'],
    ['deliveredLagMs', 'Behind live'],
  ] as const)('shows a dash for a null %s on air', (field, label) => {
    const rows = rowsFor('live', { telemetry: { [field]: null } });
    expect(rows[label]).toBe('—');
    // Only that row: the rest of the live readings stand.
    expect(rows['Viewers receiving']).toBe('Yes');
    expect(rows.Transport).toBe('SRT');
  });

  it('reads a measured zero as zero, not as unknown', () => {
    expect(rowsFor('live', { telemetry: { bitrateKbps: 0, deliveredLagMs: 0 } })).toMatchObject({
      Bitrate: '0 kbps',
      'Behind live': '0 s',
    });
  });

  // Carry 12: the audio row is audio leaving the phone, not the mic's health.
  // Native reports no rate before air, so paired reads a dash: that is correct.
  it('sends no audio while paired, whatever the mic hears', () => {
    expect(rowsFor('paired-ready')).toMatchObject({ 'Sending audio': '—', Video: '—' });
  });

  it('says what it does not know about the phone and the heartbeat', () => {
    expect(rowsFor('stopped')).toMatchObject({
      Camera: '—',
      Battery: '—',
      Drain: '—',
      Charging: '—',
      Heat: '—',
      Checked: '—',
      'Viewers receiving': 'Not checked yet',
      'Last sent': '—',
      'Last result': '—',
      Failures: '0',
    });
  });

  it('names the heat step and the stall', () => {
    expect(rowsFor('shed')).toMatchObject({ Heat: 'Very hot' });
    expect(rowsFor('not-delivered')).toMatchObject({
      'Viewers receiving': 'Stalled',
      'Behind live': '21 s',
    });
  });

  // Carry 13: whose camera it is, from snapshot.camera.
  it.each([
    ['own', 'This app'],
    ['taken', 'Another app'],
    ['reopening', 'Reopening'],
    ['resuming', 'No picture yet'],
    ['switching', 'Switching'],
  ] as const)('reads the camera as %s', (camera, value) => {
    expect(rowsFor('live', { camera }).Camera).toBe(value);
  });

  it('reads every heat step by name', () => {
    const heat = (thermalStatus: Telemetry['thermalStatus']) =>
      rowsFor('live', { telemetry: { thermalStatus } }).Heat;
    expect((['light', 'moderate', 'critical', 'emergency', 'shutdown'] as const).map(heat)).toEqual(
      ['Warm', 'Hot', 'Critical', 'Emergency', 'Shutting down'],
    );
  });

  it('reads the heartbeat failing and the session over', () => {
    const failing = {
      lastSentAtEpochMs: NOW - 12_000,
      lastResult: 'failed',
      consecutiveFailures: 3,
      failures: 7,
    } as const;
    expect(rowsFor('live', { telemetry: { heartbeat: failing } })).toMatchObject({
      'Last sent': '12 s ago',
      'Last result': 'Failed',
      Failures: '7',
    });
    const over = { ...failing, lastResult: 'session-over' } as const;
    expect(rowsFor('live', { telemetry: { heartbeat: over } })['Last result']).toBe('Session over');
  });

  it('reads charging, and the battery as reported', () => {
    expect(rowsFor('live', { telemetry: { charging: true, batteryPercent: 100 } })).toMatchObject({
      Charging: 'Yes',
      Battery: '100%',
    });
  });

  // Ruling 2 (fix round 1): the language's own decimal separator.
  it.each([
    ['en', { 'Behind live': '9.2 s', Checked: '1.5 s ago' }],
    ['es', { Retraso: '9,2 s', Comprobado: 'hace 1,5 s' }],
    ['fr', { Retard: '9,2 s', Vérifié: 'il y a 1,5 s' }],
    ['nl', { Achterstand: '9,2 s', Gecontroleerd: '1,5 s geleden' }],
  ] as const)('writes decimals the %s way', (lang, expected) => {
    expect(rowsFor('live', {}, lang)).toMatchObject(expected);
  });

  // Fix round 3 (n1): a native timestamp a moment ahead of the phone's clock
  // (an NTP step) is no negative age, and Intl would write -0.04 as "-0".
  it.each([
    ['en', 40, { Checked: '0 s ago' }],
    ['en', 2000, { Checked: '0 s ago' }],
    ['es', 40, { Comprobado: 'hace 0 s' }],
  ] as const)(
    'reads a %s check %i ms ahead of the clock as no time ago',
    (lang, aheadMs, expected) => {
      const rows = rowsFor('live', { telemetry: { deliveryCheckedAtMs: NOW + aheadMs } }, lang);
      expect(rows).toMatchObject(expected);
    },
  );

  // Fix round 3 (n2): Data used is whole megabytes, rounded to the nearest.
  it.each([
    [312_400_000, '312 MB'],
    [312_600_000, '313 MB'],
  ])('reads %i bytes as %s', (bytes, expected) => {
    expect(rowsFor('live', { telemetry: { dataUsedBytes: bytes } })['Data used']).toBe(expected);
  });

  it('writes a fractional rate the language’s way, and counts ungrouped', () => {
    const rows = rowsFor(
      'live',
      { telemetry: { encodedVideoFps: 29.5, drainPctPerHour: 18.5 } },
      'nl',
    );
    expect(rows).toMatchObject({
      Video: '29,5 fps',
      Verbruik: '18,5%/u',
      'Opnieuw verzonden': '240 van 120000',
    });
  });

  it('reads in French', () => {
    expect(rowsFor('live', {}, 'fr')).toMatchObject({
      Débit: '2840 kbps',
      Vidéo: '30 i/s',
      'Données utilisées': '312 Mo',
      'Dernier envoi': 'il y a 4 s',
      'Dernier rapport': 'il y a 0 s',
      'Lignes du journal refusées': '0',
      Batterie: '74 %',
      Température: 'Normale',
    });
  });

  it('carry 12 shows when native last reported, and the record lines it refused and dropped', () => {
    const engine = createFakeCaptureEngine(() => NOW);
    engine.patch({ recordSinkFailures: 2, recordReentrantDropped: 1 });
    const snapshot = { ...engine.getSnapshot(), reportedAtMs: NOW - 4_000 };
    const sections = diagnosticsSections(snapshot, NOW, createTranslator('en'));
    const section = sections.find((s) => s.title === en['diag.section.engine']);
    expect(section?.rows).toEqual([
      { key: 'diag.lastReport', label: en['diag.lastReport'], value: '4 s ago' },
      { key: 'diag.recordRefused', label: en['diag.recordRefused'], value: '2' },
      { key: 'diag.recordDropped', label: en['diag.recordDropped'], value: '1' },
    ]);
    engine.dispose();
  });

  // Question 2: `UNREPORTED`'s 0 is "native has said nothing yet", never a report 56 years ago.
  it('says it does not know when native has not reported yet', () => {
    const sections = diagnosticsSections(UNREPORTED, NOW, createTranslator('en'));
    const section = sections.find((s) => s.title === 'Engine');
    expect(section?.rows[0]).toEqual({ key: 'diag.lastReport', label: 'Last report', value: '—' });
  });

  // C4c-I4: silence reads as a climbing age; drift keeps it current (nativeCaptureEngine).
  it('reads a silent engine as a report long ago', () => {
    const snapshot = { ...UNREPORTED, reportedAtMs: NOW - 12_000 };
    const section = diagnosticsSections(snapshot, NOW, createTranslator('en')).at(-1);
    expect(section?.rows[0]).toEqual({
      key: 'diag.lastReport',
      label: 'Last report',
      value: '12 s ago',
    });
  });
});

describe('A18: SRT not offered (Diagnostics)', () => {
  /** A broadcast the fake held, on RTMPS, with SRT offered or not. */
  function linkRows(srtOffered: boolean | null) {
    const engine = createFakeCaptureEngine(() => NOW);
    engine.send(PAIR);
    engine.send({ kind: 'start' });
    const live = engine.getSnapshot();
    engine.dispose();
    if (live.broadcast === null) throw new Error('the fake holds no broadcast after a start');
    const rtmpsOnly = {
      ...live,
      state: { kind: 'publishing' as const, transport: 'rtmps' as const, sinceEpochMs: NOW },
      broadcast: srtOffered === null ? null : { ...live.broadcast, srtOffered },
    };
    return diagnosticsSections(rtmpsOnly, NOW, createTranslator('en'))[0];
  }

  it('A18 a broadcast with no SRT offered says so beside its transport', () => {
    expect(linkRows(false)?.rows[0]).toEqual({
      key: 'diag.transport',
      label: en['diag.transport'],
      value: 'RTMPS · SRT not offered',
    });
  });

  it('a fallback to RTMPS with SRT offered shows RTMPS alone', () => {
    expect(linkRows(true)?.rows[0]).toEqual({
      key: 'diag.transport',
      label: en['diag.transport'],
      value: 'RTMPS',
    });
  });

  // Question 2: no broadcast, no SRT line.
  it('says nothing of SRT with no broadcast', () => {
    expect(linkRows(null)?.rows[0]).toEqual({
      key: 'diag.transport',
      label: 'Transport',
      value: 'RTMPS',
    });
  });
});
