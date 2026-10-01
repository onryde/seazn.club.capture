import { act, screen } from '@testing-library/react';
import { describe, expect, it, onTestFinished } from 'vitest';
import { FAKE_SCENES } from '@/engine/FakeCaptureEngine';
import { DiagnosticsScreen } from '@/ui/screens/DiagnosticsScreen';
import { SettingsScreen } from '@/ui/screens/SettingsScreen';
import { renderViewfinder } from '../../../test/renderViewfinder';

const LANGS = ['en', 'es', 'fr', 'nl'] as const;
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

describe('no screen in any state shows a raw key (AGENTS §10, question 4)', () => {
  it.each(LANGS.flatMap((lang) => FAKE_SCENES.map((scene) => [lang, scene] as const)))(
    '%s, %s',
    async (lang, scene) => {
      const view = await renderViewfinder({ deviceLanguages: [lang] });
      act(() => view.engine.scene(scene));
      expect(rawKeys()).toEqual([]);
      view.rerender(<SettingsScreen />);
      expect(rawKeys()).toEqual([]);
      view.rerender(<DiagnosticsScreen />);
      expect(rawKeys()).toEqual([]);
    },
  );

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
