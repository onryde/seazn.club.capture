import type { ViewProps } from 'react-native';
import type { ScreenLayout } from '@/domain/mode/homeLayout';

/**
 * A screen's root marker: its test id and the layout it drew. react-native-web renders `dataSet` as
 * `data-*` attributes, which tests read; native ignores it. React Native's own types leave `dataSet`
 * out, hence the cast (as MatchLabel's).
 */
export const layoutMarker = (testID: string, layout: ScreenLayout) =>
  ({ testID, dataSet: { layout } }) as ViewProps;
