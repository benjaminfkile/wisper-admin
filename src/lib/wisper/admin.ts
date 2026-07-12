// Typed client for the Wisper admin API (/v1/admin/*). Every call goes through
// `request` (client.ts), which attaches the Cognito bearer token and parses the
// uniform error envelope into a WisperError. The authoritative contract lives in
// wisper-api (docs/API.md §admin); the shapes are declared in ./types.
import { request } from "./client";
import type {
  AdjustmentRequest,
  AdminHost,
  AdminHostList,
  AdminOverview,
  AdminPolicy,
  AdminUser,
  AdminUserList,
  AuditList,
  AuditQuery,
  LedgerAccount,
  LedgerMutationResult,
  PolicyRules,
  RefundRequest,
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

/** The admin API surface, grouped by resource. */
export const admin = {
  /** GET /v1/admin/overview — platform snapshot for the dashboard. */
  getOverview(): Promise<AdminOverview> {
    return request<AdminOverview>(`${V1}/overview`);
  },

  /** GET /v1/admin/policy — current policy & pricing rules. */
  getPolicy(): Promise<AdminPolicy> {
    return request<AdminPolicy>(`${V1}/policy`);
  },

  /** PUT /v1/admin/policy — replace the policy & pricing rules. Send only the
   *  editable fields; the server assigns the new version and echoes the full
   *  policy (including refreshed version history). */
  updatePolicy(policy: PolicyRules): Promise<AdminPolicy> {
    return request<AdminPolicy>(`${V1}/policy`, {
      method: "PUT",
      body: JSON.stringify(policy),
    });
  },

  /** GET /v1/admin/hosts — all registered hosts. */
  listHosts(): Promise<AdminHost[]> {
    return request<AdminHostList>(`${V1}/hosts`).then((r) => r.hosts);
  },

  /** GET /v1/admin/users — all registered consumer accounts. */
  listUsers(): Promise<AdminUser[]> {
    return request<AdminUserList>(`${V1}/users`).then((r) => r.users);
  },

  /** POST /v1/admin/hosts/:id/suspend — suspend a host. */
  suspendHost(id: string, reason: string): Promise<AdminHost> {
    const body: SuspendRequest = { reason };
    return request<AdminHost>(`${V1}/hosts/${encodeURIComponent(id)}/suspend`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  /** POST /v1/admin/hosts/:id/unsuspend — lift a host suspension. */
  unsuspendHost(id: string): Promise<AdminHost> {
    return request<AdminHost>(`${V1}/hosts/${encodeURIComponent(id)}/unsuspend`, {
      method: "POST",
    });
  },

  /** POST /v1/admin/users/:id/suspend — suspend a consumer account. */
  suspendUser(id: string, reason: string): Promise<AdminUser> {
    const body: SuspendRequest = { reason };
    return request<AdminUser>(`${V1}/users/${encodeURIComponent(id)}/suspend`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  /** POST /v1/admin/users/:id/unsuspend — lift a consumer suspension. */
  unsuspendUser(id: string): Promise<AdminUser> {
    return request<AdminUser>(`${V1}/users/${encodeURIComponent(id)}/unsuspend`, {
      method: "POST",
    });
  },

  /** POST /v1/admin/refunds — refund a consumer against a lease/ledger entry.
   *  Money-moving, so it carries an Idempotency-Key: retrying with the same key
   *  is safe and returns the original result rather than duplicating the refund. */
  createRefund(
    body: RefundRequest,
    idempotencyKey: string,
  ): Promise<LedgerMutationResult> {
    return request<LedgerMutationResult>(`${V1}/refunds`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(body),
    });
  },

  /** POST /v1/admin/adjustments — manual ledger credit/debit. Idempotency-Key
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

  /** GET /v1/admin/audit — paginated audit log. */
  getAudit(query: AuditQuery = {}): Promise<AuditList> {
    return request<AuditList>(`${V1}/audit${encode({ ...query })}`);
  },

  /** GET /v1/admin/ledger/accounts/:id — a ledger account with recent entries. */
  getLedgerAccount(id: string): Promise<LedgerAccount> {
    return request<LedgerAccount>(
      `${V1}/ledger/accounts/${encodeURIComponent(id)}`,
    );
  },
};

export type AdminClient = typeof admin;
