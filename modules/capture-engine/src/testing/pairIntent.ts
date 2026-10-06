import type { PairIntent } from '../CaptureEnginePort';

/**
 * A made-up pair intent. Schema-valid (capture-qr.v2 at web 5bb72e8a2): the code is the fixtures'
 * 12 characters of the code alphabet, and the token the fixtures' 22 of base64url, whose tag
 * `wire/token-tag-vectors.json` pins as `b24bb97b`. Never a real code's.
 */
export const PAIR: PairIntent = {
  kind: 'pair',
  code: 'fx42hmnp7k2q',
  slot: 1,
  token: 'tok-9f3c2a7e5b1d4680ab',
  codeUrl: 'https://stg.seazn.club/api/v1/capture/codes/fx42hmnp7k2q',
  heartbeatUrl: 'https://stg.seazn.club/api/v1/capture/codes/fx42hmnp7k2q/beats',
  startUrl: 'https://stg.seazn.club/api/v1/capture/codes/fx42hmnp7k2q/start',
  venueTimezone: 'Europe/London',
  language: 'fr',
  automatic: false,
  claim: 'resume',
  environment: 'staging',
};
