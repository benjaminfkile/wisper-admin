// Shared gate resolution: turn the held credential into gate-ready auth state.
//
// There are two credential kinds and two ways to authorize them:
//
//   • A Cognito id-token is a JWT, so `resolveAuth` (jwt.ts) can decode it
//     client-side and read `cognito:groups` for admin. That decode is a UX
//     FAST-PATH ONLY: it lets the gate pick a screen without a round-trip. The
//     Wisper API still re-verifies the token's signature and group on every
//     /v1/admin call, so security never depends on the decode.
//
//   • A Wisper API key (`wck_` prefix) has no JWT payload to decode, so there is
//     nothing to approximate: authorization is resolved by ASKING THE BACKEND,
//     the authoritative check. We probe the cheapest admin read
//     (GET /v1/admin/overview) with the key as the bearer and map the outcome:
//       200 -> authenticated admin
//       403 -> forbidden (key valid, but lacks the `admin` scope)
//       401 -> unauthenticated; the key is bad/revoked, so clear it
//     Any other failure (e.g. the local API is down) keeps the key for a retry.

import { admin } from "@/lib/wisper/admin";
import { WisperError } from "@/lib/wisper/client";
import { resolveAuth, type AuthState, type AuthUser } from "./jwt";
import { isApiKey } from "./storage";

/** Synthetic identity for an API-key session: there is no JWT to distill a real
 *  user from. The backend probe is what actually authorized it. */
const API_KEY_USER: AuthUser = {
  sub: "",
  email: "",
  username: "API key",
  groups: ["admin"],
  isAdmin: true,
  expiresAt: null,
};

/** Result of resolving a credential: the gate state, plus whether the stored
 *  credential should be cleared (a bad/revoked API key). */
export interface GateResolution {
  state: AuthState;
  /** True when the held credential is invalid and should be forgotten. */
  clear: boolean;
}

/** Probe the backend to authorize the currently-held API key. Assumes the API
 *  client is already sending the key as its bearer. */
export async function resolveApiKeyGate(): Promise<GateResolution> {
  try {
    await admin.getOverview();
    return { state: { status: "authenticated", user: API_KEY_USER }, clear: false };
  } catch (err) {
    if (err instanceof WisperError && err.status === 403) {
      return {
        state: {
          status: "forbidden",
          user: { ...API_KEY_USER, groups: [], isAdmin: false },
        },
        clear: false,
      };
    }
    if (err instanceof WisperError && err.status === 401) {
      // Bad or revoked key: forget it so the sign-in screen returns.
      return { state: { status: "unauthenticated", user: null }, clear: true };
    }
    // Unexpected (API unreachable, 5xx, …): keep the key for a later retry.
    return { state: { status: "unauthenticated", user: null }, clear: false };
  }
}

/** Resolve any held credential (or its absence) into gate state. JWTs take the
 *  synchronous decode fast-path; API keys take the backend-authoritative probe. */
export async function resolveCredential(
  credential: string | null,
): Promise<GateResolution> {
  if (!credential) {
    return { state: { status: "unauthenticated", user: null }, clear: false };
  }
  if (isApiKey(credential)) return resolveApiKeyGate();
  return { state: resolveAuth(credential), clear: false };
}
