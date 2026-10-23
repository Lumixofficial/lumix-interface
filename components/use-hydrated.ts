import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

// False while React hydrates server HTML, true for every client render after it.
export function useHydrated() {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
