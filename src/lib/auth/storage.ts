// Token persistence for the admin session. The Cognito ID token is kept in
// localStorage under a namespaced key and, on load, captured from the URL
// fragment when Cognito's implicit flow redirects back with `#id_token=...`.

export const TOKEN_KEY = "wisper.admin.idToken";

/** Read the stored token, or null when none/unavailable (e.g. SSR). */
export function readStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Persist (or, with null, clear) the session token. */
export function writeStoredToken(token: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage disabled (private mode / blocked); the session simply won't persist.
  }
}

/** If Cognito redirected back with `#id_token=...`, pull it out and strip the
 *  fragment so the token doesn't linger in the address bar. Returns the token
 *  when captured, else null. */
export function captureTokenFromHash(): string | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash;
  if (!hash || !hash.includes("id_token=")) return null;
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const token = params.get("id_token");
  if (!token) return null;
  writeStoredToken(token);
  const { pathname, search } = window.location;
  window.history.replaceState(null, "", `${pathname}${search}`);
  return token;
}

/** Build the Cognito Hosted UI sign-in URL from public env, or null when
 *  unconfigured (the sign-in screen then shows setup guidance instead). */
export function hostedUiSignInUrl(): string | null {
  const domain = process.env.NEXT_PUBLIC_COGNITO_DOMAIN;
  const clientId = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID;
  if (!domain || !clientId) return null;
  const redirect =
    typeof window !== "undefined" ? window.location.origin : "";
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "token",
    scope: "openid email profile",
    redirect_uri: redirect,
  });
  return `${domain.replace(/\/$/, "")}/login?${params.toString()}`;
}
