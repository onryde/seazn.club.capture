import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, onTestFinished } from 'vitest';
import { FAKE_SCENES } from '@/engine/FakeCaptureEngine';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import type { Lang } from '@/i18n/language';
import nl from '@/i18n/nl.json';
import type { KeyValueStore } from '@/services/KeyValueStore';
import { SettingsScreen } from '@/ui/screens/SettingsScreen';
import { renderViewfinder } from '../../../test/renderViewfinder';

const LANGS = ['en', 'es', 'fr', 'nl'] as const;
const DICTIONARIES: Readonly<Record<Lang, Readonly<Record<string, string>>>> = { en, es, fr, nl };
/**
 * What the screen shows for a key, read from the dictionaries, never through
 * `t()` (AGENTS §10): the language's copy, else English, else the key itself,
 * the fallback the translator documents. So a key missing everywhere anchors
 * on its own raw text, and it is the raw-key read that fails, not the anchor.
 */
const shown = (lang: Lang, key: string) => DICTIONARIES[lang][key] ?? DICTIONARIES.en[key] ?? key;
/** What `t()` prints for a key no dictionary has. */
const RAW_KEY = /\b(stream|settings|diag|home|mode)\.[a-z]+[A-Za-z.]*\b/;

/**
 * Every string on screen, one by one, and every accessibility label (what
 * TalkBack reads). One by one, because `textContent` glues neighbours together
 * ("Diagnosticsstream.tally.live") and the pattern's `\b` then never fires.
 * Nothing is left out: spec §6 dropped the session record's lines from the
 * screen (they were event names, not copy, and some matched the pattern by
 * design), so the Diagnostics card is swept whole.
 */
function visibleCopy(): string[] {
  const body = document.body.cloneNode(true) as HTMLElement;
  const copy: string[] = [];
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    copy.push(node.textContent ?? '');
  }
  for (const labelled of body.querySelectorAll('[aria-label]')) {
    copy.push(labelled.getAttribute('aria-label') ?? '');
  }
  return copy;
}

const rawKeys = () => visibleCopy().filter((copy) => RAW_KEY.test(copy));

/**
 * Review M2: states the operator reaches by hand, not by an engine scene. Each
 * proves it was reached, by its own copy from the dictionary or by a role's
 * state, before the sweep reads the screen: a rename that hides the state
 * itself would otherwise pass. (Spec §5 took "ended, never live" out: the Ended block is gone from the viewfinder,
 * and the card that says it, in every language, is swept by HomeScreen.ended.test.tsx.)
 */
const SUB_STATES: Readonly<Record<string, (lang: Lang) => Promise<void>>> = {
  'Back on air': async (lang) => {
    const view = await renderViewfinder({ deviceLanguages: [lang] });
    act(() => view.engine.scene('live'));
    act(() => void view.back.press());
    expect(visibleCopy()).toContain(shown(lang, 'stream.leaveOnAir'));
  },
  'licences open': async (lang) => {
    const view = await renderViewfinder({ deviceLanguages: [lang] });
    view.rerender(<SettingsScreen />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByRole('button', { expanded: true })).toBeTruthy();
  },
  'a save refused': async (lang) => {
    const view = await renderViewfinder({ deviceLanguages: [lang] });
    view.rerender(<SettingsScreen />);
    const refusing: Partial<KeyValueStore> = { set: () => Promise.reject(new Error('locked')) };
    Object.assign(view.kv, refusing);
    // Two switches since Task 30: the score preview's is the one pressed.
    fireEvent.click(screen.getByRole('switch', { name: shown(lang, 'settings.overlay.label') }));
    expect(await screen.findByText(shown(lang, 'settings.saveFailed'))).toBeTruthy();
  },
  'a share refused': async (lang) => {
    const view = await renderViewfinder({ deviceLanguages: [lang] });
    view.rerender(<SettingsScreen />);
    view.share.refuse();
    fireEvent.click(screen.getByRole('button', { name: shown(lang, 'diag.share') }));
    expect(await screen.findByText(shown(lang, 'diag.shareFailed'))).toBeTruthy();
  },
  // Amendment §2: a visit never pairs, so an engine found idle stays Starting.
  'an idle engine': async (lang) => {
    await renderViewfinder({ deviceLanguages: [lang] }, { engine: 'idle' });
    expect(visibleCopy()).toContain(shown(lang, 'stream.status.starting'));
  },
  // No broadcast reported on air: forced on an engine that holds no pairing.
  'on air with no viewer picture': async (lang) => {
    await renderViewfinder(
      { deviceLanguages: [lang] },
      {
        engine: 'idle',
        prepare: (fakes) =>
          fakes.engine.forceState({ kind: 'publishing', transport: 'srt', sinceEpochMs: 1 }),
      },
    );
    expect(visibleCopy()).toContain(shown(lang, 'stream.peek.unavailable'));
  },
};

const SCENE_CASES = LANGS.flatMap((lang) => FAKE_SCENES.map((scene) => [lang, scene] as const));
const SUB_STATE_CASES = LANGS.flatMap((lang) =>
  Object.keys(SUB_STATES).map((name) => [lang, name] as const),
);

/**
 * Task 28, question 4: the paired waiting line and the armed held line in each
 * language, the destination filled at its 24-character cap. The expected text
 * is each dictionary's own, with the cut name written out by hand (PV29).
 */
describe('the paired and starting lines read in every language', () => {
  const LONG = 'YouTube · A Very Long Club Name CC';
  const CUT = 'YouTube · A Very Long C…';

  it.each(['es', 'fr', 'nl'] as const)(
    '%s says its waiting line with the destination cut',
    async (lang) => {
      const view = await renderViewfinder(
        { deviceLanguages: [lang] },
        { overlay: false, quiet: true },
      );
      act(() => view.engine.setPairing({ destinationName: LONG }));
      act(() => view.engine.scene('paired-ready'));
      const said = DICTIONARIES[lang]['stream.status.waitingGoLive']?.replace('{destination}', CUT);
      expect(said).toBeDefined();
      expect(visibleCopy()).toContain(said);
    },
  );

  it.each(['es', 'fr', 'nl'] as const)('%s says its held line while Armed', async (lang) => {
    const view = await renderViewfinder({ deviceLanguages: [lang] });
    act(() => view.engine.scene('armed-not-ready'));
    expect(visibleCopy()).toContain(DICTIONARIES[lang]['stream.status.notReadyHeld']);
  });
});

describe('no screen in any state shows a raw key (AGENTS §10, question 4)', () => {
  // Review M3: an empty table registers no case and passes. Update the counts
  // when a scene or a sub-state is added: 4 languages × 23 scenes, × 6 sub-states.
  it('sweeps every scene and every sub-state, in every language', () => {
    expect(SCENE_CASES).toHaveLength(92);
    expect(SUB_STATE_CASES).toHaveLength(24);
  });

  it.each(SUB_STATE_CASES)('%s, %s', async (lang, name) => {
    await SUB_STATES[name]?.(lang);
    expect(rawKeys()).toEqual([]);
  });

  it.each(SCENE_CASES)('%s, %s', async (lang, scene) => {
    const view = await renderViewfinder({ deviceLanguages: [lang] });
    act(() => view.engine.scene(scene));
    expect(rawKeys()).toEqual([]);
    // Settings carries the Diagnostics card now (spec §6), so this reads it too.
    view.rerender(<SettingsScreen />);
    expect(rawKeys()).toEqual([]);
  });

  it('reads the whole Diagnostics card: no record line is on screen to leave out', async () => {
    const view = await renderViewfinder();
    view.rerender(<SettingsScreen />);
    act(() => view.ports.logger.warn('settings.write-refused'));
    // The record took the line, and the screen did not (spec §6): nothing is exempt from the sweep.
    expect(view.record.lines().join('\n')).toContain('settings.write-refused');
    expect(screen.queryByText(/settings\.write-refused/)).toBeNull();
    expect(rawKeys()).toEqual([]);
    for (const copy of ['Share record', 'Diagnostics', 'Bitrate']) {
      expect(visibleCopy()).toContain(copy);
    }
  });

  it('finds a raw key glued to its neighbour, and one only TalkBack reads', async () => {
    await renderViewfinder();
    const glued = document.createElement('div');
    glued.innerHTML = '<span>Diagnostics</span><span>stream.tally.live</span>';
    const label = document.createElement('div');
    label.setAttribute('aria-label', 'settings.overlay.label');
    document.body.append(glued, label);
    onTestFinished(() => {
      glued.remove();
      label.remove();
    });
    expect(document.body.textContent).toContain('Diagnosticsstream.tally.live');
    expect(rawKeys()).toEqual(['stream.tally.live', 'settings.overlay.label']);
  });
});
