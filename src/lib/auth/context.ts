"use client";

import { createContext, useContext } from "react";
import type { AuthState, AuthStatus } from "./jwt";

/** What consumers get from `useAuth()`: the resolved state plus session actions. */
export interface AuthContextValue extends AuthState {
  /** Begin sign-in. Redirects to the configured Cognito Hosted UI when set. */
  signIn: () => void;
  /** Sign in with a pasted Wisper API key (local dev, no Cognito). Stores the
   *  key and resolves the gate via the backend probe; resolves to the resulting
   *  status so the form can surface a rejected key. */
  signInWithKey: (key: string) => Promise<AuthStatus>;
  /** Clear whichever credential is held and drop back to unauthenticated. */
  signOut: () => void;
}

const DEFAULT: AuthContextValue = {
  status: "loading",
  user: null,
  signIn: () => {},
  signInWithKey: async () => "unauthenticated",
  signOut: () => {},
};

export const AuthContext = createContext<AuthContextValue>(DEFAULT);

/** Access the current admin auth state and session actions. */
export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
