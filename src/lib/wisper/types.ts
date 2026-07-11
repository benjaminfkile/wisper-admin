// TypeScript types for the Wisper API (see docs/API.md in the wisper-api repo).
// Expanded as endpoints are built; this is the shared foundation.

/** Liveness (docs/API.md §4). */
export interface HealthResponse {
  status: string;
}

/** Uniform error envelope (docs/API.md §3): `{ "error": { ... } }`. */
export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    request_id: string;
    details?: unknown;
  };
}

/** Contract/lease lifecycle states (docs/DATA_MODEL.md §5). */
export type LeaseStatus =
  | "pending"
  | "provisioning"
  | "active"
  | "suspended"
  | "ended"
  | "failed";

/** Container network mode (docs/API.md). */
export type WispNetwork = "none" | "open" | "egress";
