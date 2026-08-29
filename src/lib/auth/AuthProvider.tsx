"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { setAuthTokenGetter } from "@/lib/wisper/client";
import { AuthContext, type AuthContextValue } from "./context";
import { resolveApiKeyGate, resolveCredential } from "./gate";
import type { AuthState, AuthStatus } from "./jwt";
import {
  captureTokenFromHash,
  clearStoredCredentials,
  hostedUiSignInUrl,
  readStoredCredential,
  writeStoredApiKey,
} from "./storage";

const LOADING: AuthState = { status: "loading", user: null };

/** Provides admin auth state to the tree. On mount it captures any token from a
 *  Cognito redirect, then resolves the held credential into a gate-ready state
 *  and wires the API client to send it as a bearer token. The credential is
 *  either a Cognito id-token (decoded client-side) or a pasted Wisper API key
 *  (authorized by a backend probe; see gate.ts). */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(LOADING);
  // The raw bearer we send (id-token or API key). Held in a ref so the client's
  // token getter always reads the current value, including mid-probe, when the
  // just-set API key must be the bearer for the /v1/admin/overview call.
  const credentialRef = useRef<string | null>(null);

  // Give the API client a live view of the current credential.
  useEffect(() => {
    setAuthTokenGetter(() => credentialRef.current);
  }, []);

  useEffect(() => {
    let active = true;
    const captured = captureTokenFromHash();
    const credential = captured ?? readStoredCredential();
    credentialRef.current = credential;
    resolveCredential(credential).then((res) => {
      if (!active) return;
      if (res.clear) {
        credentialRef.current = null;
        clearStoredCredentials();
      }
      setState(res.state);
    });
    return () => {
      active = false;
    };
  }, []);

  const signIn = useCallback(() => {
    const url = hostedUiSignInUrl();
    if (url && typeof window !== "undefined") window.location.assign(url);
  }, []);

  const signInWithKey = useCallback(async (key: string): Promise<AuthStatus> => {
    const trimmed = key.trim();
    // Persist and make it the live bearer before probing the backend.
    writeStoredApiKey(trimmed);
    credentialRef.current = trimmed;
    setState(LOADING);
    const res = await resolveApiKeyGate();
    if (res.clear) {
      credentialRef.current = null;
      writeStoredApiKey(null);
    }
    setState(res.state);
    return res.state.status;
  }, []);

  const signOut = useCallback(() => {
    clearStoredCredentials();
    credentialRef.current = null;
    setState({ status: "unauthenticated", user: null });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, signIn, signInWithKey, signOut }),
    [state, signIn, signInWithKey, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
