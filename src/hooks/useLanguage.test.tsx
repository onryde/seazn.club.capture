import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LanguageProvider, useLanguage } from '@/hooks/useLanguage';
import { PortsProvider } from '@/hooks/usePorts';
import type { KeyValueStore } from '@/services/KeyValueStore';
import { STORE_KEYS } from '@/services/modeStore';
import { createFakePorts } from '../../test/fakePorts';

function Probe() {
  const { translator, setLang } = useLanguage();
  return (
    <>
      <span>{translator.t('home.tile.comingSoon')}</span>
      <button type="button" onClick={() => setLang('nl')}>
        nl
      </button>
    </>
  );
}

function renderProbe(fakes: ReturnType<typeof createFakePorts>) {
  render(
    <PortsProvider ports={fakes.ports}>
      <LanguageProvider>
        <Probe />
      </LanguageProvider>
    </PortsProvider>,
  );
}

describe('LanguageProvider', () => {
  it('follows the phone language', () => {
    renderProbe(createFakePorts({ deviceLanguages: ['fr'] }));
    expect(screen.getByText('Bientôt disponible')).toBeTruthy();
  });

  it('shows English on a phone in another language', () => {
    renderProbe(createFakePorts({ deviceLanguages: ['de'] }));
    expect(screen.getByText('Coming soon')).toBeTruthy();
  });

  it('prefers and remembers the operator pick', async () => {
    const fakes = createFakePorts({ deviceLanguages: ['en'], kvSeed: { [STORE_KEYS.lang]: 'es' } });
    renderProbe(fakes);
    await screen.findByText('Próximamente');
    act(() => screen.getByText('nl').click());
    await waitFor(() => expect(screen.getByText('Binnenkort')).toBeTruthy());
    expect(fakes.kv.entries.get(STORE_KEYS.lang)).toBe('nl');
  });

  describe('when storage misbehaves (R12)', () => {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    beforeEach(() => {
      rejections.length = 0;
      process.on('unhandledRejection', onRejection);
    });
    afterEach(() => {
      process.off('unhandledRejection', onRejection);
    });

    it('falls back to the phone language when the read throws, and rejects nothing', async () => {
      const kv = storeWith({ get: () => Promise.reject(new Error('keystore locked')) });
      renderProbe(createFakePorts({ kv, deviceLanguages: ['fr'] }));
      await settle();
      expect(screen.getByText('Bientôt disponible')).toBeTruthy();
      expect(rejections).toEqual([]);
    });

    it('shows the pick when the write throws, and rejects nothing', async () => {
      const kv = storeWith({ set: () => Promise.reject(new Error('keystore full')) });
      renderProbe(createFakePorts({ kv }));
      await settle();
      act(() => screen.getByText('nl').click());
      await settle();
      expect(screen.getByText('Binnenkort')).toBeTruthy();
      expect(rejections).toEqual([]);
    });

    it('keeps a pick made before a slow read lands', async () => {
      let finishRead: (text: string | null) => void = () => undefined;
      const kv = storeWith({ get: () => new Promise((resolve) => (finishRead = resolve)) });
      renderProbe(createFakePorts({ kv }));
      act(() => screen.getByText('nl').click());
      await act(async () => finishRead('es'));
      expect(screen.getByText('Binnenkort')).toBeTruthy();
    });
  });
});

/** A store that answers null and accepts writes, except where a test says otherwise. */
function storeWith(overrides: Partial<KeyValueStore>): KeyValueStore {
  return {
    get: async () => null,
    set: async () => undefined,
    delete: async () => undefined,
    ...overrides,
  };
}

/** Lets pending promises settle and Node report any unhandled rejection. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
