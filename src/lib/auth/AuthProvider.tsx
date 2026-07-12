"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { setAuthTokenGetter } from "@/lib/wisper/client";
import { AuthContext, type AuthContextValue } from "./context";
import { resolveAuth, type AuthState } from "./jwt";
import {
  captureTokenFromHash,
  hostedUiSignInUrl,
  readStoredToken,
  writeStoredToken,
} from "./storage";

const LOADING: AuthState = { status: "loading", user: null };

/** Provides admin auth state to the tree. On mount it captures any token from a
 *  Cognito redirect, then resolves the stored token into a gate-ready state and
 *  wires the API client to send it as a bearer token. */
export function AuthProvider({ children }: { children: ReactNode }) {
  // `token` holds the raw JWT; `state` is its resolved gate view. Kept together
  // so the client's token getter and the gate never disagree.
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<AuthState>(LOADING);

  // Give the API client a live view of the current token.
  useEffect(() => setAuthTokenGetter(() => token), [token]);

  useEffect(() => {
    const captured = captureTokenFromHash();
    const current = captured ?? readStoredToken();
    setToken(current);
    setState(resolveAuth(current));
  }, []);

  const signIn = useCallback(() => {
    const url = hostedUiSignInUrl();
    if (url && typeof window !== "undefined") window.location.assign(url);
  }, []);

  const signOut = useCallback(() => {
    writeStoredToken(null);
    setToken(null);
    setState({ status: "unauthenticated", user: null });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, signIn, signOut }),
    [state, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
