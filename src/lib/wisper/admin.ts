// Typed client for the Wisper admin API (/v1/admin/*). Every call goes through
// `request` (client.ts), which attaches the bearer credential (Cognito JWT or
// API key) and parses the uniform error envelope into a WisperError. The
// authoritative contract lives in wisper-api (docs/API.md §admin); the shapes
// are declared in ./types and were live-verified 2026-07-20.
//
// Responses are unwrapped TOLERANTLY here: list endpoints return a
// `{ data, next_offset|next_cursor }` envelope, so we pull `data` defensively
// (a missing/misshaped envelope degrades to an empty list) and normalize items
// with alternative field names. That keeps components from crashing on drift,
// the whole reason this reconciliation exists.
import { request } from "./client";
import type {
  AdjustmentRequest,
  AdminHost,
  AdminHostList,
  AdminListQuery,
  AdminOverview,
  AdminPolicy,
  AdminUser,
  AdminUserList,
  AuditEntry,
  AuditList,
  AuditQuery,
  LedgerAccount,
  LedgerMutationResult,
  PolicyRules,
  PolicyVersion,
  RefundRequest,
  RefundResponse,
  SuspendRequest,
} from "./types";

const V1 = "/v1/admin";

function encode(query: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** Pull the `data` array out of a `{ data: [...] }` collection envelope, tolerating
 *  a missing envelope, a null body, or a bare array. Anything unexpected → []. */
function unwrapData<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  const data = (res as { data?: unknown } | null | undefined)?.data;
  return Array.isArray(data) ? (data as T[]) : [];
}

/** Coerce a wire value to a string. Strings pass through; finite numbers
 *  stringify (audit row ids arrive as numeric primary keys, and stringifying
 *  them here is what keeps AuditLog's React keys stable and unique). Anything
 *  else (null/boolean/object/NaN) becomes undefined. */
function str(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return undefined;
}

/** Map a raw audit row to AuditEntry, tolerating the several plausible field
 *  names the API might use (actor vs actor_id vs actor_email; target vs
 *  target_type/target_id). The API's authoritative details field is `meta`;
 *  metadata/context/details are also read as fallbacks so the log survives
 *  future renames. */
function normalizeAudit(raw: unknown): AuditEntry {
  const r = (raw ?? {}) as Record<string, unknown>;
  const target = (r.target ?? {}) as Record<string, unknown>;
  const meta = r.meta ?? r.metadata ?? r.context ?? r.details;
  return {
    id: str(r.id) ?? str(r.event_id) ?? "",
    actor:
      str(r.actor) ??
      str(r.actor_email) ??
      str(r.actor_id) ??
      str(r.actor_user_id),
    action: str(r.action) ?? str(r.event) ?? str(r.type),
    target_type: str(r.target_type) ?? str(target.type),
    target_id: str(r.target_id) ?? str(target.id),
    metadata:
      meta && typeof meta === "object"
        ? (meta as Record<string, unknown>)
        : undefined,
    created_at: str(r.created_at) ?? str(r.timestamp) ?? str(r.occurred_at),
  };
}

/** The admin API surface, grouped by resource. */
export const admin = {
  /** GET /v1/admin/overview: platform snapshot for the dashboard. Degrades a
   *  null/empty body to `{}` so callers always get an object. */
  getOverview(): Promise<AdminOverview> {
    return request<AdminOverview>(`${V1}/overview`).then((r) => r ?? {});
  },

  /** GET /v1/admin/policy: the active policy plus its version history
   *  (`{ active, versions }`). Normalizes to always-present fields. */
  getPolicy(): Promise<AdminPolicy> {
    return request<AdminPolicy>(`${V1}/policy`).then((r) => ({
      active: r?.active ?? undefined,
      versions: Array.isArray(r?.versions) ? r!.versions : [],
    }));
  },

  /** PUT /v1/admin/policy: replace the policy & pricing rules. Send only the
   *  editable fields; the server assigns the new version and returns the bare
   *  {@link PolicyVersion} (PolicyView), NOT the `{ active, versions }`
   *  envelope. Callers that need the full envelope (id chip, effective
   *  header, history table) should re-read {@link getPolicy} after this
   *  resolves. */
  updatePolicy(policy: PolicyRules): Promise<PolicyVersion> {
    return request<PolicyVersion>(`${V1}/policy`, {
      method: "PUT",
      body: JSON.stringify(policy),
    }).then((r) => r ?? {});
  },

  /** GET /v1/admin/hosts: a page of registered hosts. Honours the API's
   *  `?query=` (case-insensitive substring across id / name / label / owner)
   *  and `?limit` / `?offset` paging; the response's `next_offset` echoes the
   *  next page's starting offset, or is `null` when the list is exhausted. */
  listHosts(params: AdminListQuery = {}): Promise<AdminHostList> {
    return request<AdminHostList>(`${V1}/hosts${encode({ ...params })}`).then(
      (r) => ({
        data: unwrapData<AdminHost>(r),
        next_offset:
          (r as { next_offset?: number | string | null } | null)?.next_offset ??
          null,
      }),
    );
  },

  /** GET /v1/admin/users: a page of registered consumer accounts. Honours
   *  the same `?query=` / `?limit` / `?offset` params as `/hosts`. */
  listUsers(params: AdminListQuery = {}): Promise<AdminUserList> {
    return request<AdminUserList>(`${V1}/users${encode({ ...params })}`).then(
      (r) => ({
        data: unwrapData<AdminUser>(r),
        next_offset:
          (r as { next_offset?: number | string | null } | null)?.next_offset ??
          null,
      }),
    );
  },

  /** POST /v1/admin/hosts/:id/suspend: suspend a host. */
  suspendHost(id: string, reason: string): Promise<AdminHost> {
    const body: SuspendRequest = { reason };
    return request<AdminHost>(`${V1}/hosts/${encodeURIComponent(id)}/suspend`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  /** POST /v1/admin/hosts/:id/unsuspend: lift a host suspension. */
  unsuspendHost(id: string): Promise<AdminHost> {
    return request<AdminHost>(`${V1}/hosts/${encodeURIComponent(id)}/unsuspend`, {
      method: "POST",
    });
  },

  /** POST /v1/admin/users/:id/suspend: suspend a consumer account. */
  suspendUser(id: string, reason: string): Promise<AdminUser> {
    const body: SuspendRequest = { reason };
    return request<AdminUser>(`${V1}/users/${encodeURIComponent(id)}/suspend`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  /** POST /v1/admin/users/:id/unsuspend: lift a consumer suspension. */
  unsuspendUser(id: string): Promise<AdminUser> {
    return request<AdminUser>(`${V1}/users/${encodeURIComponent(id)}/unsuspend`, {
      method: "POST",
    });
  },

  /** POST /v1/admin/refunds: refund unspent wallet credits against a top-up.
   *  Money-moving, so it carries an Idempotency-Key: retrying with the same
   *  key is safe and returns the original refund rather than duplicating it.
   *  The response is {@link RefundResponse} (refund id, amount refunded,
   *  currency, and the wallet balance after the refund); it does NOT carry
   *  the ledger-transaction fields. Those show up separately in the ledger
   *  forensics view. */
  createRefund(
    body: RefundRequest,
    idempotencyKey: string,
  ): Promise<RefundResponse> {
    return request<RefundResponse>(`${V1}/refunds`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(body),
    });
  },

  /** POST /v1/admin/adjustments: manual ledger credit/debit. Idempotency-Key
   *  guards against double-posting a manual entry on a retry. */
  createAdjustment(
    body: AdjustmentRequest,
    idempotencyKey: string,
  ): Promise<LedgerMutationResult> {
    return request<LedgerMutationResult>(`${V1}/adjustments`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(body),
    });
  },

  /** GET /v1/admin/audit: paginated audit log (`{ data, next_cursor }`). Rows
   *  are normalized tolerantly so the log renders whatever fields the API sends. */
  getAudit(query: AuditQuery = {}): Promise<AuditList> {
    return request<AuditList>(`${V1}/audit${encode({ ...query })}`).then((r) => ({
      data: unwrapData<unknown>(r).map(normalizeAudit),
      next_cursor: str((r as { next_cursor?: unknown } | null)?.next_cursor),
    }));
  },

  /** GET /v1/admin/ledger/accounts/:id: a ledger account with recent entries.
   *  Wire envelope is `{ account, entries }`; we flatten so callers see a
   *  single object (account fields plus `entries`). `entries` degrades to `[]`
   *  when omitted so the view never crashes on a missing list. */
  getLedgerAccount(id: string): Promise<LedgerAccount> {
    return request<{ account?: LedgerAccount; entries?: LedgerAccount["entries"] }>(
      `${V1}/ledger/accounts/${encodeURIComponent(id)}`,
    ).then((r) => {
      const account = (r?.account ?? {}) as LedgerAccount;
      return {
        ...account,
        id: account.id ?? id,
        entries: Array.isArray(r?.entries) ? r.entries : [],
      };
    });
  },
};

export type AdminClient = typeof admin;
