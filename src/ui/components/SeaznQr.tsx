import Svg, { Image as SvgImage, Path, Rect } from 'react-native-svg';
import type { SeaznQrPlan } from '@/domain/qr/seaznQr';
import logo from '@/ui/assets/seazn-qr-logo.png';
import { colour } from '@/ui/theme/tokens';

/**
 * Paints a plan: white ground with its quiet zone, the dark modules in the night ink, the Seazn icon in the
 * knocked-out centre. Drawing only; what it draws is `seaznQrPlan`'s `path`, which the plan's own tests rasterise
 * and decode. `size` is a whole multiple of `plan.total` (the caller's rule, held by the Remote scoring panel's fit
 * test), so every module is a whole number of dp: as crisp as the screen allows without `shapeRendering`. On a
 * fractional-density screen a whole dp is not a whole pixel, so an edge can still soften by a pixel; the modules are
 * one path, so there are no seams between them.
 */
export function SeaznQr({ plan, size, label }: { plan: SeaznQrPlan; size: number; label: string }) {
  const viewBox = `0 0 ${plan.total} ${plan.total}`;
  return (
    <Svg
      width={size}
      height={size}
      viewBox={viewBox}
      accessible
      accessibilityLabel={label}
      testID="seazn-qr"
    >
      <Rect width={plan.total} height={plan.total} fill={colour.qrGround} />
      <Path d={plan.path} fill={colour.ground} />
      <SvgImage
        href={logo}
        x={plan.logo.x}
        y={plan.logo.y}
        width={plan.logo.size}
        height={plan.logo.size}
      />
    </Svg>
  );
}
