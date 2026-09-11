import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text as RNText, View } from 'react-native';
import { colour, status } from '@/ui/theme/tokens';

/**
 * The one sanctioned class component (AGENTS.md §12): React has no hook
 * equivalent for `componentDidCatch`, so an error boundary must be a class.
 *
 * Two jobs. At the root it makes a crash legible instead of a blank or a
 * vanished app — §6's "never an unexplained blank" applies hardest to failure.
 * Around the overlay WebView (§7) it keeps an overlay crash from taking the
 * live HUD with it: the stream survives and the operator still sees state.
 *
 * The system face is used deliberately — if the failure is in font loading or
 * the theme, the scale cannot be trusted to render the message.
 */
type Props = { children: ReactNode; label?: string };
type State = { error: Error | null; stack: string | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ error, stack: info.componentStack ?? null });
  }

  render() {
    const { error, stack } = this.state;
    if (error === null) return this.props.children;

    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <RNText style={styles.heading}>
          {this.props.label ?? 'Something broke'}
        </RNText>
        <RNText style={styles.message}>{error.message}</RNText>
        {stack === null ? null : (
          <View style={styles.stackBox}>
            <RNText style={styles.stack}>{stack.trim()}</RNText>
          </View>
        )}
      </ScrollView>
    );
  }
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colour.ground,
  },
  content: {
    padding: 24,
    gap: 12,
  },
  heading: {
    // Not red: red is ON AIR in this app. A failure must never be mistakable
    // for a live indicator.
    color: status.failure,
    fontSize: 17,
    fontWeight: '700',
  },
  message: {
    color: colour.ink,
    fontSize: 15,
    lineHeight: 22,
  },
  stackBox: {
    borderTopWidth: 1,
    borderTopColor: colour.rule,
    paddingTop: 12,
  },
  stack: {
    color: colour.ink3,
    fontSize: 11,
    lineHeight: 16,
  },
});
