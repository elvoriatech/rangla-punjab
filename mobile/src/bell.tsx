import { createContext, useContext } from "react";

/**
 * The restaurant app's bell (owner, 2026-10-14): how many notifications
 * this login has not seen, and how to open the list. Provided once by the
 * app shell in restaurant mode; every BrandHeader with a ☰ shows the bell
 * from it, so no screen has to thread it through. Null = no bell (guests).
 */
export interface BellState {
  count: number;
  open: () => void;
}

export const BellContext = createContext<BellState | null>(null);

export function useBell(): BellState | null {
  return useContext(BellContext);
}
