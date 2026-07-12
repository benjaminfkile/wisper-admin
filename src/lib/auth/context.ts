"use client";

import { createContext, useContext } from "react";
import type { AuthState } from "./jwt";

/** What consumers get from `useAuth()`: the resolved state plus session actions. */
export interface AuthContextValue extends AuthState {
  /** Begin sign-in. Redirects to the configured Cognito Hosted UI when set. */
  signIn: () => void;
  /** Clear the stored token and drop back to the unauthenticated state. */
  signOut: () => void;
}

const DEFAULT: AuthContextValue = {
  status: "loading",
  user: null,
  signIn: () => {},
  signOut: () => {},
};

export const AuthContext = createContext<AuthContextValue>(DEFAULT);

/** Access the current admin auth state and session actions. */
export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
