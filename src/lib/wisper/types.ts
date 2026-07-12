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

// ---------------------------------------------------------------------------
// Admin surface (/v1/admin/*). Contract embedded here; the authoritative docs
// live in wisper-api (docs/API.md §admin). Amounts are integer minor units
// (e.g. cents) unless noted, matching the ledger.
// ---------------------------------------------------------------------------

/** Suspension state shared by hosts and users. */
export type AccountStatus = "active" | "suspended";

/** GET /v1/admin/overview — platform snapshot for the dashboard. */
export interface AdminOverview {
  /** Gross revenue to date, in minor units. */
  revenue_total: number;
  /** Revenue booked in the trailing 30 days, in minor units. */
  revenue_30d: number;
  /** Currently active leases. */
  active_leases: number;
  /** Registered hosts and how many are currently suspended. */
  hosts_total: number;
  hosts_suspended: number;
  /** Registered consumer accounts and how many are currently suspended. */
  users_total: number;
  users_suspended: number;
  /** Payouts owed to hosts but not yet settled, in minor units. */
  pending_payouts: number;
  /** Server-side timestamp the snapshot was computed (RFC3339). */
  generated_at: string;
}

/** The editable policy & pricing fields (the PUT body). */
export interface PolicyRules {
  /** Platform take rate applied to each lease, in basis points (10000 = 100%). */
  platform_fee_bps: number;
  /** Floor/ceiling price per compute-hour, in minor units. */
  min_price_per_hour: number;
  max_price_per_hour: number;
  /** Minimum wallet top-up a consumer may make, in minor units. */
  min_topup: number;
  /** Default network mode applied to new wisps. */
  default_network: WispNetwork;
  /** Ceiling on concurrently active leases a single consumer may hold. */
  max_active_leases_per_user: number;
  /** Whether new host registrations are accepted. */
  host_signups_enabled: boolean;
}

/** A single point-in-time revision of the policy (server-populated). */
export interface PolicyVersion extends PolicyRules {
  /** Monotonic revision number; the current policy has the highest. */
  version: number;
  /** When this revision was written (RFC3339) and by which admin. */
  updated_at: string;
  updated_by: string;
}

/** Platform-wide policy & pricing rules (GET/PUT /v1/admin/policy).
 *  On GET the server also returns the current version and prior revisions. */
export interface AdminPolicy extends PolicyRules {
  /** Current revision number (server-populated on GET). */
  version?: number;
  /** Last-write metadata (server-populated on GET). */
  updated_at?: string;
  updated_by?: string;
  /** Prior revisions, newest first (server-populated on GET). */
  history?: PolicyVersion[];
}

/** A registered host (GET /v1/admin/hosts). */
export interface AdminHost {
  id: string;
  display_name: string;
  email: string;
  status: AccountStatus;
  /** Machines this host has advertised, and how many are online. */
  machines_total: number;
  machines_online: number;
  /** Lifetime earnings, in minor units. */
  earnings_total: number;
  created_at: string;
  suspended_at?: string;
  suspended_reason?: string;
}

/** A registered consumer account (GET /v1/admin/users). */
export interface AdminUser {
  id: string;
  display_name: string;
  email: string;
  status: AccountStatus;
  active_leases: number;
  /** Wallet balance, in minor units. */
  wallet_balance: number;
  /** Lifetime spend, in minor units. */
  spend_total: number;
  created_at: string;
  suspended_at?: string;
  suspended_reason?: string;
}

/** List envelopes returned by the collection endpoints. */
export interface AdminHostList {
  hosts: AdminHost[];
}
export interface AdminUserList {
  users: AdminUser[];
}

/** Body for suspend actions (unsuspend takes no body). */
export interface SuspendRequest {
  reason: string;
}

/** POST /v1/admin/refunds — refund a consumer against a lease/ledger entry. */
export interface RefundRequest {
  user_id: string;
  lease_id?: string;
  /** Amount to refund, in minor units. */
  amount: number;
  reason: string;
}

/** POST /v1/admin/adjustments — manual ledger credit/debit. */
export interface AdjustmentRequest {
  account_id: string;
  /** Signed amount in minor units: positive credits, negative debits. */
  amount: number;
  reason: string;
}

/** A settled financial action (refund or adjustment) returned by its POST. */
export interface LedgerMutationResult {
  id: string;
  account_id: string;
  amount: number;
  reason: string;
  created_at: string;
  created_by: string;
}

/** A single audit-log entry (GET /v1/admin/audit). */
export interface AuditEntry {
  id: string;
  /** Actor who performed the action (admin identity). */
  actor: string;
  /** Action verb, e.g. "host.suspend", "policy.update", "refund.create". */
  action: string;
  /** Affected resource type + id. */
  target_type: string;
  target_id: string;
  /** Free-form structured context for the action. */
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface AuditList {
  entries: AuditEntry[];
  /** Opaque cursor for the next page, when more entries exist. */
  next_cursor?: string;
}

/** Query params for the audit log. */
export interface AuditQuery {
  actor?: string;
  action?: string;
  target_id?: string;
  cursor?: string;
  limit?: number;
}

/** A ledger account with its running balance and recent entries
 *  (GET /v1/admin/ledger/accounts/:id). */
export interface LedgerAccount {
  id: string;
  /** Owning subject (host or user) and its kind. */
  owner_type: "host" | "user" | "platform";
  owner_id: string;
  /** Current balance, in minor units. */
  balance: number;
  currency: string;
  entries: LedgerEntry[];
}

export interface LedgerEntry {
  id: string;
  /** Signed amount in minor units. */
  amount: number;
  /** Running balance after this entry, in minor units. */
  balance_after: number;
  kind: string;
  reference?: string;
  created_at: string;
}
