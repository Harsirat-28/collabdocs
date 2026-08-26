import { create } from "zustand";

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  // "checking" covers the initial silent-refresh-on-load attempt so routes
  // don't flash a logged-out state before we know the real session status.
  status: "checking" | "authenticated" | "unauthenticated";
  setSession: (user: AuthUser, accessToken: string) => void;
  clearSession: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  status: "checking",
  setSession: (user, accessToken) => set({ user, accessToken, status: "authenticated" }),
  clearSession: () => set({ user: null, accessToken: null, status: "unauthenticated" }),
}));

/** Non-hook accessor for use outside React (axios interceptors). */
export function getAccessToken(): string | null {
  return useAuthStore.getState().accessToken;
}
