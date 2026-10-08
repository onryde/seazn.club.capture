import { SETTINGS_KEY } from '@/services/streamSettingsStore';

/**
 * The saved stream settings with the score preview OFF, for a `kvSeed`. The strip says ONE message (owner, 2026-10-08,
 * two tiers): an urgent status line always wins it, but an advisory caption beats a routine one, and with the preview on
 * a paired phone before air always has the Score ahead caption up, which hides a routine line ("Waiting for Go live")
 * a test may need to read. A test about that masking, or one that reads an urgent line, leaves the preview on.
 */
export const OVERLAY_OFF_SEED: Readonly<Record<string, string>> = {
  [SETTINGS_KEY]: '{"v":2,"overlay":false,"side":"right","automatic":true}',
};
