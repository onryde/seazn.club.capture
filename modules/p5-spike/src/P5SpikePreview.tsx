import { requireNativeView } from 'expo';
import type { ComponentType } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

export const P5SpikePreview: ComponentType<{ style?: StyleProp<ViewStyle> }> =
  requireNativeView('P5Spike');
