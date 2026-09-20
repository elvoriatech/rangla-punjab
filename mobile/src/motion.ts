import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Platform, type ViewStyle } from "react-native";

/**
 * The app's motion vocabulary: the few loops and press-backs the screens
 * share, and the one accessibility switch that turns all of them off.
 *
 * Nothing here renders. The ring the Offers card and the Offers chip both
 * wear is a component — `PulsingBorder` in `components.tsx` — because this
 * file is a `.ts` and JSX belongs with the rest of the shared widgets; what
 * lives here is the timing, so both call sites pulse on the same clock.
 *
 * Every hook that returns a style hands back a plain object of Animated
 * values: drop it on an `Animated.View` / `Animated.Text`, alongside the
 * ordinary StyleSheet entry, and nothing about the host's layout changes.
 */

/** A style object whose values may be Animated — what the hooks below return. */
export type MotionStyle = Animated.WithAnimatedValue<ViewStyle>;

/**
 * Shared empty style, so a hook that is switched off by reduced motion
 * returns the SAME object every render rather than a fresh `{}` that would
 * make the host's style array a new array each time.
 */
const STILL: MotionStyle = {};

/**
 * `useNativeDriver`, per platform.
 *
 * On a device the native driver is the whole point: these loops run for as
 * long as the screen is open, and off the JS thread they survive a menu
 * fetch or a list scroll without stuttering. react-native-web has no native
 * animated module at all, and asks for `useNativeDriver` it warns once, in
 * every developer's console ("`useNativeDriver` is not supported because the
 * native animated module is missing"), before falling back to the JS driver
 * anyway — so the web build asks for what it was always going to get.
 */
const NATIVE = Platform.OS !== "web";

/** Half of the Offers ring's ~1.6 s round trip: in, then back out. */
const PULSE_MS = 800;

/**
 * Whether the guest has asked the system to stop animating things
 * (iOS "Reduce Motion", Android "Remove animations").
 *
 * Read once on mount AND subscribed to, because the switch is a Settings
 * toggle a guest can flip while the app is backgrounded — the listener is
 * what makes the running loops stop on the way back in rather than at the
 * next cold start.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    // The query is async, so it can land after the screen is gone; the flag
    // is what keeps that from being a setState on an unmounted component.
    void AccessibilityInfo.isReduceMotionEnabled().then((on) => {
      if (alive) setReduced(on);
    });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => {
      alive = false;
      // Optional despite the types: the web shim returns nothing at all when
      // the environment has no `matchMedia` (a static pre-render), and an
      // unsubscribe that throws would take the whole unmount with it.
      sub?.remove();
    };
  }, []);
  return reduced;
}

/**
 * The 0 → 1 → 0 heartbeat behind the Offers ring, eased at both ends so it
 * breathes rather than blinks.
 *
 * With reduced motion on it does not run and parks at 1 — fully faded in,
 * which is the warm ember border the card wears when nothing may move. A
 * half-faded resting state would just look like a rendering bug.
 */
export function usePulse(): Animated.Value {
  const reduced = useReducedMotion();
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) {
      pulse.setValue(1);
      return;
    }
    pulse.setValue(0);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: PULSE_MS,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: NATIVE,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: PULSE_MS,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: NATIVE,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduced]);
  return pulse;
}

/**
 * Where the flame is in its cycle. Six stops rather than two: a flame that
 * swelled and shrank between the same pair of values is a metronome, and the
 * eye reads a metronome as a loading spinner. The stops are uneven on
 * purpose — a big flare, a near-collapse, a couple of small licks.
 */
const FLICKER_STOPS = [0.45, 1, 0.2, 0.8, 0.35, 0.95];

/**
 * The Offers flame: a scale up to 1.15 with a ±6° lean, on durations that
 * are drawn at random.
 *
 * The durations are rolled ONCE per mount and then looped, rather than
 * re-rolled every cycle. Re-rolling would mean building a fresh Animated
 * handle every ~200 ms, and whichever one is in flight when the screen
 * unmounts is the one nothing is holding a reference to stop — a loop of
 * six irregular steps reads as fire for the same cost and leaves exactly
 * one handle to clean up.
 *
 * Reduced motion returns an empty style: the flame is still drawn, it just
 * sits there.
 */
export function useFireFlicker(): MotionStyle {
  const reduced = useReducedMotion();
  const flicker = useRef(new Animated.Value(0)).current;
  const durations = useRef(FLICKER_STOPS.map(() => 110 + Math.round(Math.random() * 190))).current;
  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.sequence(
        FLICKER_STOPS.map((to, i) =>
          Animated.timing(flicker, {
            toValue: to,
            duration: durations[i],
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: NATIVE,
          }),
        ),
      ),
    );
    loop.start();
    return () => loop.stop();
  }, [flicker, durations, reduced]);
  const style = useMemo<MotionStyle>(
    () => ({
      transform: [
        { scale: flicker.interpolate({ inputRange: [0, 1], outputRange: [1, 1.15] }) },
        // Through the middle rather than straight across, so the lean and
        // the swell peak at different moments and the flame looks pushed by
        // a draught instead of pumped.
        {
          rotate: flicker.interpolate({
            inputRange: [0, 0.5, 1],
            outputRange: ["-6deg", "2deg", "6deg"],
          }),
        },
      ],
    }),
    [flicker],
  );
  return reduced ? STILL : style;
}

/**
 * A spring pop for a number that has just changed underneath the guest — the
 * points balance, a tab badge's count.
 *
 * Deliberately NOT on first mount: every tab badge and every hero would
 * bounce on arrival, which says "new" about things that are merely present.
 * The previous value is kept in a ref rather than state so comparing it
 * costs nothing and never triggers a render of its own.
 */
export function useBumpOnChange(value: number): MotionStyle {
  const reduced = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const previous = useRef(value);
  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    if (reduced) return;
    scale.setValue(1.25);
    // Measured frame by frame on the web build: this pair overshoots once,
    // by about 4%, and is level again inside ten frames. The stiffer pair
    // tried first (tension 140) undershot twice as deep and was gone in
    // four, which reads as a flicker rather than a pop.
    const spring = Animated.spring(scale, {
      toValue: 1,
      friction: 6,
      tension: 90,
      useNativeDriver: NATIVE,
    });
    spring.start();
    return () => spring.stop();
  }, [value, scale, reduced]);
  const style = useMemo<MotionStyle>(() => ({ transform: [{ scale }] }), [scale]);
  return reduced ? STILL : style;
}

/** What a pressable spreads over its own props to get the press-back. */
export interface PressScale {
  style: MotionStyle;
  onPressIn: () => void;
  onPressOut: () => void;
}

/**
 * The small "it heard me" on a control that fires immediately — the dish
 * row's ⊕, the quantity stepper.
 *
 * 90 ms each way: long enough to be felt, short enough that a guest adding
 * four things in a row is never waiting for the button. With reduced motion
 * the handlers are no-ops and the host's own `pressed` opacity is the whole
 * feedback, which is what the setting asks for.
 */
export function usePressScale(pressedScale = 0.88): PressScale {
  const reduced = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const running = useRef<Animated.CompositeAnimation | null>(null);
  const to = useCallback(
    (toValue: number) => {
      running.current?.stop();
      running.current = Animated.timing(scale, {
        toValue,
        duration: 90,
        easing: Easing.out(Easing.quad),
        useNativeDriver: NATIVE,
      });
      running.current.start();
    },
    [scale],
  );
  // A press that lands just before the row scrolls out of a list would
  // otherwise leave its release tween running against a gone view.
  useEffect(() => () => running.current?.stop(), []);
  const style = useMemo<MotionStyle>(() => ({ transform: [{ scale }] }), [scale]);
  const onPressIn = useCallback(() => {
    if (!reduced) to(pressedScale);
  }, [reduced, to, pressedScale]);
  const onPressOut = useCallback(() => {
    if (!reduced) to(1);
  }, [reduced, to]);
  return { style: reduced ? STILL : style, onPressIn, onPressOut };
}
