import { memo } from 'react';
import Svg, { Path, Rect } from 'react-native-svg';
import type { Mode } from '@/domain/mode/Mode';
import { colour } from '@/ui/theme/tokens';

const SIZE = 28;

/** Lime line icons; an unbuilt mode's icon is inert ink. */
export const ModeIcon = memo(function ModeIcon({ mode, dim }: { mode: Mode; dim: boolean }) {
  const stroke = dim ? colour.ink3 : colour.lime;
  return (
    <Svg
      width={SIZE}
      height={SIZE}
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {mode === 'stream' ? (
        <StreamGlyph />
      ) : mode === 'scoring' ? (
        <ScoringGlyph />
      ) : (
        <DashboardGlyph />
      )}
    </Svg>
  );
});

function StreamGlyph() {
  return (
    <>
      <Rect x={2} y={6} width={14} height={12} rx={2} />
      <Path d="M16 10l6-3v10l-6-3" />
    </>
  );
}

function ScoringGlyph() {
  return (
    <>
      <Rect x={3} y={4} width={18} height={16} rx={2} />
      <Path d="M12 4v16M7 10h1M16 10h1M7 14h1M16 14h1" />
    </>
  );
}

function DashboardGlyph() {
  return <Path d="M3 5h5v4H3zM3 15h5v4H3zM8 7h3v10H8M11 12h4M15 10h6v4h-6z" />;
}
