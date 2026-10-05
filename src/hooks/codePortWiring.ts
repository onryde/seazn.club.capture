import type { CodePort } from '@/services/codePort';
import { createFakeCodePort } from '@/services/fakeCodePort';
import { createFetchCodePort } from '@/services/fetchCodePort';
import type { FetchLike } from '@/services/httpAsk';
import type { Logger } from '@/services/logger';

/**
 * D25: the web endpoint may not exist yet, so a development build can opt into
 * the fake with `EXPO_PUBLIC_FAKE_CODE=1`. A release never can, whatever the
 * flag: the gate `chooseEngine` keeps for the engine (CD24). Pure, so the gate
 * is tested (final review M1); `createNativePorts` hands it `__DEV__`.
 */
export function chooseCodePort(input: {
  dev: boolean;
  fakeFlag: string | undefined;
  /** The build's origin: both ports answer on it. */
  origin: string;
  fetch: FetchLike;
  logger: Logger;
}): CodePort {
  if (input.dev && input.fakeFlag === '1') return createFakeCodePort(input.origin);
  return createFetchCodePort({ origin: input.origin, fetch: input.fetch, logger: input.logger });
}
