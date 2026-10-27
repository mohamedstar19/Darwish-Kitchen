import { Ionicons } from '@expo/vector-icons';
import { useRef, useState, type ReactElement } from 'react';
import {
  ActivityIndicator,
  Platform,
  RefreshControl,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewProps,
} from 'react-native';
import { useTheme } from '../theme';

const isWeb = Platform.OS === 'web';
const TRIGGER = 70; // how far to pull (after damping) before letting go refreshes
const MAX_PULL = 110;

type ScrollProps = Pick<
  ScrollViewProps,
  'refreshControl' | 'onScroll' | 'scrollEventThrottle' | 'onTouchStart' | 'onTouchMove' | 'onTouchEnd' | 'onTouchCancel' | 'style'
>;

/**
 * Pull down to refresh, on phones and on the web.
 * Phones use the system RefreshControl. On the web (browser or the installed home-screen app) the page
 * scrolls inside the app, so the browser's own pull-to-refresh never fires: we follow the finger
 * ourselves when the list is at the top and show a spinner.
 *
 *   <PullToRefresh onRefresh={load} top={insets.top}>
 *     {(scroll) => <FlatList {...scroll} … />}
 *   </PullToRefresh>
 *
 * `style` in the scroll props must be merged with the list's own style (pass yours as `style` here).
 */
export function PullToRefresh({
  onRefresh,
  children,
  top = 0,
  style,
}: {
  onRefresh: () => Promise<unknown> | unknown;
  children: (scroll: ScrollProps) => ReactElement;
  /** Where the spinner sits (e.g. below the status bar on screens without a header). */
  top?: number;
  style?: ScrollViewProps['style'];
}) {
  const c = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  const [pull, setPull] = useState(0);
  const scrollY = useRef(0);
  const startY = useRef<number | null>(null);

  const run = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } catch {
      // The screen shows its own errors.
    } finally {
      setRefreshing(false);
      setPull(0);
    }
  };

  if (!isWeb) {
    return children({
      style,
      refreshControl: <RefreshControl refreshing={refreshing} onRefresh={run} tintColor={c.primary} colors={[c.primary]} progressViewOffset={top} />,
    });
  }

  const y = (e: GestureResponderEvent) => e.nativeEvent.touches?.[0]?.pageY ?? e.nativeEvent.pageY;
  const scroll: ScrollProps = {
    // Stop the browser's own overscroll (and its page reload) from fighting with ours.
    style: [style, { overscrollBehaviorY: 'contain' } as object],
    scrollEventThrottle: 16,
    onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollY.current = e.nativeEvent.contentOffset.y;
    },
    onTouchStart: (e) => {
      startY.current = !refreshing && scrollY.current <= 0 ? y(e) : null;
    },
    onTouchMove: (e) => {
      if (startY.current === null) return;
      const dy = y(e) - startY.current;
      if (dy <= 0 || scrollY.current > 0) {
        if (pull) setPull(0);
        return;
      }
      setPull(Math.min(dy * 0.5, MAX_PULL));
    },
    onTouchEnd: () => {
      if (startY.current === null) return;
      startY.current = null;
      if (pull >= TRIGGER) run();
      else setPull(0);
    },
    onTouchCancel: () => {
      startY.current = null;
      setPull(0);
    },
  };

  const shown = refreshing || pull > 8;
  const progress = refreshing ? 1 : Math.min(pull / TRIGGER, 1);
  const offset = refreshing ? 56 : pull;

  return (
    <View style={styles.fill}>
      {children(scroll)}
      {shown ? (
        <View pointerEvents="none" style={[styles.spot, { top: top + offset - 40 }]}>
          <View style={[styles.bubble, { backgroundColor: c.card, borderColor: c.border, opacity: 0.4 + progress * 0.6 }]}>
            {refreshing ? (
              <ActivityIndicator color={c.primary} />
            ) : (
              <Ionicons name="arrow-down" size={20} color={c.primary} style={{ transform: [{ rotate: progress >= 1 ? '180deg' : '0deg' }] }} />
            )}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  spot: { position: 'absolute', start: 0, end: 0, alignItems: 'center', zIndex: 10 },
  bubble: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
});
