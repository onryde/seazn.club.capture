import type { EngineIntent } from './CaptureEnginePort';

/**
 * An intent as the bridge hands it to native (`PairMapping` and `IntentMapping`
 * in the core). Each kind's fields are copied by name, so nothing a caller
 * spread into an intent reaches native, and the pair's token travels only in
 * the field native protects on arrival (Task 20). The pair carries the
 * operator's language (P3) and the saved venue zone (carry T25), as given:
 * nothing is defaulted here.
 */
export function intentWire(intent: EngineIntent): Record<string, unknown> {
  switch (intent.kind) {
    case 'pair': {
      const { code, slot, token, codeUrl, heartbeatUrl, startUrl } = intent;
      const { venueTimezone, stageLabel, stageMatch, language, automatic, claim, environment } =
        intent;
      return {
        kind: 'pair',
        code,
        slot,
        token,
        codeUrl,
        heartbeatUrl,
        startUrl,
        venueTimezone,
        ...(stageLabel !== undefined && stageMatch !== undefined ? { stageLabel, stageMatch } : {}),
        language,
        automatic,
        claim,
        environment,
      };
    }
    case 'setAutomatic':
      return { kind: 'setAutomatic', on: intent.on };
    case 'setLanguage':
      return { kind: 'setLanguage', language: intent.language };
    default:
      return { kind: intent.kind };
  }
}
