import { describe, expect, it } from 'vitest';
import { cutDestination, DESTINATION_CAP } from '@/domain/session/destination';

/**
 * Amendment §2, the paired status line: "the name cut to 23 characters plus
 * '…' past 24". Every expected value is written out by hand, never computed.
 */
describe('the destination as the status line shows it (amendment §2)', () => {
  it('counts the cap at 24, as every status line budget does', () => {
    expect(DESTINATION_CAP).toBe(24);
  });

  it('leaves a 24-character name whole', () => {
    const name = 'YouTube · Example Town C';
    expect([...name]).toHaveLength(24);
    expect(cutDestination(name)).toBe('YouTube · Example Town C');
  });

  it('cuts a 25-character name to 23 and an ellipsis', () => {
    const name = 'YouTube · Example Town CC';
    expect([...name]).toHaveLength(25);
    // The 23rd character is the space after "Town": the cut keeps it.
    expect(cutDestination(name)).toBe('YouTube · Example Town …');
  });

  it('counts an emoji as one character, so a surrogate pair is never split', () => {
    const cut = cutDestination('📺'.repeat(30));
    expect(cut).toBe(`${'📺'.repeat(23)}…`);
    expect([...cut]).toHaveLength(24);
  });

  it('leaves the empty name empty', () => {
    expect(cutDestination('')).toBe('');
  });
});
