import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LanguageProvider, useLanguage } from '@/hooks/useLanguage';
import { PortsProvider } from '@/hooks/usePorts';
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
});
