import type { Transport } from '@/domain/credentials/StreamCredentials';
import type { DegradeReason, SessionEvent, SessionState } from '@/domain/session/SessionState';

/**
 * Projects one native event onto the read model. Pure, total, and the only
 * place session state is derived (AGENTS.md §2).
 *
 * Native is authoritative: this never *decides* anything, it only reflects.
 */
export function projectEvent(state: SessionState, event: SessionEvent, atMs: number): SessionState {
  switch (event.kind) {
    case 'SessionArmed':
      return { kind: 'armed' };

    case 'PublishStarted':
      return { kind: 'publishing', transport: event.transport, sinceEpochMs: atMs };

    case 'TransportDegraded': {
      const transport = transportOf(state);
      return transport === null ? state : degrade(state, event.reason, transport);
    }

    case 'FellBackToRtmps':
      return degrade(state, 'fell-back-to-rtmps', 'rtmps');

    // A hot handset is a condition of the device, not of the broadcast. The
    // ladder sheds the operator's overlay preview long before it touches the
    // encode, so a thermally capped phone is usually still publishing cleanly.
    // Carried in telemetry instead — see SessionState's DegradeReason note.
    case 'ThermalCeilingHit':
      return state;

    case 'UplinkLost':
      return {
        kind: 'reconnecting',
        holdRemainingSeconds: event.holdWindowSeconds,
        sinceEpochMs: broadcastStart(state, atMs),
      };

    case 'HoldTicked':
      return state.kind === 'reconnecting'
        ? { ...state, holdRemainingSeconds: event.holdRemainingSeconds }
        : state;

    case 'PublishResumed':
      return {
        kind: 'publishing',
        transport: event.transport,
        sinceEpochMs: broadcastStart(state, atMs),
      };

    case 'SessionEnded':
      return { kind: 'ended', reason: event.reason };

    case 'SessionReset':
      return { kind: 'idle' };
  }
}

/**
 * Only a live broadcast can be degraded. Native should not report transport
 * trouble before a connection exists; if it does, reflect nothing rather than
 * fabricate a transport that was never used.
 */
function degrade(state: SessionState, reason: DegradeReason, transport: Transport): SessionState {
  if (!('sinceEpochMs' in state)) return state;
  return { kind: 'degraded', transport, reason, sinceEpochMs: state.sinceEpochMs };
}

/**
 * The broadcast is continuous across a drop — the front door holds the input —
 * so elapsed time survives reconnects rather than restarting. An operator who
 * walks behind a sightscreen should not see the clock go back to zero.
 */
function broadcastStart(state: SessionState, fallbackMs: number): number {
  return 'sinceEpochMs' in state ? state.sinceEpochMs : fallbackMs;
}

function transportOf(state: SessionState): Transport | null {
  return 'transport' in state ? state.transport : null;
}
