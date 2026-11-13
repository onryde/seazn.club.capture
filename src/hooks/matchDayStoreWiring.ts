import type { KeyValueStore } from '@/services/KeyValueStore';
import type { Logger } from '@/services/logger';
import { createMatchDayStore, type MatchDayStore } from '@/services/matchDayStore';
import { createExpoQueueFiles } from '@/services/native/expoQueueFiles';

/**
 * The production Match Day store, which `createNativePorts` builds once (MD-2 Task 3, the controller's ruling in fix
 * round 1): the day's last good copy in a file of its own folder, `documentDirectory/matchday` (never the tap queue's
 * `scoring`, which reads every file there as a match's queue), and the opened matches in the secure store beside the
 * code. Tested with expo-file-system stood in (`matchDayStoreWiring.test.ts`).
 */
export function matchDayStoreFor(deps: {
  readonly kv: KeyValueStore;
  readonly logger: Logger;
}): MatchDayStore {
  return createMatchDayStore({
    kv: deps.kv,
    files: createExpoQueueFiles('matchday'),
    logger: deps.logger,
  });
}
