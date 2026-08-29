// TypeScript types for the Wisper API (see docs/API.md in the wisper-api repo).
// Expanded as endpoints are built; this is the shared foundation.
//
// ---------------------------------------------------------------------------
// CONTRACT AUTHORITY
// ---------------------------------------------------------------------------
// The admin surface below was LIVE-VERIFIED against a running wisper-api on
// 2026-07-20 (the first time this app ran against a real API — the API-key
// sign-in made it possible). Before then the shapes were guesses and had never
// been exercised; that drift crashed the overview and emptied the moderation /
// audit / policy lists. The AUTHORITATIVE contract is wisper-api's docs/API.md;
// these types mirror it plus the shapes captured on 2026-07-20:
//
//   GET /v1/admin/overview -> { currency, revenue_cents, wallet_liability_cents,
//       host_earnings_cents, active_lease_count, host_count, online_host_count,
//       user_count, health }
//   GET /v1/admin/hosts    -> { data: AdminHost[], next_offset }
//       item: { id, owner_user_id, name, label, status, last_seen_at, created_at, ... }
//   GET /v1/admin/users    -> { data: AdminUser[], next_offset }
//       item: { id, email, status, connect_status, has_stripe_customer,
//               has_connect_account, created_at }
//   GET /v1/admin/audit    -> { data: AuditEntry[], next_cursor }
//   GET /v1/admin/policy   -> { active, versions }
//
// Every collection is unwrapped tolerantly at the client boundary (admin.ts):
// a missing/misshaped envelope degrades to an empty list and numeric fields are
// optional, so a component never crashes on further shape drift — it renders a
// dash. When in doubt, docs/API.md wins over these declarations.
// ---------------------------------------------------------------------------

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

/** Requestable wisp isolation levels, weakest → strongest. The platform policy
 *  may set a `min_isolation` floor drawn from these values. */
export type IsolationLevel = "shared" | "sandboxed" | "vm";

// ---------------------------------------------------------------------------
// Admin surface (/v1/admin/*). Contract embedded here; the authoritative docs
// live in wisper-api (docs/API.md §admin). Amounts are integer minor units
// (e.g. cents) unless noted, matching the ledger. Every response field is
// optional so tolerant parsing + guarded formatting survive contract drift.
// ---------------------------------------------------------------------------

/** Suspension state shared by hosts and users. */
export type AccountStatus = "active" | "suspended";

/** Platform health rollup embedded in the overview. The API may return a plain
 *  status string or a small object; both are tolerated. */
export type AdminHealth =
  | string
  | { status?: string; [key: string]: unknown }
  | null;

/** GET /v1/admin/overview — platform snapshot for the dashboard (real keys,
 *  live-verified 2026-07-20). All numerics optional: a missing field renders a
 *  dash rather than crashing the tile. */
export interface AdminOverview {
  /** ISO currency code for the *_cents amounts below. */
  currency?: string;
  /** Gross platform revenue to date, in minor units. */
  revenue_cents?: number;
  /** Outstanding consumer wallet balances (a liability), in minor units. */
  wallet_liability_cents?: number;
  /** Earnings accrued to hosts, in minor units. */
  host_earnings_cents?: number;
  /** Currently active leases. */
  active_lease_count?: number;
  /** Registered hosts, and how many are currently online. */
  host_count?: number;
  online_host_count?: number;
  /** Registered consumer accounts. */
  user_count?: number;
  /** Platform health rollup (string or object; see AdminHealth). */
  health?: AdminHealth;
}

/** The editable policy fields (PUT /v1/admin/policy body — PolicyUpdateRequest).
 *  Only `fee_bps` is required; all others are optional (omit = unlimited/none).
 *  Amounts in cents (`*_cents`) must be sent as integer minor units. */
export interface PolicyRules {
  /** Platform take rate in basis points (0..10000, where 10000 = 100%). Required. */
  fee_bps: number;
  /** Minimum wallet top-up a consumer may make, in cents. */
  min_topup_cents?: number;
  /** Max concurrent leases a single consumer may hold. */
  max_concurrent_leases_per_user?: number;
  /** Maximum lease duration cap in seconds. */
  max_ttl_seconds_cap?: number;
  /** Minimum isolation floor for lease requests. `null` = no floor. When set,
   *  the API rejects consumers requesting a weaker isolation level. */
  min_isolation?: IsolationLevel | null;
  /** Maximum amount a new account may top up on their first top-up, in cents. */
  first_topup_max_cents?: number;
  /** Rolling window in hours for the new-account per-day top-up limit. */
  new_account_window_hours?: number;
  /** Max top-up per day for new accounts within the window, in cents. */
  new_account_max_topup_cents_per_day?: number;
  /** Platform-wide maximum spend per day, in cents. */
  max_spend_cents_per_day?: number;
  /** When this policy revision takes effect (ISO-8601). Omit for immediate. */
  effective_from?: string;
}

/** A single point-in-time policy revision returned by the server (PolicyView).
 *  Extends the PUT body with server-assigned metadata. All fields optional: a
 *  version may omit any of them. */
export interface PolicyVersion extends Partial<PolicyRules> {
  /** Server-assigned revision identifier. */
  id?: string;
  /** Who created this revision (admin identity). */
  created_by?: string;
  /** effective_from is inherited from Partial<PolicyRules>. */
}

/** GET /v1/admin/policy — the active policy plus its version history.
 *  Live-verified envelope (2026-07-20): `{ active, versions }`. */
export interface AdminPolicy {
  /** The current/active policy revision. */
  active?: PolicyVersion;
  /** All revisions, newest first (includes `active`). */
  versions?: PolicyVersion[];
}

/** A registered host (GET /v1/admin/hosts item). Live-verified fields
 *  2026-07-20; extras the API adds are ignored. */
export interface AdminHost {
  id: string;
  /** The user who owns this host. */
  owner_user_id?: string;
  /** Machine name and human label. */
  name?: string;
  label?: string;
  /** Moderation/account status (e.g. "active", "suspended"). */
  status?: string;
  /** Whether the agent is currently connected. */
  online?: boolean;
  wisp_version?: string;
  agent_version?: string;
  last_seen_at?: string;
  created_at?: string;
  /** Isolation levels this host can provide, weakest → strongest (a subset of
   *  the requestable {@link IsolationLevel}s). Wire key `isolation_levels`. */
  isolation_levels?: IsolationLevel[];
  /** The level applied when a lease doesn't request a stronger one. Wire key
   *  `default_isolation`. */
  default_isolation?: IsolationLevel;
  /** Present only on suspended hosts. */
  suspended_at?: string;
  suspended_reason?: string;
}

/** A registered consumer account (GET /v1/admin/users item). Live-verified
 *  fields 2026-07-20. */
export interface AdminUser {
  id: string;
  email?: string;
  /** Moderation/account status (e.g. "active", "suspended"). */
  status?: string;
  /** Stripe Connect onboarding status for hosts who also consume. */
  connect_status?: string;
  /** Whether the account has a Stripe customer / Connect account provisioned. */
  has_stripe_customer?: boolean;
  has_connect_account?: boolean;
  created_at?: string;
  /** Present only on suspended users. */
  suspended_at?: string;
  suspended_reason?: string;
}

/** Collection envelopes returned by the admin list endpoints. `data` is the
 *  page of items; the cursor/offset advances it. */
export interface AdminHostList {
  data: AdminHost[];
  next_offset?: number | string | null;
}
export interface AdminUserList {
  data: AdminUser[];
  next_offset?: number | string | null;
}

/** Query params shared by the paginated host/user list endpoints. The API
 *  honours `?query=` for a case-insensitive search across id / name / email
 *  (server-authoritative, so results beyond the first page are reachable),
 *  and `?limit` / `?offset` for cursor-less paging (the response's
 *  `next_offset` echoes the next page's starting offset when more rows
 *  exist). */
export interface AdminListQuery {
  query?: string;
  limit?: number;
  offset?: number;
}

/** Body for suspend actions (unsuspend takes no body). */
export interface SuspendRequest {
  reason: string;
}

/** POST /v1/admin/refunds — refund a consumer.
 *  `payment_intent` is optional; when provided it ties the refund to the
 *  specific Stripe PaymentIntent so the platform can reconcile it. The API
 *  does NOT accept `lease_id` — drop that field entirely. */
export interface RefundRequest {
  user_id: string;
  /** Optional Stripe PaymentIntent id to tie the refund to a specific charge. */
  payment_intent?: string;
  /** Amount to refund, in minor units (cents). */
  amount_cents: number;
  reason: string;
}

/** POST /v1/admin/adjustments — manual double-entry ledger transfer.
 *  The API uses a two-legged model: money moves from `debit_account_id` to
 *  `credit_account_id` by `amount_cents` (always positive). To credit a user
 *  account the UI maps the user account → credit leg and the platform clearing
 *  account → debit leg; debiting inverts the assignment. */
export interface AdjustmentRequest {
  debit_account_id: string;
  credit_account_id: string;
  /** Positive minor-unit amount. */
  amount_cents: number;
  reason: string;
}

/** Response from POST /v1/admin/adjustments. Models the double-entry
 *  transaction the API commits: the two operator-supplied account ids, the
 *  positive amount, and the resulting balances on each leg. Refunds do NOT
 *  return this shape; they return {@link RefundResponse} instead. */
export interface LedgerMutationResult {
  transaction_id: string;
  amount_cents?: number;
  debit_account_id?: string;
  credit_account_id?: string;
  debit_balance_cents?: number;
  credit_balance_cents?: number;
}

/** Response from POST /v1/admin/refunds. Refunds are Stripe-mediated, so the
 *  server's RefundResponse describes the refund itself (identifier, amount,
 *  status, and the consumer + Stripe anchor); it does NOT include the ledger
 *  fields (no `transaction_id`, `debit_account_id`, or `credit_account_id`).
 *  Any downstream ledger entries the API writes are visible through the
 *  ledger forensics view, not on this envelope. */
export interface RefundResponse {
  /** Server-assigned refund id. */
  refund_id: string;
  /** Consumer who was refunded. */
  user_id: string;
  /** Amount refunded, in minor units. */
  amount_cents: number;
  /** ISO currency code (e.g. "USD"), when the API includes one. */
  currency?: string;
  /** Refund lifecycle status (e.g. "succeeded", "pending", "failed"). */
  status: string;
  /** Stripe PaymentIntent id, when the refund is tied to a specific charge. */
  payment_intent?: string;
  /** Reason recorded on the refund. */
  reason?: string;
  created_at?: string;
}

/** A single audit-log entry (GET /v1/admin/audit). Field names are read
 *  tolerantly in the client (actor/actor_id/actor_email, target/target_*).
 *  The API returns the structured payload as `meta`; older/other names
 *  (metadata/context/details) are also accepted for resilience. */
export interface AuditEntry {
  id: string;
  /** Actor who performed the action (admin identity). */
  actor?: string;
  /** Action verb, e.g. "host.suspend", "policy.update", "refund.create". */
  action?: string;
  /** Affected resource type + id. */
  target_type?: string;
  target_id?: string;
  /** Free-form structured context for the action. */
  metadata?: Record<string, unknown>;
  created_at?: string;
}

/** GET /v1/admin/audit envelope: a page of entries + an opaque cursor. */
export interface AuditList {
  data: AuditEntry[];
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

/** A ledger account and its recent entries
 *  (GET /v1/admin/ledger/accounts/:id → { account, entries }). The wire
 *  envelope is unwrapped in admin.getLedgerAccount so callers see a single
 *  flat object: the account's fields plus `entries`. */
export interface LedgerAccount {
  id: string;
  /** Ledger account kind, e.g. "user_wallet", "platform_revenue",
   *  "host_earnings". */
  kind?: string;
  /** Owning user id (absent on platform accounts). */
  owner_user_id?: string;
  /** Current balance in minor units. */
  balance_cents?: number;
  currency?: string;
  entries: LedgerEntry[];
}

/** A single ledger entry (LedgerEntryView). Double-entry: exactly one of
 *  debit_cents / credit_cents is typically non-zero on a given account's
 *  entry. Amounts are positive minor units. */
export interface LedgerEntry {
  /** Debit posted to this account, in minor units (0 if this entry is a credit). */
  debit_cents?: number;
  /** Credit posted to this account, in minor units (0 if this entry is a debit). */
  credit_cents?: number;
  /** The double-entry transaction this leg belongs to. */
  transaction_id?: string;
  /** The lease that triggered this entry, when applicable. */
  lease_id?: string;
  created_at?: string;
}
