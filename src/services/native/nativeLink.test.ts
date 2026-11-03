import { beforeEach, describe, expect, it, vi } from 'vitest';

const Linking = vi.hoisted(() => ({ openURL: vi.fn() }));
vi.mock('react-native', () => ({ Linking }));

import { createNativeLink } from '@/services/native/nativeLink';

describe('the native link port', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hands the URL to the phone, once', async () => {
    Linking.openURL.mockResolvedValue(true);
    await createNativeLink().openUrl(
      'https://play.google.com/store/apps/details?id=com.seazn.capture',
    );
    expect(Linking.openURL).toHaveBeenCalledTimes(1);
    expect(Linking.openURL).toHaveBeenCalledWith(
      'https://play.google.com/store/apps/details?id=com.seazn.capture',
    );
  });

  it('rejects when nothing can open it, and the error does not carry the URL', async () => {
    Linking.openURL.mockRejectedValue(
      new Error('Could not open URL https://stg.seazn.club/score/dl_SECRET'),
    );
    const opened = createNativeLink().openUrl('https://stg.seazn.club/score/dl_SECRET');
    await expect(opened).rejects.toThrow('no app can open this link');
    await opened.catch((error: Error) => expect(error.message).not.toContain('dl_SECRET'));
  });

  it('rejects, never throws, when the module throws before returning', async () => {
    Linking.openURL.mockImplementation(() => {
      throw new Error('not linked');
    });
    await expect(createNativeLink().openUrl('https://example.test')).rejects.toThrow(
      'no app can open this link',
    );
  });

  it.each([
    ['plain http', 'http://stg.seazn.club/score/dl_SECRET'],
    ['a script', 'javascript:alert(1)'],
    ['an intent', 'intent://scan/#Intent;scheme=zxing;end'],
    ['a store scheme', 'market://details?id=com.seazn.capture'],
    ['a file', 'file:///data/data/com.seazn.capture/x'],
    ['no scheme', 'stg.seazn.club/score/dl_SECRET'],
    ['https with no host', 'https://'],
    ['https with a path only', 'https:///dl_SECRET'],
    ['https without its slashes', 'https:stg.seazn.club/dl_SECRET'],
    ['an empty string', ''],
  ])(
    'refuses %s without handing it to the phone, and the error does not carry it',
    async (_name, url) => {
      const opened = createNativeLink().openUrl(url);
      await expect(opened).rejects.toThrow('no app can open this link');
      await opened.catch((error: Error) => expect(error.message).not.toContain('SECRET'));
      expect(Linking.openURL).not.toHaveBeenCalled();
    },
  );
});
