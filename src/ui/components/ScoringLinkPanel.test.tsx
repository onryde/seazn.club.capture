import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type * as SeaznQrDomain from '@/domain/qr/seaznQr';
import { seaznQrPlan } from '@/domain/qr/seaznQr';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import type { MessageKey } from '@/i18n/messages';
import { SCORING_WORDS, type ScoringWord } from '@/services/scoringLinkPort';
import type { ScoringLinkView } from '@/hooks/useScoringLink';
import { ScoringLinkPanel } from '@/ui/components/ScoringLinkPanel';
import { layout } from '@/ui/theme/tokens';
import { boardGround, boardInkEdge, boardInkText } from '../../../test/boardPaint';
import { pathDigest } from '../../../test/qrDigest';
import { FAKE_SCORING_SECRET, FAKE_SCORING_URL } from '../../../test/fakeScoringLinkPort';
import { renderWithPorts } from '../../../test/renderWithPorts';

// The plan is the real one; the spy only counts how often it is asked.
vi.mock('@/domain/qr/seaznQr', async (importOriginal) => {
  const actual = await importOriginal<typeof SeaznQrDomain>();
  return { ...actual, seaznQrPlan: vi.fn(actual.seaznQrPlan) };
});

const LANGS = ['en', 'es', 'fr', 'nl'] as const;
type Lang = (typeof LANGS)[number];
const DICTIONARIES: Readonly<Record<Lang, Readonly<Record<string, string>>>> = { en, es, fr, nl };

/** The copy, from the dictionaries and never typed here, with `{name}` filled. */
const say = (lang: Lang, key: MessageKey, vars: Readonly<Record<string, string | number>> = {}) =>
  (DICTIONARIES[lang][key] ?? '').replace(/\{(\w+)\}/g, (_whole, name: string) =>
    String(vars[name]),
  );

/** By literal and typed over every word: a new word is a compile error here too. */
const SENTENCE: Readonly<Record<ScoringWord, MessageKey>> = {
  code_ended: 'stream.scoring.refused.codeEnded',
  replaced: 'stream.scoring.refused.replaced',
  match_finished: 'stream.scoring.refused.matchFinished',
  not_entitled: 'stream.scoring.refused.notEntitled',
  rate_limited: 'stream.scoring.refused.rateLimited',
  unavailable: 'stream.scoring.refused.unavailable',
};

const HIDDEN: ScoringLinkView = { kind: 'hidden' };
const ASKING: ScoringLinkView = { kind: 'asking' };
const SHOWN: ScoringLinkView = { kind: 'shown', url: FAKE_SCORING_URL };
const refused = (word: ScoringWord, retryAfterS: number | null = null): ScoringLinkView => ({
  kind: 'refused',
  word,
  retryAfterS,
});

function panelFor(
  view: ScoringLinkView,
  {
    lang = 'en',
    secondsLeft = 10,
    onHide = vi.fn(),
  }: { lang?: Lang; secondsLeft?: number; onHide?: () => void } = {},
) {
  return renderWithPorts(
    <ScoringLinkPanel view={view} secondsLeft={secondsLeft} onHide={onHide} />,
    { deviceLanguages: [lang] },
  );
}

const panel = () => screen.getByTestId('scoring-panel');
const hideButton = (lang: Lang = 'en') =>
  screen.getByRole('button', { name: say(lang, 'stream.scoring.hide') });

let viewsChecked = 0;
let sentencesChecked = 0;

describe('ScoringLinkPanel (spec §10, Q-C2)', () => {
  it.each(LANGS)(
    '%s: hidden renders nothing; asking, shown and refused say what they are',
    (lang) => {
      // hidden
      const hidden = panelFor(HIDDEN, { lang });
      expect(screen.queryByTestId('scoring-panel')).toBeNull();
      hidden.unmount();
      viewsChecked += 1;

      // asking: the title, the sentence, Hide, and no code
      const asking = panelFor(ASKING, { lang });
      expect(within(panel()).getByText(say(lang, 'stream.scoring.title'))).toBeTruthy();
      expect(within(panel()).getByText(say(lang, 'stream.scoring.asking'))).toBeTruthy();
      expect(hideButton(lang)).toBeTruthy();
      expect(screen.queryByTestId('seazn-qr')).toBeNull();
      asking.unmount();
      viewsChecked += 1;

      // shown: the code (version 8, the label, the size), the hint, Hide, and the secret nowhere in the markup
      const shown = panelFor(SHOWN, { lang });
      const code = within(panel()).getByTestId('seazn-qr');
      expect(code.dataset.version).toBe('8');
      expect(code.dataset.size).toBe(String(layout.qrSize));
      expect(code.getAttribute('aria-label')).toBe(say(lang, 'stream.scoring.code'));
      expect(within(panel()).getByText(say(lang, 'stream.scoring.title'))).toBeTruthy();
      expect(within(panel()).getByText(say(lang, 'stream.scoring.hint'))).toBeTruthy();
      expect(hideButton(lang)).toBeTruthy();
      expect(shown.container.innerHTML).not.toContain(FAKE_SCORING_SECRET);
      shown.unmount();
      viewsChecked += 1;

      // refused: a sentence, Hide, and no code
      const no = panelFor(refused('replaced'), { lang });
      expect(within(panel()).getByText(say(lang, 'stream.scoring.refused.replaced'))).toBeTruthy();
      expect(screen.queryByTestId('seazn-qr')).toBeNull();
      expect(hideButton(lang)).toBeTruthy();
      no.unmount();
      viewsChecked += 1;
    },
  );

  it('checked four views in each of four languages (anti-vacuity)', () => {
    expect(LANGS).toHaveLength(4);
    expect(viewsChecked).toBe(16);
  });

  it.each(LANGS)(
    '%s: each of the six refusal words says its own sentence and draws no code',
    (lang) => {
      expect(SCORING_WORDS).toHaveLength(6);
      for (const word of SCORING_WORDS) {
        const retryAfterS = word === 'rate_limited' ? 30 : null;
        const view = panelFor(refused(word, retryAfterS), { lang });
        const expected =
          word === 'rate_limited'
            ? say(lang, 'stream.scoring.refused.rateLimited', { seconds: 30 })
            : say(lang, SENTENCE[word]);
        expect(within(panel()).getByText(expected), `${lang} ${word}`).toBeTruthy();
        expect(screen.queryByTestId('seazn-qr'), `${lang} ${word}`).toBeNull();
        expect(hideButton(lang)).toBeTruthy();
        view.unmount();
        sentencesChecked += 1;
      }
      // A rate limit with no number to say is the generic sentence: "Try again in 0 s" would be false.
      const bare = panelFor(refused('rate_limited', null), { lang });
      expect(
        within(panel()).getByText(say(lang, 'stream.scoring.refused.unavailable')),
      ).toBeTruthy();
      expect(
        within(panel()).queryByText(
          say(lang, 'stream.scoring.refused.rateLimited', { seconds: 0 }),
        ),
      ).toBeNull();
      bare.unmount();
      sentencesChecked += 1;
    },
  );

  it('checked six sentences and the bare rate limit in each of four languages (anti-vacuity)', () => {
    expect(sentencesChecked).toBe(4 * (6 + 1));
    // The English the rate limit is written in, pinned.
    expect(say('en', 'stream.scoring.refused.rateLimited', { seconds: 30 })).toBe(
      'Try again in 30 s',
    );
  });

  it('Hide calls onHide once, is a 48 dp button, and a second press is a second call', () => {
    const onHide = vi.fn();
    panelFor(SHOWN, { onHide });
    expect(layout.iconButton).toBe(48); // spec §3's target, written out
    const hide = hideButton();
    expect(hide.getAttribute('role')).toBe('button');
    expect(getComputedStyle(hide).minHeight).toBe('48px');
    fireEvent.click(hide);
    expect(onHide).toHaveBeenCalledTimes(1);
    fireEvent.click(hide);
    expect(onHide).toHaveBeenCalledTimes(2);
  });

  it('covers whatever it is a child of: absolute, 0 on every side (Q-C2)', () => {
    panelFor(ASKING);
    const style = getComputedStyle(panel());
    expect(style.position).toBe('absolute');
    expect([style.top, style.left, style.right, style.bottom]).toEqual([
      '0px',
      '0px',
      '0px',
      '0px',
    ]);
  });

  it('draws the title, then the code, then the hint, then the bottom row', () => {
    panelFor(SHOWN);
    const order = [
      within(panel()).getByText(en['stream.scoring.title']),
      within(panel()).getByTestId('seazn-qr'),
      within(panel()).getByText(en['stream.scoring.hint']),
      screen.getByTestId('scoring-bottom'),
    ];
    for (let at = 1; at < order.length; at += 1) {
      const before = order[at - 1] as Element;
      const after = order[at] as Element;
      expect(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    }
    expect(order).toHaveLength(4);
  });

  it('makes the plan once per url: a re-render, or a tick of the countdown, does not re-encode', () => {
    const plan = vi.mocked(seaznQrPlan);
    plan.mockClear();
    const view = panelFor(SHOWN, { secondsLeft: 10 });
    expect(plan).toHaveBeenCalledTimes(1);
    for (const secondsLeft of [10, 9, 8]) {
      view.rerender(
        <ScoringLinkPanel
          view={{ kind: 'shown', url: FAKE_SCORING_URL }}
          secondsLeft={secondsLeft}
          onHide={vi.fn()}
        />,
      );
    }
    expect(plan).toHaveBeenCalledTimes(1);
    // The positive pair: another link is another plan.
    const other = `https://stg.seazn.club/score/dl_${'Z'.repeat(43)}`;
    view.rerender(
      <ScoringLinkPanel view={{ kind: 'shown', url: other }} secondsLeft={7} onHide={vi.fn()} />,
    );
    expect(plan).toHaveBeenCalledTimes(2);
  });
});

describe('ScoringLinkPanel draws the code of the link it was handed', () => {
  it('the plan is made for the answered url, the drawn code is that plan’s, and the next answer is the next code', () => {
    // Two links of one length: the version and the module count match, only the painted path tells them apart.
    const other = `https://stg.seazn.club/score/dl_${'Z'.repeat(43)}`;
    expect(other).toHaveLength(FAKE_SCORING_URL.length);
    // The expected codes come from the real encoder, before the spy is looked at.
    const wantFirst = pathDigest(seaznQrPlan(FAKE_SCORING_URL).path);
    const wantNext = pathDigest(seaznQrPlan(other).path);
    expect(wantNext).not.toBe(wantFirst);

    const plan = vi.mocked(seaznQrPlan);
    plan.mockClear();
    const view = panelFor(SHOWN);
    expect(plan).toHaveBeenLastCalledWith(FAKE_SCORING_URL);
    expect(within(panel()).getByTestId('seazn-qr').dataset.digest).toBe(wantFirst);

    view.rerender(
      <ScoringLinkPanel view={{ kind: 'shown', url: other }} secondsLeft={9} onHide={vi.fn()} />,
    );
    expect(plan).toHaveBeenLastCalledWith(other);
    expect(within(panel()).getByTestId('seazn-qr').dataset.digest).toBe(wantNext);
    expect(view.container.innerHTML).not.toContain(other); // drawn, never written
  });
});

describe('ScoringLinkPanel’s title is the board’s (R8b)', () => {
  it('Barlow Condensed 700 at 22/24, uppercase, left-aligned, across the panel’s width, in the ink', () => {
    panelFor(SHOWN);
    const title = getComputedStyle(within(panel()).getByText(en['stream.scoring.title']));
    expect(title.fontFamily).toContain('BarlowCondensed_700Bold');
    expect(title.fontSize).toBe('22px');
    expect(title.lineHeight).toBe('24px');
    expect(title.textTransform).toBe('uppercase');
    expect(title.textAlign).toBe('left');
    expect(title.alignSelf).toBe('stretch');
    expect(title.color).toBe(boardInkText());
  });
});

// B3 (owner-approved board ruling): a countdown bar and "Hides in {n} s", in the bottom row beside Hide.
describe('ScoringLinkPanel’s countdown (B3)', () => {
  it.each([10, 7, 1])(
    '%i s left: the text says so, in all four languages, and the bar is %i0% full',
    (left) => {
      let said = 0;
      for (const lang of LANGS) {
        const view = panelFor(SHOWN, { lang, secondsLeft: left });
        const text = screen.getByTestId('scoring-countdown');
        expect(text.textContent, lang).toBe(say(lang, 'stream.scoring.hidesIn', { seconds: left }));
        expect(text.textContent, lang).toContain(String(left));
        expect(getComputedStyle(screen.getByTestId('scoring-bar-fill')).width, lang).toBe(
          `${left * 10}%`,
        );
        view.unmount();
        said += 1;
      }
      expect(said).toBe(4);
    },
  );

  it('the bar tracks the remaining time: wider with more left, by one tenth a second', () => {
    const widths: number[] = [];
    for (let left = 10; left >= 1; left -= 1) {
      const view = panelFor(SHOWN, { secondsLeft: left });
      widths.push(parseFloat(getComputedStyle(screen.getByTestId('scoring-bar-fill')).width));
      view.unmount();
    }
    // The board: the fill is remaining / 10 of the track.
    expect(widths).toEqual([100, 90, 80, 70, 60, 50, 40, 30, 20, 10]);
  });

  it('draws only a bar the board has: a count outside 1 to 10 is held to its ends, a fraction rounds', () => {
    // [what the panel is handed, the width of the fill]
    const ROWS = [
      [0, '10%'],
      [-3, '10%'],
      [14, '100%'],
      [3.6, '40%'],
      [3.4, '30%'],
    ] as const;
    let drawn = 0;
    for (const [secondsLeft, width] of ROWS) {
      const view = panelFor(SHOWN, { secondsLeft });
      expect(getComputedStyle(screen.getByTestId('scoring-bar-fill')).width, `${secondsLeft}`).toBe(
        width,
      );
      view.unmount();
      drawn += 1;
    }
    expect(drawn).toBe(5);
  });

  it('is shown for a refusal too (it hides itself the same way), and not while asking or hidden', () => {
    const refusal = panelFor(refused('replaced'), { secondsLeft: 4 });
    expect(screen.getByTestId('scoring-countdown').textContent).toBe(
      say('en', 'stream.scoring.hidesIn', { seconds: 4 }),
    );
    refusal.unmount();
    const asking = panelFor(ASKING);
    expect(screen.queryByTestId('scoring-countdown')).toBeNull();
    expect(screen.queryByTestId('scoring-bar')).toBeNull();
    // Hide is still there, with nothing to count.
    expect(hideButton()).toBeTruthy();
    asking.unmount();
    const hidden = panelFor(HIDDEN);
    expect(screen.queryByTestId('scoring-countdown')).toBeNull();
    hidden.unmount();
  });

  it('is one row: the bar, then "Hides in", then Hide, and the track is 6 dp', () => {
    panelFor(SHOWN);
    const row = screen.getByTestId('scoring-bottom');
    expect(getComputedStyle(row).flexDirection).toBe('row');
    const parts = [
      screen.getByTestId('scoring-bar'),
      screen.getByTestId('scoring-countdown'),
      hideButton(),
    ];
    for (const part of parts) expect(row.contains(part)).toBe(true);
    for (let at = 1; at < parts.length; at += 1) {
      const before = parts[at - 1] as Element;
      const after = parts[at] as Element;
      expect(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    }
    expect(layout.scoringBar).toBe(6); // the board's number, written out
    expect(getComputedStyle(screen.getByTestId('scoring-bar')).height).toBe('6px');
    expect(getComputedStyle(hideButton()).minHeight).toBe('48px');
  });
});

// B4 (owner-approved board ruling): a cream panel with ink text. The colours are the board's own, typed in
// test/boardPaint.ts, never read from the theme.
describe('ScoringLinkPanel’s colours (B4)', () => {
  it('is the board’s cream, and every word on it is the board’s ink', () => {
    expect(boardGround()).not.toBe(boardInkText()); // anti-vacuity: two different colours
    panelFor(SHOWN);
    expect(getComputedStyle(panel()).backgroundColor).toBe(boardGround());
    const words = [
      within(panel()).getByText(en['stream.scoring.title']),
      within(panel()).getByText(en['stream.scoring.hint']),
      screen.getByTestId('scoring-countdown'),
      within(hideButton()).getByText(en['stream.scoring.hide']),
    ];
    for (const word of words) {
      expect(getComputedStyle(word).color, word.textContent ?? '').toBe(boardInkText());
    }
    expect(words).toHaveLength(4);
    expect(getComputedStyle(hideButton()).borderTopColor).toBe(boardInkEdge());
  });

  it('the asking and the refused sentences are ink on the cream too', () => {
    let sentences = 0;
    for (const view of [ASKING, refused('replaced'), refused('rate_limited', 30)]) {
      const rendered = panelFor(view);
      const sentence = within(panel()).getByText(
        view.kind === 'asking'
          ? en['stream.scoring.asking']
          : view.kind === 'refused' && view.word === 'replaced'
            ? en['stream.scoring.refused.replaced']
            : say('en', 'stream.scoring.refused.rateLimited', { seconds: 30 }),
      );
      expect(getComputedStyle(sentence).color).toBe(boardInkText());
      rendered.unmount();
      sentences += 1;
    }
    expect(sentences).toBe(3);
  });
});
