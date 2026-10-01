import { beforeEach, describe, expect, it, vi } from 'vitest';

const Share = vi.hoisted(() => ({ share: vi.fn() }));
vi.mock('react-native', () => ({ Share }));

import { createNativeShare } from '@/services/native/nativeShare';

describe('the native share port (D21)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('opens the share sheet with the text as its message', async () => {
    Share.share.mockResolvedValue({ action: 'sharedAction' });
    await createNativeShare().share('line one\nline two');
    expect(Share.share).toHaveBeenCalledWith({ message: 'line one\nline two' });
  });

  it('rejects when the sheet could not open', async () => {
    Share.share.mockRejectedValue(new Error('no activity'));
    await expect(createNativeShare().share('x')).rejects.toThrow('no activity');
  });

  it('rejects, never throws, when the module throws before returning', async () => {
    Share.share.mockImplementation(() => {
      throw new Error('not linked');
    });
    const shared = createNativeShare().share('x');
    await expect(shared).rejects.toThrow('not linked');
  });
});
