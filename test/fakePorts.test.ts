import { afterEach, describe, expect, it } from 'vitest';
import { createFakePorts, disposeFakePorts } from './fakePorts';

// This runs in the node project, which has no UI setup file to dispose for it.
afterEach(() => {
  disposeFakePorts();
});

describe('fake back', () => {
  it('ignores a second unsubscribe instead of removing another handler', () => {
    const { back } = createFakePorts();
    const pressed: string[] = [];
    back.subscribe(() => {
      pressed.push('first');
      return true;
    });
    const leaveSecond = back.subscribe(() => false);
    leaveSecond();
    leaveSecond();
    expect(back.press()).toBe(true);
    expect(pressed).toEqual(['first']);
  });
});
