import { memo } from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colour } from '@/ui/theme/tokens';

export type GlyphName = 'camera' | 'mic' | 'network' | 'settings' | 'home' | 'shutter';

/**
 * What a glyph is drawn in, by the canvas: ink on a readiness chip (its outline carries the state),
 * ink2, cream at 80%, on an icon-row button.
 */
export type GlyphTone = 'ink' | 'ink2';

type GlyphProps = {
  readonly name: GlyphName;
  /** The camera's not-ready form (spec §3). No other glyph has one. */
  readonly slashed?: boolean;
  readonly tone: GlyphTone;
};

/** The canvas draws its 24-unit viewBox at 22 dp. */
const SIZE = 22;

/**
 * The line icons of the chips and the icon row (spec §3), after `ModeIcon`:
 * a 24-unit viewBox drawn at 22 dp, stroke 1.8, no fill. The paths are the
 * canvas's, version 23. The stroke is the tone's colour.
 */
export const Glyph = memo(function Glyph({ name, slashed = false, tone }: GlyphProps) {
  return (
    <Svg
      width={SIZE}
      height={SIZE}
      viewBox="0 0 24 24"
      fill="none"
      stroke={colour[tone]}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {name === 'camera' ? (
        <CameraGlyph slashed={slashed} />
      ) : name === 'mic' ? (
        <MicGlyph />
      ) : name === 'network' ? (
        <NetworkGlyph />
      ) : name === 'settings' ? (
        <SettingsGlyph />
      ) : name === 'home' ? (
        <HomeGlyph />
      ) : (
        <ShutterGlyph />
      )}
    </Svg>
  );
});

function CameraGlyph({ slashed }: { slashed: boolean }) {
  return (
    <>
      <Path d="M3 8h3l2-3h8l2 3h3v11H3z" />
      <Circle cx={12} cy={13} r={3.5} />
      {slashed ? <Path d="M3 3l18 18" /> : null}
    </>
  );
}

function MicGlyph() {
  return (
    <>
      <Rect x={9} y={3} width={6} height={11} rx={3} />
      <Path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8" />
    </>
  );
}

function NetworkGlyph() {
  return (
    <>
      <Path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0" />
      <Circle cx={12} cy={19.5} r={1} />
    </>
  );
}

function SettingsGlyph() {
  return (
    <>
      <Path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
      <Circle cx={16} cy={6} r={2} />
      <Circle cx={10} cy={12} r={2} />
      <Circle cx={18} cy={18} r={2} />
    </>
  );
}

function HomeGlyph() {
  return <Path d="M3 11l9-7 9 7M5 10v10h14V10M10 20v-5h4v5" />;
}

/** Take photo (spec §8): the plan's drawing (D9), not the canvas's. */
function ShutterGlyph() {
  return (
    <>
      <Circle cx={12} cy={12} r={9} />
      <Circle cx={12} cy={12} r={4} />
    </>
  );
}
