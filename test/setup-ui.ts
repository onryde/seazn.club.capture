import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Testing Library only auto-cleans when the runner exposes globals; vitest
// does not by default, so rendered trees would leak between tests.
afterEach(() => {
  cleanup();
});
