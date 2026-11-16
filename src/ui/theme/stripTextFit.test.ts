import { describe, expect, it } from 'vitest';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { advanceOf, cutNextLabel } from '@/domain/session/nextLine';
import { font, layout } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';
import { loadFont } from '../../../test/fontMetrics';

// Owner, 2026-10-08, "one single line all the time": under the label the strip has ONE message line, the advisory
// caption when one is up and the status line otherwise, and a line that is wider than the strip's text is cut with an
// ellipsis (`numberOfLines` 1), never wrapped. So the copy is MEASURED, in every language, at the strip's text width on
// the screens the strip is tightest on, and the strings that do not fit are written down here, as a ratchet: a new
// long string reds this file, and a shortened one reds it too, so the list the owner was shown is the list that ships.
//
// The widths come from the font files the app ships (test/fontMetrics.ts) at the size each type role declares, never
// from the strings being judged. The sum of advances ignores kerning, which only tightens a proportional line, so a
// width here is an UPPER bound: the Chromium measure of the same strings on 2026-10-08 found 48 of the 57 below really
// wider than 298 (8 en, 13 es, 14 fr, 13 nl), and the other 9 within a few dp of it. The list is what MAY be cut.
//
// The strip's text is the camera half less the strip's padding either side. The camera half is the window less the
// controls half (`layout.controlsHalf`).
const textWidth = (window: number) => window - layout.controlsHalf - 2 * layout.stripPadH;
const NARROW = textWidth(640); // spec §1's smallest, 640 × 360
const AT_804 = textWidth(804); // 804 × 332 and 804 × 360, the geometry of the owner's ruling of 2026-10-08
const PHONE = textWidth(728); // the owner's phone as laid out, 728 × 328 (N35: ShellFrame's insets)

const LANGUAGES: readonly (readonly [lang: string, dictionary: Record<string, string>])[] = [
  ['en', en],
  ['es', es],
  ['fr', fr],
  ['nl', nl],
];

/** A destination as the status line prints it: cut to 24 characters, the last an ellipsis (`cutDestination`). */
const DESTINATIONS = {
  fixture: 'YouTube · A Very Long C…', // FAKE_PAIRING's long destination, as the viewfinder tests cut it
  x24: `${'X'.repeat(23)}…`, // 24 of a wide capital
  w24: `${'W'.repeat(23)}…`, // 24 of the widest capital, the worst a destination can be
} as const;

/** The Next line's fills (court stream §6.2): a realistic label as the line cuts it, and a time with its zone. */
const NEXT_LABEL = cutNextLabel('Example Town v Sample Cricket Club'); // "Example Town v Sample Crick…"
const NEXT_TIME = '14:32 CEST';

const geist400 = loadFont('geist-400');
const geist500 = loadFont('geist-500');
/** The widest digit the status font has, so `{remaining}` and `{window}` (up to three digits) are the worst. */
const WIDEST_DIGIT = [...'0123456789'].sort(
  (a, b) => geist400.advance(b.charCodeAt(0)) - geist400.advance(a.charCodeAt(0)),
)[0] as string;

type Row = {
  readonly lang: string;
  readonly key: string;
  readonly kind: 'status' | 'caption';
  readonly destination: string;
  readonly text: string;
  readonly width: number;
};

/** The status line's strings (`stream.status.*`, and Back's refusal over a calm line), every caption, every language. */
const ROWS: readonly Row[] = LANGUAGES.flatMap(([lang, dictionary]) =>
  Object.keys(dictionary).flatMap((key): Row[] => {
    const kind =
      key.startsWith('stream.status.') || key === 'stream.leaveOnAir'
        ? 'status'
        : key.startsWith('stream.advisory.')
          ? 'caption'
          : null;
    if (kind === null) return [];
    const template = dictionary[key] as string;
    const variants = template.includes('{destination}')
      ? Object.entries(DESTINATIONS)
      : ([['-', '']] as const);
    return variants.map(([destination, cut]) => {
      const text = template
        .replaceAll('{remaining}', WIDEST_DIGIT.repeat(3))
        .replaceAll('{window}', WIDEST_DIGIT.repeat(3))
        .replaceAll('{destination}', cut)
        .replaceAll('{label}', NEXT_LABEL)
        .replaceAll('{time}', NEXT_TIME);
      const width =
        kind === 'status'
          ? geist400.width(text, typeScale.body.fontSize)
          : geist500.width(text, typeScale.metricUnit.fontSize);
      return { lang, key, kind, destination, text, width };
    });
  }),
);

/** The realistic rows: no destination at all, or the long one the viewfinder tests use (cut to 24). */
const REALISTIC = ROWS.filter((row) => row.destination === '-' || row.destination === 'fixture');
const name = (row: Row) => `${row.lang} ${row.key}`;

// What may be cut at 298 dp (640 × 360), by language: the ratchet.
const OVER_NARROW: Readonly<Record<string, readonly string[]>> = {
  en: [
    'stream.advisory.keepOpen',
    'stream.status.cameraTaken',
    'stream.status.courtNextAt',
    'stream.status.holdingNotDelivered',
    'stream.status.notReadyHeld',
    'stream.status.stoppedBySeazn',
    'stream.status.stoppedHoldWindow',
    'stream.status.stoppedNoSignal',
    'stream.status.waitingDestination',
    'stream.status.waitingGoLive',
  ],
  es: [
    'stream.advisory.keepOpen',
    'stream.leaveOnAir',
    'stream.status.cameraTaken',
    'stream.status.courtNextAt',
    'stream.status.holdingNotDelivered',
    'stream.status.holdingStalled',
    'stream.status.notReadyCamera',
    'stream.status.notReadyHeld',
    'stream.status.notReadySound',
    'stream.status.refusedUnknown',
    'stream.status.startRetrying',
    'stream.status.stoppedBySeazn',
    'stream.status.stoppedHoldWindow',
    'stream.status.stoppedNoSignal',
    'stream.status.stoppedOrganiser',
    'stream.status.waitingDestination',
    'stream.status.waitingGoLive',
  ],
  fr: [
    'stream.advisory.keepOpen',
    'stream.leaveOnAir',
    'stream.status.cameraReopening',
    'stream.status.cameraTaken',
    'stream.status.courtNextAt',
    'stream.status.engineSilent',
    'stream.status.goingLiveOrganiser',
    'stream.status.holdingNotDelivered',
    'stream.status.notReadyHeld',
    'stream.status.refusedUnknown',
    'stream.status.startRetrying',
    'stream.status.stoppedBySeazn',
    'stream.status.stoppedHoldWindow',
    'stream.status.stoppedNoSignal',
    'stream.status.stoppedOrganiser',
    'stream.status.stoppedPhoneLost',
    'stream.status.waitingGoLive',
  ],
  nl: [
    'stream.advisory.keepOpen',
    'stream.advisory.notCharging',
    'stream.leaveOnAir',
    'stream.status.cameraTaken',
    'stream.status.courtNextAt',
    'stream.status.engineSilent',
    'stream.status.fellBack',
    'stream.status.holdingNotDelivered',
    'stream.status.refusedDestination',
    'stream.status.refusedEntitlement',
    'stream.status.startFailed',
    'stream.status.startRetrying',
    'stream.status.stoppedBySeazn',
    'stream.status.stoppedPhoneLost',
    'stream.status.waitingDestination',
    'stream.status.waitingGoLive',
  ],
};

describe('the strip’s one message line, measured in every language (owner, 2026-10-08)', () => {
  it('is set in the roles it declares: the status line Geist 400 at 15, the caption Geist 500 at 12', () => {
    expect(typeScale.body.fontFamily).toBe(font.body);
    expect(font.body).toBe('Geist_400Regular');
    expect(typeScale.body.fontSize).toBe(15);
    expect(typeScale.metricUnit.fontFamily).toBe(font.bodyMedium);
    expect(font.bodyMedium).toBe('Geist_500Medium');
    expect(typeScale.metricUnit.fontSize).toBe(12);
  });

  it('has a text width of 298 dp at 640 × 360, 386 at 728 wide and 462 at 804 wide: the half less 2 × 16', () => {
    expect(layout.controlsHalf).toBe(310);
    expect(layout.stripPadH).toBe(16);
    expect(NARROW).toBe(298);
    expect(PHONE).toBe(386);
    expect(AT_804).toBe(462);
  });

  it('measures 47 status strings and 5 captions in each of the four languages, and every glyph is in the font', () => {
    // Anti-vacuity: the table is the whole copy, not a sample. 46 `stream.status.*` keys and Back's refusal; the
    // captions are keep the app open, not charging, and heat's three (the spec's, which names What viewers see, and
    // "Phone hot · still live" and "Phone hot" with the view hidden: the owner's ruling, 2026-10-09).
    for (const [lang] of LANGUAGES) {
      const rows = REALISTIC.filter((row) => row.lang === lang);
      expect(
        rows.filter((row) => row.kind === 'status'),
        lang,
      ).toHaveLength(47);
      expect(
        rows.filter((row) => row.kind === 'caption'),
        lang,
      ).toHaveLength(5);
    }
    expect(REALISTIC).toHaveLength(4 * 52);
    // The destination variants add two rows to the waiting line in each language.
    expect(ROWS).toHaveLength(4 * 52 + 4 * 2);
    // A code point the font lacks is measured as its .notdef: the width would be wrong. None is missing.
    const missing = new Set<string>();
    for (const row of ROWS) {
      const face = row.kind === 'status' ? geist400 : geist500;
      for (const char of row.text) if (!face.has(char.codePointAt(0) as number)) missing.add(char);
    }
    expect([...missing]).toEqual([]);
    // No placeholder is left in a measured string.
    expect(ROWS.filter((row) => /[{}]/.test(row.text))).toEqual([]);
  });

  it('fits ONE line at 462 dp (804 × 332, 804 × 360), every language, with any destination but a row of the widest capital', () => {
    const over = REALISTIC.filter((row) => row.width > AT_804);
    expect(over.map(name)).toEqual([]);
    // 24 characters of the widest capital in the destination is the pathological case: the waiting line, in each
    // language, would be cut (an ellipsis at the end of the destination, the owner's rule).
    const x24 = ROWS.filter((row) => row.destination === 'x24' && row.width > AT_804);
    expect(x24.map(name)).toEqual([]);
    const w24 = ROWS.filter((row) => row.destination === 'w24' && row.width > AT_804);
    expect(w24.map(name)).toEqual([
      'en stream.status.waitingGoLive',
      'es stream.status.waitingGoLive',
      'fr stream.status.waitingGoLive',
      'nl stream.status.waitingGoLive',
    ]);
  });

  // N35: the owner's phone lays the strip out 418 - 32 = 386 wide, not 462. The widest realistic line is the Dutch
  // waiting-for-a-destination one, and nothing realistic is cut there either.
  it('fits ONE line at 386 dp (728 × 328, the owner’s phone as laid out), every language, with any destination but a row of the widest capital', () => {
    const over = REALISTIC.filter((row) => row.width > PHONE);
    expect(over.map(name)).toEqual([]);
    const x24 = ROWS.filter((row) => row.destination === 'x24' && row.width > PHONE);
    expect(x24.map(name)).toEqual([]);
    const w24 = ROWS.filter((row) => row.destination === 'w24' && row.width > PHONE);
    expect(w24.map(name)).toEqual([
      'en stream.status.waitingGoLive',
      'es stream.status.waitingGoLive',
      'fr stream.status.waitingGoLive',
      'nl stream.status.waitingGoLive',
    ]);
  });

  it('does not fit one line at 298 dp (640 × 360) for exactly the strings pinned, which are cut with an ellipsis', () => {
    const over = REALISTIC.filter((row) => row.width > NARROW);
    const byLanguage: Record<string, string[]> = { en: [], es: [], fr: [], nl: [] };
    for (const row of over) byLanguage[row.lang]?.push(row.key);
    for (const keys of Object.values(byLanguage)) keys.sort();
    expect(byLanguage).toEqual(OVER_NARROW);
    // 60 strings: 10 en, 17 es, 17 fr, 16 nl (court stream added the Next line with its time, one per language).
    expect(over).toHaveLength(60);
    expect(Object.values(OVER_NARROW).map((keys) => keys.length)).toEqual([10, 17, 17, 16]);
  });

  it('has strings on BOTH sides of 298 dp, so the line above can neither be everything nor nothing (anti-vacuity)', () => {
    const fits = REALISTIC.filter((row) => row.width <= NARROW);
    expect(fits.length).toBeGreaterThan(0);
    expect(REALISTIC.length - fits.length).toBeGreaterThan(0);
    // The captions: the widest is the Dutch keep-the-app-open, past 298 and well inside 462.
    const widest = (kind: Row['kind']) =>
      REALISTIC.filter((row) => row.kind === kind).reduce((a, b) => (b.width > a.width ? b : a));
    expect(name(widest('caption'))).toBe('nl stream.advisory.keepOpen');
    expect(name(widest('status'))).toBe('nl stream.status.courtNextAt');
    expect(widest('caption').width).toBeGreaterThan(NARROW);
    expect(widest('caption').width).toBeLessThan(AT_804);
    expect(widest('status').width).toBeGreaterThan(NARROW);
    expect(widest('status').width).toBeLessThan(AT_804);
    // N35: both are inside the owner's phone's 386 too.
    expect(widest('caption').width).toBeLessThan(PHONE);
    expect(widest('status').width).toBeLessThan(PHONE);
  });

  // Court stream (spec 2026-11-14 §6.2): what a court phone says while it waits is ONE line at the owner's phone's 386 dp, in
  // all four languages, the time visible (I4): the label is cut by how wide it draws (`cutNextLabel`), so the time is
  // never the part an ellipsis eats.
  it('fits the court waiting lines on ONE line at 386 dp in all four languages, the time visible', () => {
    const KEYS = [
      'stream.status.courtNextAt',
      'stream.status.courtNext',
      'stream.status.courtNone',
      'stream.status.courtAutomaticOff',
    ];
    const rows = REALISTIC.filter((row) => KEYS.includes(row.key));
    expect(rows).toHaveLength(16);
    expect(NEXT_LABEL).toBe('Example Town v Sample Crick…');
    expect(
      rows.filter(
        (row) => row.key === 'stream.status.courtNextAt' && !row.text.endsWith(NEXT_TIME),
      ),
    ).toEqual([]);
    expect(rows.filter((row) => row.width > PHONE).map(name)).toEqual([]);
  });

  // P3 review m2: the label's CHARACTER count is not its width, and organisers type team names in capitals. Every label
  // below, as the line cuts it, leaves the whole line (with the widest time and zone) inside 386 dp in every language:
  // realistic ones in capitals and not, then the worst a label can be of each kind of glyph.
  describe('the Next line keeps its time at 386 dp whatever the label is', () => {
    const lineWidth = (dictionary: Record<string, string>, label: string, key: string) =>
      geist400.width(
        (dictionary[key] as string)
          .replaceAll('{label}', cutNextLabel(label))
          .replaceAll('{time}', NEXT_TIME),
        typeScale.body.fontSize,
      );
    const REAL_LABELS = [
      'WOLVERHAMPTON WANDERERS',
      'MANCHESTER UNITED FC U12',
      'EXAMPLE TOWN V SAMPLE CRICKET CLUB',
      'Wolverhampton Wanderers',
      'Atlético Madrid v Málaga CF',
      'Example Town v Sample Cricket Club',
      'Centre Court, Show Arena',
    ];
    // The worst of each class: the widest capital, the widest lower-case, the widest digit, a symbol, a wide ligature,
    // a glyph the font lacks, and a mix of the widest of each.
    const WORST_LABELS = [
      'W'.repeat(60),
      'm'.repeat(60),
      '0'.repeat(60),
      '@'.repeat(60),
      'Œ'.repeat(60),
      '字'.repeat(60),
      'WmW@mW0WmW@mW0WmW@mW0WmW@mW0',
    ];

    it.each(LANGUAGES)(
      '%s: every label leaves the time on the line, with and without a time',
      (_lang, dictionary) => {
        for (const label of [...REAL_LABELS, ...WORST_LABELS])
          for (const key of ['stream.status.courtNextAt', 'stream.status.courtNext']) {
            const width = lineWidth(dictionary, label, key);
            expect({ label, key, fits: width <= PHONE }).toEqual({ label, key, fits: true });
          }
      },
    );

    // Anti-vacuity: the cut is what saves it, a 24-character count would not (24 of the widest capital is 340 dp
    // of label), and a realistic capitals label is cut only where the line would otherwise not fit.
    it('is the cut that fits it: uncut, a row of 24 capitals is wider than the line in every language', () => {
      for (const [lang, dictionary] of LANGUAGES) {
        const uncut = (dictionary['stream.status.courtNextAt'] as string)
          .replaceAll('{label}', 'W'.repeat(24))
          .replaceAll('{time}', NEXT_TIME);
        expect(geist400.width(uncut, typeScale.body.fontSize) > PHONE, lang).toBe(true);
        expect(cutNextLabel('W'.repeat(24)), lang).not.toBe('W'.repeat(24));
      }
    });

    it('does not cut a label that fits: 24 characters of mixed case and of capitals with room, in the tightest language', () => {
      for (const label of [
        'Example Town v Sample CC',
        'MANCHESTER UNITED FC U12',
        'Centre Court, Show Arena',
      ])
        expect(cutNextLabel(label)).toBe(label);
    });

    // The advances written in nextLine.ts are an upper bound of the font file's, glyph by glyph over U+0020 to U+017F
    // (the Latin letters, digits and punctuation a team's name has), so the sums above bound the real line.
    it('has an advance for every glyph of U+0020 to U+017F no smaller than the font’s own', () => {
      const size = typeScale.body.fontSize;
      const short: string[] = [];
      let checked = 0;
      for (let code = 0x20; code <= 0x17f; code += 1) {
        if (code >= 0x7f && code < 0xa0) continue;
        const letter = String.fromCodePoint(code);
        checked += 1;
        if ((geist400.width(letter, size) / size) * 1000 > advanceOf(letter))
          short.push(`${letter} U+${code.toString(16)}`);
      }
      expect(short).toEqual([]);
      expect(checked).toBe(319);
    });
  });

  // The heat caption with What viewers see hidden (the owner's ruling, 2026-10-09): both wordings are ONE line at 298 dp
  // in every language, with room to spare, so neither is ever cut. fr keeps "toujours" here: the spec's caption, which
  // names the view, has no room for it (docs/i18n-glossary.md, "still live").
  it('fits the hidden view’s heat captions, "Phone hot · still live" and "Phone hot", at 298 dp in all four languages', () => {
    const widths = (key: string) =>
      LANGUAGES.map(
        ([, dictionary]) =>
          Math.round(geist500.width(dictionary[key] ?? '', typeScale.metricUnit.fontSize) * 10) /
          10,
      );
    const live = widths('stream.advisory.hotLive');
    const before = widths('stream.advisory.hot');
    expect(live).toEqual([110.6, 179.4, 206.9, 194.6]);
    expect(before).toEqual([58.0, 79.7, 97.3, 99.9]);
    for (const width of [...live, ...before]) expect(width).toBeLessThan(NARROW);
  });

  // The ellipsis case: the line is a body line of ONE row. A string wider than the text must not become a second row,
  // which is what the strip's reserve (one message line) cannot hold. Rendered in Hud.test.tsx; here, that the layout's
  // line count is the one the arithmetic above assumes.
  it('assumes exactly one line, the number the strip reserves', () => {
    expect(layout.messageLines).toBe(1);
  });
});
