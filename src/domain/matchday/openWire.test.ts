import { describe, expect, it } from 'vitest';
import { openRefused, parseOpen } from '@/domain/matchday/openWire';
import {
  answered,
  contractAdmits,
  copyOf,
  fixtureOf,
  fixturesOf,
  refusedWith,
} from '../../../test/matchDayContracts';

/**
 * capture-matchday-open.v1 (S4 Match Day design §6, §9.4), vendored at web 1a6f5ebc9: the open's 200 is a link or
 * "finished"; a match outside the code's scope is the refusal 403 MD_OUT_OF_SCOPE, never a 200 (the controller's
 * ruling, from the contract). Expected values are typed from its fixtures.
 */
const OPEN = 'capture-matchday-open.v1';

/** The link fixtures' url, read from the fixture so no scoring link is typed in a test (AGENTS §4). */
const LINK = fixtureOf(OPEN, 'valid-link') as { kind: string; url: string; sport_key: string };

const read = (data: unknown) => parseOpen(answered(data));
const errorOf = (data: unknown) => {
  const result = read(data);
  return result.ok ? null : result.error;
};

/** Refused by the contract only for a property it does not name: the phone ignores an unknown field. */
const EXTRA_FIELD: Readonly<Record<string, (data: Record<string, unknown>) => void>> = {
  'invalid-finished-with-url': (data) => {
    delete data.url;
  },
};

const REFUSED: Readonly<Record<string, unknown>> = {
  'invalid-link-http': { kind: 'invalid-field', field: 'url', reason: expect.any(String) },
  'invalid-link-no-sport': { kind: 'missing-field', field: 'sport_key' },
  'invalid-refused-as-answer': { kind: 'invalid-field', field: 'kind', reason: expect.any(String) },
};

const answers = fixturesOf(OPEN).filter(([name]) => !name.startsWith('refusal-'));

describe('parseOpen runs every capture-matchday-open.v1 answer fixture', () => {
  it('accounts for every answer fixture', () => {
    const named = [
      'valid-finished',
      'valid-link',
      ...Object.keys(REFUSED),
      ...Object.keys(EXTRA_FIELD),
    ];
    expect(answers.map(([name]) => name).sort()).toEqual(named.sort());
  });

  it('valid-link: the match scoring link and its sport', () => {
    const data = fixtureOf(OPEN, 'valid-link');
    expect(contractAdmits(OPEN, data)).toBe(true);
    expect(read(data)).toEqual({
      ok: true,
      value: { kind: 'link', url: LINK.url, sportKey: 'badminton' },
    });
  });

  it('valid-finished: nothing to score', () => {
    const data = fixtureOf(OPEN, 'valid-finished');
    expect(contractAdmits(OPEN, data)).toBe(true);
    expect(read(data)).toEqual({ ok: true, value: { kind: 'finished' } });
  });

  it.each(Object.entries(REFUSED))(
    '%s: the contract and the phone both refuse it',
    (name, error) => {
      const data = fixtureOf(OPEN, name);
      expect(contractAdmits(OPEN, data)).toBe(false);
      expect(errorOf(data)).toEqual(error);
    },
  );

  it.each(Object.entries(EXTRA_FIELD))(
    '%s: refused by the contract only for its extra field, which the phone ignores',
    (name, strip) => {
      const data = copyOf(fixtureOf(OPEN, name)) as Record<string, unknown>;
      expect(contractAdmits(OPEN, data)).toBe(false);
      const stripped = copyOf(data);
      strip(stripped);
      expect(contractAdmits(OPEN, stripped)).toBe(true);
      expect(read(data)).toEqual({ ok: true, value: { kind: 'finished' } });
    },
  );
});

describe('parseOpen refuses a missing field and ignores an unknown one', () => {
  it.each(['kind', 'url', 'sport_key'])('a link without %s', (key) => {
    const data = copyOf(LINK) as Record<string, unknown>;
    delete data[key];
    expect(errorOf(data)).toEqual({ kind: 'missing-field', field: key });
  });

  it('a finished answer without its kind', () => {
    expect(errorOf({})).toEqual({ kind: 'missing-field', field: 'kind' });
  });

  it.each([
    ['a link', { ...LINK, added_later: 1 }, { kind: 'link', url: LINK.url, sportKey: 'badminton' }],
    ['finished', { kind: 'finished', added_later: 1 }, { kind: 'finished' }],
  ])('%s with a field the contract does not name', (_, data, value) => {
    expect(read(data)).toEqual({ ok: true, value });
  });
});

describe('parseOpen holds the link to the contract pattern', () => {
  const token = LINK.url.slice(LINK.url.lastIndexOf('/') + 1);

  it.each([
    ['a token one character short', LINK.url.slice(0, -1)],
    ['a token one character long', `${LINK.url}A`],
    ['a query string', `${LINK.url}?next=1`],
    ['another path', `https://seazn.club/day/${token}`],
    ['no dl_ prefix', LINK.url.replace('/dl_', '/xx_')],
    ['a scheme in capitals', LINK.url.replace('https://', 'HTTPS://')],
    ['no host', `https:///score/${token}`],
    ['a url that is not text', 42],
  ])('refuses %s', (_, url) => {
    expect(errorOf({ ...LINK, url })).toEqual({
      kind: 'invalid-field',
      field: 'url',
      reason: expect.any(String),
    });
  });

  it('refuses an empty sport', () => {
    expect(errorOf({ ...LINK, sport_key: '' })).toMatchObject({
      kind: 'invalid-field',
      field: 'sport_key',
    });
  });

  it('never names the url it refused', () => {
    expect(JSON.stringify(errorOf({ ...LINK, url: `${LINK.url}?x` }))).not.toContain(token);
  });
});

describe('parseOpen reads the 200 envelope and nothing else', () => {
  it.each([null, 'text', []])('%s is not an object', (body) => {
    expect(parseOpen(body)).toEqual({ ok: false, error: { kind: 'not-an-object' } });
  });

  it('a refusal body is not an answer', () => {
    const body = refusedWith(fixtureOf(OPEN, 'refusal-valid-out-of-scope'));
    expect(parseOpen(body)).toMatchObject({ ok: false, error: { field: 'ok' } });
  });

  it('a bare link with no envelope is not an answer', () => {
    expect(parseOpen(LINK)).toMatchObject({ ok: false, error: { field: 'ok' } });
  });

  it('a second read of the same body is the same', () => {
    const body = answered(LINK);
    expect(parseOpen(body)).toEqual(parseOpen(body));
  });
});

describe('openRefused: 403 MD_OUT_OF_SCOPE is the open refused, read through parseRefusal', () => {
  it('maps the out-of-scope refusal to the refused answer', () => {
    const body = refusedWith(fixtureOf(OPEN, 'refusal-valid-out-of-scope'));
    expect(openRefused(403, body)).toEqual({ kind: 'refused', code: 'MD_OUT_OF_SCOPE' });
  });

  it.each([
    [
      'the code is not open yet: a refusal of the code, not of the open',
      403,
      'refusal-valid-not-open',
    ],
    ['no such match: read by status, the list refreshes', 404, 'refusal-invalid-not-found'],
    ['a refusal with no word', 403, 'refusal-invalid-no-code'],
  ])('%s', (_, status, name) => {
    expect(openRefused(status, refusedWith(fixtureOf(OPEN, name)))).toBeNull();
  });

  it('an out-of-scope word on a status that is no refusal is not one', () => {
    const body = refusedWith(fixtureOf(OPEN, 'refusal-valid-out-of-scope'));
    expect(openRefused(500, body)).toBeNull();
    expect(openRefused(200, body)).toBeNull();
  });
});
