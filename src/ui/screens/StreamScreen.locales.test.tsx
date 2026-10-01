import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, onTestFinished } from 'vitest';
import { FAKE_SCENES } from '@/engine/FakeCaptureEngine';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import type { Lang } from '@/i18n/language';
import nl from '@/i18n/nl.json';
import type { KeyValueStore } from '@/services/KeyValueStore';
import { DiagnosticsScreen } from '@/ui/screens/DiagnosticsScreen';
import { SettingsScreen } from '@/ui/screens/SettingsScreen';
import { savedStreamCode } from '../../../test/fixtures/savedStream';
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
 * The session record's lines are left out: they are event names, not copy, and
 * some match the pattern by design (`settings.write-refused`,
 * `stream.unusable-code`). Its heading, Share and failure line stay in.
 */
function visibleCopy(): string[] {
  const body = document.body.cloneNode(true) as HTMLElement;
  body.querySelector('[data-testid="session-record-lines"]')?.remove();
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
 * itself would otherwise pass.
 */
const SUB_STATES: Readonly<Record<string, (lang: Lang) => Promise<void>>> = {
  'Back on air': async (lang) => {
    const view = await renderViewfinder({ deviceLanguages: [lang] });
    act(() => view.engine.scene('live'));
    act(() => void view.back.press());
    expect(visibleCopy()).toContain(shown(lang, 'stream.leaveOnAir'));
  },
  'ended, never live': async (lang) => {
    const view = await renderViewfinder({ deviceLanguages: [lang] });
    act(() => view.engine.forceState({ kind: 'ended', reason: 'fatal-error', durationMs: null }));
    expect(visibleCopy()).toContain(shown(lang, 'stream.ended.neverLive'));
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
    fireEvent.click(screen.getByRole('switch'));
    expect(await screen.findByText(shown(lang, 'settings.saveFailed'))).toBeTruthy();
  },
  'a share refused': async (lang) => {
    const view = await renderViewfinder({ deviceLanguages: [lang] });
    view.rerender(<DiagnosticsScreen />);
    view.share.refuse();
    fireEvent.click(screen.getByRole('button', { name: shown(lang, 'diag.share') }));
    expect(await screen.findByText(shown(lang, 'diag.shareFailed'))).toBeTruthy();
  },
  'the overlay crashed': async (lang) => {
    await renderViewfinder(
      { deviceLanguages: [lang] },
      { prepare: (fakes) => fakes.surfaces.crashOverlay() },
    );
    expect(visibleCopy()).toContain(shown(lang, 'stream.advisory.overlayFailed'));
  },
  'a code it cannot use': async (lang) => {
    await renderViewfinder(
      { deviceLanguages: [lang] },
      { saved: savedStreamCode({ raw: 'not a capture code' }) },
    );
    expect(visibleCopy()).toContain(shown(lang, 'stream.status.unusable'));
  },
  'no session details': async (lang) => {
    const view = await renderViewfinder({ deviceLanguages: [lang] });
    act(() => view.engine.setDescriptor(null));
    expect(visibleCopy()).toContain(shown(lang, 'stream.status.noDetails'));
  },
  'on air with no viewer picture': async (lang) => {
    await renderViewfinder(
      { deviceLanguages: [lang] },
      { prepare: (fakes) => fakes.engine.scene('live') },
    );
    expect(visibleCopy()).toContain(shown(lang, 'stream.peek.unavailable'));
  },
};

const SCENE_CASES = LANGS.flatMap((lang) => FAKE_SCENES.map((scene) => [lang, scene] as const));
const SUB_STATE_CASES = LANGS.flatMap((lang) =>
  Object.keys(SUB_STATES).map((name) => [lang, name] as const),
);

describe('no screen in any state shows a raw key (AGENTS §10, question 4)', () => {
  // Review M3: an empty table registers no case and passes. Update the counts
  // when a scene or a sub-state is added: 4 languages × 17 scenes, × 9 sub-states.
  it('sweeps every scene and every sub-state, in every language', () => {
    expect(SCENE_CASES).toHaveLength(68);
    expect(SUB_STATE_CASES).toHaveLength(36);
  });

  it.each(SUB_STATE_CASES)('%s, %s', async (lang, name) => {
    await SUB_STATES[name]?.(lang);
    expect(rawKeys()).toEqual([]);
  });

  it.each(SCENE_CASES)('%s, %s', async (lang, scene) => {
    const view = await renderViewfinder({ deviceLanguages: [lang] });
    act(() => view.engine.scene(scene));
    expect(rawKeys()).toEqual([]);
    view.rerender(<SettingsScreen />);
    expect(rawKeys()).toEqual([]);
    view.rerender(<DiagnosticsScreen />);
    expect(rawKeys()).toEqual([]);
  });

  it('reads around the record lines only, never the rest of Diagnostics', async () => {
    const view = await renderViewfinder();
    view.rerender(<DiagnosticsScreen />);
    act(() => view.ports.logger.warn('settings.write-refused'));
    expect(screen.getByText(/settings\.write-refused/)).toBeTruthy();
    expect(rawKeys()).toEqual([]);
    for (const copy of ['Session record', 'Share record', 'Diagnostics', 'Bitrate']) {
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
