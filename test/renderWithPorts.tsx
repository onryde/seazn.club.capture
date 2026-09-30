import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { LanguageProvider } from '@/hooks/useLanguage';
import { PortsProvider } from '@/hooks/usePorts';
import { createFakePorts, type FakePorts } from './fakePorts';

export function wrapperFor(fakes: FakePorts) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <PortsProvider ports={fakes.ports}>
        <LanguageProvider>{children}</LanguageProvider>
      </PortsProvider>
    );
  };
}

export function renderWithPorts(
  ui: ReactElement,
  options?: Parameters<typeof createFakePorts>[0],
): RenderResult & FakePorts {
  const fakes = createFakePorts(options);
  // Annotated on purpose: spread straight from render(), the result lost every
  // getBy*/findBy* from its type and tsc refused the return (TS2322).
  const rendered: RenderResult = render(ui, { wrapper: wrapperFor(fakes) });
  return { ...rendered, ...fakes };
}
