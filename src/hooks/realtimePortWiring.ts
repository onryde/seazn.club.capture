import { RealtimeClient } from '@supabase/realtime-js';
import type { Logger } from '@/services/logger';
import { createSupabaseRealtimePort, type RealtimePort } from '@/services/realtimePort';

/**
 * The production Realtime port, which `createNativePorts` builds once (plan S2-1 Task 8): the real
 * `@supabase/realtime-js` client, never `supabase-js`. Given no transport it takes the runtime's global `WebSocket`
 * (`WebSocketFactory.getWebSocketConstructor`, which Hermes has), so nothing is polyfilled and no `ws` is bundled; a
 * runtime with none makes the library throw, which the port says and answers with `onDown`, so polling carries on.
 * The port's options (the key, `vsn` 1.0.0 so no frame needs `TextDecoder`, no idle-disconnect timer) go to the client
 * as they are. One client per subscription, because a grant's token and channel belong to one subscription. Pure, so
 * the wiring is tested, like `scoringPortFor`.
 */
export function realtimePortFor(deps: { readonly logger: Logger }): RealtimePort {
  return createSupabaseRealtimePort({
    logger: deps.logger,
    createClient: (endpoint, options) => new RealtimeClient(endpoint, options),
  });
}
