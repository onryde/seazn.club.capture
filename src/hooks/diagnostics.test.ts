import { describe, expect, it } from 'vitest';
import type { CameraState, Telemetry } from '@/engine/CaptureEnginePort';
import { createFakeCaptureEngine, type FakeScene } from '@/engine/FakeCaptureEngine';
import { diagnosticsSections } from '@/hooks/diagnostics';
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
  const sections = diagnosticsSections(engine.getSnapshot(), NOW, createTranslator(lang).t);
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
    });
  });

  it('names its four sections', () => {
    const engine = createFakeCaptureEngine(() => NOW);
    const titles = diagnosticsSections(engine.getSnapshot(), NOW, createTranslator('en').t).map(
      (section) => section.title,
    );
    engine.dispose();
    expect(titles).toEqual(['Link', 'Delivery', 'Phone', 'Heartbeat']);
  });

  it('says what is unknown rather than inventing a number', () => {
    expect(rowsFor('fell-back')).toMatchObject({
      Transport: 'RTMPS',
      'Round trip': '—',
      Resent: '—',
      Dropped: '—',
    });
    expect(rowsFor('armed-ready')).toMatchObject({ Transport: '—', Bitrate: '—', Target: '—' });
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
  // Native reports no rate before air, so armed reads a dash: that is correct.
  it('sends no audio while armed, whatever the mic hears', () => {
    expect(rowsFor('armed-ready')).toMatchObject({ 'Sending audio': '—', Video: '—' });
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

  it('reads in French', () => {
    expect(rowsFor('live', {}, 'fr')).toMatchObject({
      Débit: '2840 kbps',
      Vidéo: '30 i/s',
      'Données utilisées': '312 Mo',
      'Dernier envoi': 'il y a 4 s',
      Batterie: '74 %',
      Chaleur: 'Normale',
    });
  });
});
