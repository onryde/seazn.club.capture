import type { LastEnd, Refusal } from '@/domain/session/Pairing';
import type { ServerSays } from '@/engine/contract/serverSays';
import serverBodies from '@/engine/wire/server-bodies.json';

/** The server's `endReason` for each phone-side last end the server can cause (Task 3's LastEnd.of, reversed). */
export const SERVER_END: Readonly<Partial<Record<LastEnd, string>>> = {
  'stopped-by-organiser': 'stopped',
  'stopped-automatically': 'auto_stopped',
  'no-signal': 'no_inbound_timeout',
  'destination-refused': 'target_rejected',
  'max-duration': 'max_duration',
  'phone-lost': 'phone_lost',
  'ended-by-seazn': 'failed',
};

/** The status `POST start` refuses with, for each refusal the server says (capture-start.v1's refusal). */
export const REFUSAL_STATUS: Readonly<Partial<Record<Refusal, number>>> = {
  no_destination: 409,
  no_credit: 402,
  not_entitled: 403,
};

const hostBody = (name: string): Record<string, unknown> => {
  const row = serverBodies.bodies.find((body) => body.name === name);
  if (row === undefined) throw new Error(`no server body ${name}`);
  return row.body;
};

/**
 * The host's own waiting beat and session sid (`wire/server-bodies.json`'s `host/` rows, which the
 * host's ScriptedServer answers with and ajv checks): a go-live names the session the code's answer
 * then opens, so the chain finds its own sid (I3: a uuid, never `sess_host`).
 */
const WAITING = hostBody('host/beat-waiting');
const sid = hostBody('host/code-warming').sid;
if (typeof sid !== 'string') throw new Error('host/code-warming names no sid');
export const HOST_SID: string = sid;

export type Script = {
  readonly path: 'beat' | 'start';
  readonly status: number;
  readonly body: object;
};

/**
 * `ServerSays` as the host's `script` line (Task 27): a beat's answer, heard at the next beat, or a
 * start's refusal, heard at the next operator start. Each body is a contract shape (C4a m-4); a word
 * the server never says is refused here, never scripted as something it is not.
 */
export function scriptFor(says: ServerSays): Script {
  switch (says.word) {
    case 'go-live':
      return {
        path: 'beat',
        status: 200,
        body: { ...WAITING, state: 'go-live', sid: HOST_SID, startedBy: says.cause },
      };
    case 'live':
      return { path: 'beat', status: 200, body: { ...WAITING, state: 'live', sid: HOST_SID } };
    case 'over': {
      const endReason = SERVER_END[says.lastEnd];
      if (endReason === undefined) throw new Error(`the server never says ${says.lastEnd}`);
      return {
        path: 'beat',
        status: 200,
        body: { ...WAITING, state: 'over', sid: HOST_SID, endReason },
      };
    }
    case 'refused': {
      const status = REFUSAL_STATUS[says.refusal];
      if (status === undefined) throw new Error(`the server never refuses with ${says.refusal}`);
      return { path: 'start', status, body: { code: says.refusal, message: 'scripted' } };
    }
    case 'replaced':
    case 'taken':
      return { path: 'beat', status: 200, body: { state: says.word } };
    case 'code-ended':
      return { path: 'beat', status: 401, body: { code: 'code_ended', message: 'scripted' } };
  }
}
