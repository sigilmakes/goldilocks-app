/**
 * Context store — placeholder for science-specific UI state.
 *
 * In v2, most of this functionality moves to pi tools.
 * This store remains for any future context panel state.
 */

import { create } from 'zustand';

interface ContextState {
  // Placeholder — will be populated as pi tools are implemented
  reset: () => void;
}

export const useContextStore = create<ContextState>((set) => ({
  reset: () => set({}),
}));
