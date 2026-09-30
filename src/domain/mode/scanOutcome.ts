import type { Mode, ModeCode, Recognition } from '@/domain/mode/Mode';

/**
 * Modes that exist in this build. A code for any other mode is recognised
 * and named, then told "coming soon" (spec decision 10) — never opened, never
 * handed to the browser. S2 adds 'scoring', S4 'dashboard'.
 */
export const BUILT_MODES: readonly Mode[] = ['stream'];

export type ScanOutcome =
  | { readonly kind: 'open'; readonly code: ModeCode }
  | { readonly kind: 'otherMode'; readonly tapped: Mode; readonly code: ModeCode }
  | { readonly kind: 'comingSoon'; readonly tapped: Mode; readonly mode: Mode }
  | { readonly kind: 'expired'; readonly tapped: Mode; readonly mode: Mode; readonly at: Date }
  | { readonly kind: 'newerVersion'; readonly tapped: Mode }
  | { readonly kind: 'seaznPage'; readonly tapped: Mode }
  | { readonly kind: 'foreign'; readonly tapped: Mode };

/**
 * What the operator sees after tapping a tile and scanning (spec decisions 3
 * and 10). A code for the wrong mode is not "invalid": it is named, and the
 * app offers to open it (decision record ruling 2).
 */
export function scanOutcome(tapped: Mode, recognition: Recognition): ScanOutcome {
  switch (recognition.outcome) {
    case 'code':
      return codeOutcome(tapped, recognition.code);
    case 'expired':
      return { kind: 'expired', tapped, mode: recognition.mode, at: recognition.at };
    case 'newerVersion':
      return { kind: 'newerVersion', tapped };
    case 'seaznPage':
      return { kind: 'seaznPage', tapped };
    case 'foreign':
      return { kind: 'foreign', tapped };
  }
}

function codeOutcome(tapped: Mode, code: ModeCode): ScanOutcome {
  if (!BUILT_MODES.includes(code.mode)) return { kind: 'comingSoon', tapped, mode: code.mode };
  if (code.mode !== tapped) return { kind: 'otherMode', tapped, code };
  return { kind: 'open', code };
}
