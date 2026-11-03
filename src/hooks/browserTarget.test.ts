import { describe, expect, it } from 'vitest';
import { browserTarget } from '@/hooks/browserTarget';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';

// Where the update banner's "Score in the browser" goes (plan S2-1 Task 9 review, item 7): the scoring page on the
// build's own host, with the link's token. Anything else, or no link, is no target, and the banner says it cannot open.

const HOST = 'stg.seazn.club';
const LINK = { origin: `https://${HOST}`, token: FAKE_SCORING_SECRET };

describe('the browser target', () => {
  it('is the scoring page of the build’s host with the link’s token', () => {
    expect(browserTarget(HOST, LINK)).toBe(`https://stg.seazn.club/score/${FAKE_SCORING_SECRET}`);
  });

  it('is none for no link', () => {
    expect(browserTarget(HOST, null)).toBeNull();
  });

  it('is none when the build has no host', () => {
    expect(browserTarget('', LINK)).toBeNull();
  });

  it.each([
    'https://evil.example',
    'http://stg.seazn.club',
    'https://stg.seazn.club:8443',
    'https://seazn.club',
  ])('is none for a link kept for %s: the token goes only to the build’s own host', (origin) => {
    expect(browserTarget(HOST, { origin, token: FAKE_SCORING_SECRET })).toBeNull();
  });
});
