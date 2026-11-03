import { describe, expect, it } from 'vitest';
import { LANGS, type Lang } from '@/i18n/language';
import type { MessageKey } from '@/i18n/messages';
import { createTranslator } from '@/i18n/translate';
import { layout, space } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';
import { loadFont } from '../../../test/fontMetrics';
import { linesOf } from '../../../test/textFit';

// The app's Settings at 320 dp, the narrowest phone upright (the owner's "clean display instead of printing text",
// 2026-11-02): a row is its name at the left and its value or control at the right, a helper is ONE line, and a heading
// is one line of short caps. This adds the room up from the token declarations, the fonts the app ships and the four
// dictionaries, the way homeFit and settingsFit do; none of it is read from AppSettingsScreen. Whether real text stays
// inside these boxes on a phone is the device's.

const COLUMN = 320 - 2 * space.md;
/** A row's inner width: the column less the row's own horizontal padding. */
const ROW = COLUMN - 2 * space.md;
const CHEVRON_GAP = space.sm;

const geist = loadFont('geist-500');
const barlow700 = loadFont('barlow-condensed-700');
const barlow600 = loadFont('barlow-condensed-600');
const inGeist = (role: 'control' | 'controlInk' | 'controlSmall') => (text: string) =>
  geist.width(text, typeScale[role].fontSize);
const inCaps = (role: 'action' | 'actionSecondary', face: typeof barlow700) => (text: string) =>
  face.width(text.toUpperCase(), typeScale[role].fontSize) +
  typeScale[role].letterSpacing * text.length;
const chevron = inGeist('control')('›');
/** What a row spends beside its words: a gap and the chevron, or a gap and the switch's pill. */
const BESIDE_CHEVRON = CHEVRON_GAP + chevron;
const BESIDE_SWITCH = CHEVRON_GAP + layout.switchTrackW;

const text = (lang: Lang, key: MessageKey, values?: Record<string, string>): string => {
  const said = createTranslator(lang).t(key, values);
  // A key a dictionary lacks comes back as itself, which is short and "fits" every box: refuse it.
  if (said === key) throw new Error(`no dictionary entry ${key} in ${lang}`);
  return said;
};

let fits = 0;
/** One line in `width`: the rule of every label, value and helper on the screen. */
function oneLine(what: string, string: string, width: number, measure: (s: string) => number) {
  fits += 1;
  expect({ what, string, lines: linesOf(string, width, measure) }).toEqual({
    what,
    string,
    lines: 1,
  });
}

describe.each(LANGS)('the app’s Settings at 320 dp, in %s', (lang) => {
  it('the title is one line beside Back, and each section heading is one line', () => {
    // Back is a `touch` square, a gap of `space.md` after it (SubScreenHeader); no LIVE plate outside a mode.
    oneLine(
      'title',
      text(lang, 'settings.app.title'),
      COLUMN - layout.iconButton - space.md,
      inCaps('action', barlow700),
    );
    for (const key of ['settings.section.general', 'settings.section.stream'] as const)
      oneLine(key, text(lang, key), COLUMN, inCaps('actionSecondary', barlow600));
  });

  it('Language: its name and the chosen language’s own name are one line each, side by side', () => {
    const label = text(lang, 'settings.language.label');
    for (const chosen of LANGS) {
      const value = text(chosen, `language.${chosen}`);
      const room = ROW - inGeist('control')(value) - BESIDE_CHEVRON - CHEVRON_GAP;
      oneLine(`language label, ${chosen} chosen`, label, room, inGeist('controlInk'));
    }
  });

  it('Battery: its name and the mode’s word are one line each, and the helper under it is one line', () => {
    const label = text(lang, 'settings.battery.label');
    for (const mode of ['unrestricted', 'optimized', 'restricted'] as const) {
      const value = text(lang, `settings.power.${mode}`);
      // The helper is in the words column, which the value and the chevron narrow.
      const room = ROW - inGeist('control')(value) - BESIDE_CHEVRON - CHEVRON_GAP;
      oneLine(`battery label, ${mode}`, label, room, inGeist('controlInk'));
      // From Arming on, any mode says why the row is off; the path to Unrestricted shows only for the other two.
      oneLine(
        `on air, ${mode}`,
        text(lang, 'settings.battery.onAir'),
        room,
        inGeist('controlSmall'),
      );
      if (mode !== 'unrestricted')
        oneLine(`path, ${mode}`, text(lang, 'settings.power.path'), room, inGeist('controlSmall'));
    }
  });

  it('Share record and Send record: every state of their names is one line, and Send’s reasons are one line', () => {
    oneLine('share', text(lang, 'diag.share'), ROW - BESIDE_CHEVRON, inGeist('controlInk'));
    oneLine(
      'share failed',
      text(lang, 'diag.shareFailed'),
      ROW - BESIDE_CHEVRON,
      inGeist('controlInk'),
    );
    for (const key of [
      'record.send',
      'record.sending',
      'record.sendFailed',
      'record.cantSend',
    ] as const)
      oneLine(key, text(lang, key), ROW - BESIDE_CHEVRON, inGeist('controlInk'));
    // `ref` is the server's; the longest the contract allows is not read here, so a typical eight characters stand in.
    oneLine(
      'record.sent',
      text(lang, 'record.sent', { ref: 'R-2026-0417' }),
      ROW - BESIDE_CHEVRON,
      inGeist('controlInk'),
    );
    for (const key of [
      'record.onAir',
      'record.needsCode',
      'record.cant.ended',
      'record.cant.notFound',
      'record.cant.tooLarge',
      'record.cant.mismatch',
    ] as const)
      oneLine(key, text(lang, key), ROW - BESIDE_CHEVRON, inGeist('controlSmall'));
  });

  it('Automatic: its name fits on one line beside the switch', () => {
    oneLine(
      'automatic',
      text(lang, 'settings.automatic.row'),
      ROW - BESIDE_SWITCH,
      inGeist('controlInk'),
    );
  });

  it('Controls: its name fits on one line beside the pair, whose width is the segments’', () => {
    const segment = (key: 'settings.side.rowLeft' | 'settings.side.rowRight') =>
      Math.max(layout.segmentMin, inGeist('control')(text(lang, key)) + 2 * layout.segmentPadX);
    const pair =
      2 * layout.iconBorder + segment('settings.side.rowLeft') + segment('settings.side.rowRight');
    oneLine(
      'side label',
      text(lang, 'settings.side.row'),
      ROW - pair - CHEVRON_GAP,
      inGeist('controlInk'),
    );
  });

  it('the licences’ lines are one line each inside the open list', () => {
    const inner = COLUMN - 2 * space.md;
    oneLine(
      'licences label',
      text(lang, 'settings.licences.label'),
      ROW - BESIDE_CHEVRON,
      inGeist('controlInk'),
    );
    oneLine(
      'licence entry',
      text(lang, 'settings.licences.entry', { name: 'StreamPack', licence: 'Apache-2.0' }),
      inner,
      inGeist('controlSmall'),
    );
    // The source link MPL-2.0 asks for is one long word (a URL), so at 320 dp its line wraps before it; two lines at most.
    const source = text(lang, 'settings.licences.source', {
      url: 'https://github.com/Haivision/srt',
    });
    expect({ source, lines: linesOf(source, inner, inGeist('controlSmall')) }).toEqual({
      source,
      lines: 2,
    });
    fits += 1;
  });
});

describe('the sweep', () => {
  it('measured something in every language (anti-vacuity)', () => {
    expect(fits).toBeGreaterThan(LANGS.length * 20);
  });
  it('a row is as tall as the 48 dp target and a helper’s second line fits the 56 dp row', () => {
    expect(layout.settingsRow).toBeGreaterThanOrEqual(layout.touch);
    expect(
      2 * space.sm + typeScale.controlInk.lineHeight + 2 + typeScale.controlSmall.lineHeight,
    ).toBeLessThanOrEqual(layout.settingsRow);
  });
});
