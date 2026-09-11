import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings } from '@/domain/settings/Settings';

describe('parseSettings', () => {
  it('round-trips a valid stored object', () => {
    expect(parseSettings({ scorePreview: false, controlSide: 'left' })).toEqual({
      scorePreview: false,
      controlSide: 'left',
    });
  });

  // An unreadable preference must never stop an operator reaching the
  // viewfinder, so every bad shape resolves to a usable default.
  it.each([[null], [undefined], ['a string'], [42], [[]], [{}]])(
    'falls back to defaults for %o',
    (input) => {
      expect(parseSettings(input)).toEqual(DEFAULT_SETTINGS);
    },
  );

  it('keeps valid fields when a sibling is corrupt', () => {
    expect(parseSettings({ scorePreview: false, controlSide: 'sideways' })).toEqual({
      scorePreview: false,
      controlSide: DEFAULT_SETTINGS.controlSide,
    });
  });

  it('ignores unknown fields written by a future build', () => {
    expect(parseSettings({ scorePreview: true, controlSide: 'right', bitrate: 9000 })).toEqual(
      DEFAULT_SETTINGS,
    );
  });
});
