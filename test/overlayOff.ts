import { SETTINGS_KEY } from '@/services/streamSettingsStore';

/**
 * The saved stream settings with the score preview OFF, for a `kvSeed`. The strip says ONE message (owner, 2026-10-08):
 * the caption when one is up, the status line otherwise, and with the preview on a paired phone before air always has
 * the Score ahead caption up, which hides the status line a test may need to read ("Stream stopped — waiting for Go
 * live", a refusal). A test about that masking leaves the preview on.
 */
export const OVERLAY_OFF_SEED: Readonly<Record<string, string>> = {
  [SETTINGS_KEY]: '{"v":2,"overlay":false,"side":"right","automatic":true}',
};
