// Credential persistence for the admin session. Two credential kinds are
// supported, both sent to the API exactly the same way (`Authorization: Bearer
// <cred>`):
//   • the Cognito ID token (kept under TOKEN_KEY, or captured from the URL
//     fragment when Cognito's implicit flow redirects back with `#id_token=...`);
//   • a Wisper consumer API key `wck_live_<64-hex>` (kept under API_KEY_KEY),
//     pasted for local dev when there is no Cognito (see the README local-dev
//     section). The backend resolves the key to its owner's principal & scopes.
// Only one credential is held at a time; the held one is the bearer we send.

export const TOKEN_KEY = "wisper.admin.idToken";
export const API_KEY_KEY = "wisper.admin.apiKey";

/** A Wisper API key is prefixed `wck_` (docs/API.md §2); the id-token is a JWT. */
export function isApiKey(credential: string): boolean {
  return credential.startsWith("wck_");
}

/** Read the stored id-token, or null when none/unavailable (e.g. SSR). */
export function readStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Persist (or, with null, clear) the session id-token. */
export function writeStoredToken(token: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage disabled (private mode / blocked); the session simply won't persist.
  }
}

/** Read the stored API key, or null when none/unavailable (e.g. SSR). */
export function readStoredApiKey(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(API_KEY_KEY);
  } catch {
    return null;
  }
}

/** Persist (or, with null, clear) the pasted API key. */
export function writeStoredApiKey(key: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (key) window.localStorage.setItem(API_KEY_KEY, key);
    else window.localStorage.removeItem(API_KEY_KEY);
  } catch {
    // Storage disabled (private mode / blocked); the session simply won't persist.
  }
}

/** The credential to send as the bearer: the Cognito id-token if held, else the
 *  pasted API key. Returns null when neither is present. */
export function readStoredCredential(): string | null {
  return readStoredToken() ?? readStoredApiKey();
}

/** Clear every stored credential (used by sign-out, which drops whichever one is
 *  held). */
export function clearStoredCredentials(): void {
  writeStoredToken(null);
  writeStoredApiKey(null);
}

/** True when the Cognito Hosted UI is configured. When false, the sign-in screen
 *  offers the paste-an-API-key form instead of the (URL-less) Hosted-UI button. */
export function isCognitoConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_COGNITO_DOMAIN &&
      process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID,
  );
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
