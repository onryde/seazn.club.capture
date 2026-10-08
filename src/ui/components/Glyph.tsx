import { memo, type ReactElement } from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colour } from '@/ui/theme/tokens';

/** Every glyph, in one list: the lookup below is typed over it, so a name without a drawing does not compile. */
export const GLYPH_NAMES = [
  'camera',
  'mic',
  'network',
  'settings',
  'home',
  'shutter',
  'qr',
  'back',
  'pulse',
] as const;
export type GlyphName = (typeof GLYPH_NAMES)[number];

/**
 * What a glyph is drawn in, by the canvas: ink on a readiness chip (its outline carries the state),
 * ink2, cream at 80%, on an icon-row button; lime, the LED, for the Diagnostics heading's pulse (the board).
 */
export type GlyphTone = 'ink' | 'ink2' | 'lime';

type GlyphProps = {
  readonly name: GlyphName;
  /** The camera's not-ready form (spec §3). No other glyph has one. */
  readonly slashed?: boolean;
  readonly tone: GlyphTone;
  /** The dp the 24-unit box is drawn at. Left out, the canvas's 22; the Diagnostics pulse is drawn at 18 (the board). */
  readonly size?: number;
};

/** The canvas draws its 24-unit viewBox at 22 dp. */
const SIZE = 22;

/**
 * The line icons of the chips and the icon row (spec §3), after `ModeIcon`:
 * a 24-unit viewBox drawn at 22 dp, stroke 1.8, no fill. The paths are the
 * canvas's, version 23. The stroke is the tone's colour.
 */
export const Glyph = memo(function Glyph({ name, slashed = false, tone, size = SIZE }: GlyphProps) {
  const Drawing = DRAWINGS[name];
  // tsc makes this unreachable for a typed caller; a name from elsewhere is refused by name, not drawn as another glyph.
  if (Drawing === undefined) throw new Error(`Glyph: no drawing for "${String(name)}"`);
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={colour[tone]}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Drawing slashed={slashed} />
    </Svg>
  );
});

/** The drawing of each glyph. Typed over every name, so adding one to `GLYPH_NAMES` without a drawing is a type error. */
const DRAWINGS: Record<GlyphName, (props: { slashed: boolean }) => ReactElement> = {
  camera: CameraGlyph,
  mic: MicGlyph,
  network: NetworkGlyph,
  settings: SettingsGlyph,
  home: HomeGlyph,
  shutter: ShutterGlyph,
  qr: QrGlyph,
  back: BackGlyph,
  pulse: PulseGlyph,
};

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

/** Remote scoring (spec §10): the plan's drawing, not the canvas's. Three finder squares and a few data cells, in the others' stroke. */
function QrGlyph() {
  return (
    <Path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM19 14h2M14 19h2M18 18h3v3h-3z" />
  );
}

/** Back (the owner's Settings board): a chevron-left, in the others' stroke. */
function BackGlyph() {
  return <Path d="M15 5l-7 7 7 7" />;
}

/**
 * Diagnostics (the owner's Settings board): flat, a short rise, a long fall past the line, back to it and flat.
 * 20 units wide, so 15 dp at the 18 dp the board draws it at (measured 15.3 x 12.5).
 */
function PulseGlyph() {
  return <Path d="M2 12h5l2.5-8 4 16 2.5-8h6" />;
}
