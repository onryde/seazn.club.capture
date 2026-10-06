import { useCallback } from 'react';
import { parseStreamCodeText } from '@/domain/credentials/streamCode';
import { savedCodeName } from '@/domain/mode/codeName';
import { scanStep } from '@/domain/mode/identity';
import type { SavedCode } from '@/domain/mode/savedCode';
import type { Environment } from '@/domain/session/Pairing';
import type { Claim, PairIntent } from '@/engine/CaptureEnginePort';
import { selectEngineStatus, selectHeldName } from '@/hooks/engineSelectors';
import { useLanguage } from '@/hooks/useLanguage';
import { usePorts } from '@/hooks/usePorts';
import { clearingUnderWay } from '@/hooks/useUnpair';

export type PairFacts = {
  readonly language: string;
  readonly automatic: boolean;
  readonly environment: Environment;
  readonly claim: Claim;
};

/**
 * The pair intent for a saved stream code, or null when the code cannot be
 * used: a QR that no longer parses, or no saved stream part. The venue's zone
 * rides with it (carry T23), so native names it before the first beat answers.
 */
export function pairIntentFor(saved: SavedCode, facts: PairFacts): PairIntent | null {
  const code = parseStreamCodeText(saved.raw);
  if (!code.ok || saved.stream === null) return null;
  const { codeUrl, waiting } = saved.stream;
  return {
    kind: 'pair',
    code: code.value.code,
    slot: code.value.slot,
    token: code.value.token,
    codeUrl,
    heartbeatUrl: waiting.heartbeatUrl,
    startUrl: waiting.startUrl,
    venueTimezone: waiting.venueTimezone,
    ...facts,
  };
}

/**
 * Pairs the engine with a saved code, by the identity rules (scanStep). Every
 * `pair` is the operator's (a scan or Continue, claim `new`) or the cold-start
 * re-pair (`resume`, Task 24); nothing else calls this. The record line names
 * the step, the claim and the slot, never the token.
 */
export function usePairing(): (saved: SavedCode, claim: Claim) => void {
  const { engine, logger, streamSettings, environment } = usePorts();
  const { lang } = useLanguage();
  return useCallback(
    (saved: SavedCode, claim: Claim) => {
      const facts = {
        language: lang,
        automatic: streamSettings.getSnapshot().automatic,
        environment,
        claim,
      };
      const intent = pairIntentFor(saved, facts);
      if (intent === null) return logger.warn('stream.unusable-code');
      const snapshot = engine.getSnapshot();
      const step = scanStep({
        engine: selectEngineStatus(snapshot),
        held: selectHeldName(snapshot),
        code: savedCodeName(saved),
        clearing: clearingUnderWay(engine),
      });
      logger.info('intent.pair', { action: step, claim, slot: intent.slot });
      if (step === 'adopt' || step === 'none') return;
      if (step === 'resetThenPair') engine.send({ kind: 'reset' });
      engine.send(intent);
    },
    [engine, logger, streamSettings, environment, lang],
  );
}
