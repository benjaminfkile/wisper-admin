import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { admin } from "./admin";
import { setAuthTokenGetter, WisperError } from "./client";

type Call = { url: string; init: RequestInit };

/** Stub fetch, recording each call and replying with the given JSON/status. */
function stubFetch(reply: { status?: number; body?: unknown }): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      const status = reply.status ?? 200;
      const body = reply.body === undefined ? "" : JSON.stringify(reply.body);
      return new Response(body, {
        status,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return calls;
}

describe("admin client", () => {
  beforeEach(() => setAuthTokenGetter(() => "jwt-token"));
  afterEach(() => {
    vi.unstubAllGlobals();
    setAuthTokenGetter(() => null);
  });

  it("GET overview hits the proxied path with the bearer token", async () => {
    // Real /v1/admin/overview shape, live-verified 2026-07-20.
    const calls = stubFetch({
      body: {
        currency: "usd",
        revenue_cents: 100,
        wallet_liability_cents: 40,
        host_earnings_cents: 60,
        active_lease_count: 3,
        host_count: 5,
        online_host_count: 4,
        user_count: 8,
        health: "ok",
      },
    });
    const overview = await admin.getOverview();
    expect(overview.active_lease_count).toBe(3);
    expect(overview.revenue_cents).toBe(100);
    expect(calls[0].url).toBe("/wisper/v1/admin/overview");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(
      "Bearer jwt-token",
    );
  });

  it("getOverview tolerates an empty body without throwing", async () => {
    stubFetch({ body: undefined });
    await expect(admin.getOverview()).resolves.toEqual({});
  });

  it("listHosts returns the {data, next_offset} envelope and echoes the query/paging params on the URL", async () => {
    const calls = stubFetch({
      body: { data: [{ id: "h-1" }, { id: "h-2" }], next_offset: 25 },
    });
    const res = await admin.listHosts({ query: "acme", limit: 25, offset: 0 });
    expect(res.data.map((h) => h.id)).toEqual(["h-1", "h-2"]);
    expect(res.next_offset).toBe(25);
    // Query, limit, and offset are forwarded to the API, so the server (not
    // the client) decides which rows come back, and results past the first
    // page are reachable.
    expect(calls[0].url).toBe(
      "/wisper/v1/admin/hosts?query=acme&limit=25&offset=0",
    );
  });

  it("listHosts degrades a misshaped envelope to empty data + no next page", async () => {
    stubFetch({ body: { unexpected: true } });
    await expect(admin.listHosts()).resolves.toEqual({
      data: [],
      next_offset: null,
    });
  });

  it("listHosts omits empty query/limit/offset params from the URL", async () => {
    const calls = stubFetch({ body: { data: [], next_offset: null } });
    await admin.listHosts();
    expect(calls[0].url).toBe("/wisper/v1/admin/hosts");
  });

  it("listUsers returns the {data, next_offset} envelope with the paging params applied", async () => {
    const calls = stubFetch({
      body: {
        data: [
          {
            id: "u-1",
            email: "dana@example.com",
            status: "active",
            has_stripe_customer: true,
            has_connect_account: false,
          },
        ],
        next_offset: null,
      },
    });
    const res = await admin.listUsers({ limit: 25, offset: 25 });
    expect(res.data[0].email).toBe("dana@example.com");
    expect(res.next_offset).toBeNull();
    expect(calls[0].url).toBe("/wisper/v1/admin/users?limit=25&offset=25");
  });

  it("updatePolicy PUTs a JSON body with the real API field names", async () => {
    // Real PolicyUpdateRequest contract: fee_bps (not platform_fee_bps),
    // min_topup_cents (not min_topup), max_concurrent_leases_per_user (not
    // max_active_leases_per_user). Fields removed from API: min_price_per_hour,
    // max_price_per_hour, default_network.
    const policy = {
      fee_bps: 500,
      min_topup_cents: 1000,
      max_concurrent_leases_per_user: 4,
      max_ttl_seconds_cap: 3600,
      min_isolation: "sandboxed" as const,
      first_topup_max_cents: 5000,
      new_account_window_hours: 24,
      new_account_max_topup_cents_per_day: 10000,
      max_spend_cents_per_day: 100000,
    };
    const calls = stubFetch({ body: { active: policy, versions: [policy] } });
    await admin.updatePolicy(policy);
    expect(calls[0].url).toBe("/wisper/v1/admin/policy");
    expect(calls[0].init.method).toBe("PUT");
    const sent = JSON.parse(calls[0].init.body as string);
    expect(sent.fee_bps).toBe(500);
    expect(sent.min_topup_cents).toBe(1000);
    expect(sent.max_concurrent_leases_per_user).toBe(4);
    expect(sent.min_isolation).toBe("sandboxed");
    expect((calls[0].init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
  });

  it("suspendHost POSTs the reason to the right id", async () => {
    const calls = stubFetch({ body: { id: "h 1", status: "suspended" } });
    await admin.suspendHost("h 1", "abuse");
    expect(calls[0].url).toBe("/wisper/v1/admin/hosts/h%201/suspend");
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(calls[0].init.body as string).reason).toBe("abuse");
  });

  it("createRefund POSTs user_id + amount_cents (no lease_id) with an Idempotency-Key and returns the RefundResponse", async () => {
    // Real AdminRefundRequest: user_id, amount_cents, reason, optional payment_intent.
    // No lease_id: the API ignores it; payment_intent is the right optional anchor.
    // The real RefundResponse is exactly { refund_id, amount_cents, currency,
    // balance_cents }: the refund id, the amount that came off the wallet, the
    // currency, and the wallet's new balance. There is no user_id, status,
    // payment_intent, reason, created_at, or ledger-transaction field on it.
    const calls = stubFetch({
      body: {
        refund_id: "rfnd_1",
        amount_cents: 500,
        currency: "USD",
        balance_cents: 4500,
      },
    });
    const res = await admin.createRefund(
      { user_id: "u-1", amount_cents: 500, reason: "outage" },
      "idem-key-123",
    );
    expect(calls[0].url).toBe("/wisper/v1/admin/refunds");
    expect(calls[0].init.method).toBe("POST");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("idem-key-123");
    const body = JSON.parse(calls[0].init.body as string);
    expect(body).toMatchObject({ user_id: "u-1", amount_cents: 500, reason: "outage" });
    expect(body).not.toHaveProperty("lease_id");
    // The refund response is the four-field envelope.
    expect(res.refund_id).toBe("rfnd_1");
    expect(res.amount_cents).toBe(500);
    expect(res.currency).toBe("USD");
    expect(res.balance_cents).toBe(4500);
    expect(res).not.toHaveProperty("user_id");
    expect(res).not.toHaveProperty("status");
    expect(res).not.toHaveProperty("payment_intent");
    expect(res).not.toHaveProperty("transaction_id");
    expect(res).not.toHaveProperty("debit_account_id");
    expect(res).not.toHaveProperty("credit_account_id");
  });

  it("createRefund sends payment_intent when provided", async () => {
    const calls = stubFetch({
      body: {
        refund_id: "rfnd_2",
        amount_cents: 1000,
        currency: "USD",
        balance_cents: 0,
      },
    });
    const res = await admin.createRefund(
      { user_id: "u-2", payment_intent: "pi_abc123", amount_cents: 1000, reason: "dupe" },
      "idem-key-456",
    );
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.payment_intent).toBe("pi_abc123");
    expect(res.refund_id).toBe("rfnd_2");
    expect(res.balance_cents).toBe(0);
  });

  it("createAdjustment POSTs double-entry shape (debit/credit accounts, positive amount_cents)", async () => {
    // Real AdjustmentRequest: debit_account_id, credit_account_id, amount_cents (positive).
    // No signed `amount`, no bare `account_id`.
    const calls = stubFetch({
      body: {
        transaction_id: "txn-a1",
        amount_cents: 250,
        debit_account_id: "acct-9",
        credit_account_id: "platform",
        debit_balance_cents: -250,
        credit_balance_cents: 250,
      },
    });
    const result = await admin.createAdjustment(
      {
        debit_account_id: "acct-9",
        credit_account_id: "platform",
        amount_cents: 250,
        reason: "correction",
      },
      "idem-key-999",
    );
    expect(calls[0].url).toBe("/wisper/v1/admin/adjustments");
    expect((calls[0].init.headers as Record<string, string>)["Idempotency-Key"]).toBe(
      "idem-key-999",
    );
    const body = JSON.parse(calls[0].init.body as string);
    expect(body).toMatchObject({
      debit_account_id: "acct-9",
      credit_account_id: "platform",
      amount_cents: 250,
      reason: "correction",
    });
    expect(body).not.toHaveProperty("amount");
    expect(body).not.toHaveProperty("account_id");
    // Response carries the real AdjustmentResponse fields.
    expect(result.transaction_id).toBe("txn-a1");
    expect(result.amount_cents).toBe(250);
    expect(result.debit_account_id).toBe("acct-9");
    expect(result.credit_account_id).toBe("platform");
  });

  it("getAudit coerces numeric audit row ids to strings so React keys stay unique", async () => {
    // The wire id can arrive as a numeric primary key (not a string). If the
    // client dropped it, every row's id collapsed to "" and AuditLog's React
    // keys duplicated -- Load more silently deduped/dropped rows.
    stubFetch({
      body: {
        data: [
          { id: 101, action: "host.suspend" },
          { id: 102, action: "policy.update" },
        ],
      },
    });
    const res = await admin.getAudit();
    expect(res.data.map((e) => e.id)).toEqual(["101", "102"]);
    expect(new Set(res.data.map((e) => e.id)).size).toBe(res.data.length);
  });

  it("getAudit encodes query params and unwraps {data, next_cursor}, reading meta as the details payload", async () => {
    // Real AuditEntry: the API returns the structured payload as `meta`
    // (not metadata/context/details). The client must read `meta` so the
    // Details column is not blank.
    const calls = stubFetch({
      body: {
        data: [
          {
            id: "e-1",
            actor_id: "11111111-1111-4111-8111-111111111111",
            action: "host.suspend",
            target_type: "host",
            target_id: "22222222-2222-4222-8222-222222222222",
            meta: { reason: "fraud" },
            created_at: "2026-07-20T00:00:00Z",
          },
        ],
        next_cursor: "cursor-2",
      },
    });
    const res = await admin.getAudit({
      actor: "11111111-1111-4111-8111-111111111111",
      limit: 25,
    });
    expect(calls[0].url).toBe(
      "/wisper/v1/admin/audit?actor=11111111-1111-4111-8111-111111111111&limit=25",
    );
    // Tolerant normalization maps actor_id -> actor and meta -> metadata.
    expect(res.data[0]).toMatchObject({
      id: "e-1",
      actor: "11111111-1111-4111-8111-111111111111",
      action: "host.suspend",
      target_type: "host",
      metadata: { reason: "fraud" },
    });
    expect(res.next_cursor).toBe("cursor-2");
  });

  it("getPolicy unwraps the {active, versions} envelope with real PolicyView fields", async () => {
    // Real PolicyView: fee_bps (not platform_fee_bps); server-assigned id and
    // created_by (not version/updated_by); effective_from (not updated_at).
    stubFetch({
      body: {
        active: { id: "pol-3", fee_bps: 500, created_by: "admin@wisper.dev" },
        versions: [
          { id: "pol-3", fee_bps: 500, created_by: "admin@wisper.dev" },
          { id: "pol-2", fee_bps: 400, created_by: "founder@wisper.dev" },
        ],
      },
    });
    const policy = await admin.getPolicy();
    expect(policy.active?.id).toBe("pol-3");
    expect(policy.active?.fee_bps).toBe(500);
    expect(policy.active?.created_by).toBe("admin@wisper.dev");
    expect(policy.versions).toHaveLength(2);
  });

  it("getLedgerAccount flattens the {account, entries} envelope and exposes the real field names", async () => {
    // Real wire shape: `{ account: { id, kind, owner_user_id, currency,
    // balance_cents }, entries: [{ debit_cents, credit_cents, transaction_id,
    // lease_id, created_at }] }`. The client flattens the envelope so callers
    // see one flat LedgerAccount with the entries array attached.
    const calls = stubFetch({
      body: {
        account: {
          id: "acct-1",
          kind: "user_wallet",
          owner_user_id: "u-1",
          balance_cents: 50000,
          currency: "USD",
        },
        entries: [
          {
            credit_cents: 50000,
            debit_cents: 0,
            transaction_id: "txn-1",
            lease_id: "lease-9",
            created_at: "2026-07-20T00:00:00Z",
          },
        ],
      },
    });
    const account = await admin.getLedgerAccount("acct-1");
    expect(calls[0].url).toBe("/wisper/v1/admin/ledger/accounts/acct-1");
    expect(account.id).toBe("acct-1");
    expect(account.kind).toBe("user_wallet");
    expect(account.owner_user_id).toBe("u-1");
    expect(account.balance_cents).toBe(50000);
    expect(account.entries[0]).toMatchObject({
      credit_cents: 50000,
      debit_cents: 0,
      transaction_id: "txn-1",
      lease_id: "lease-9",
    });
  });

  it("getLedgerAccount degrades a missing envelope to an empty entries list without crashing", async () => {
    stubFetch({ body: { unexpected: true } });
    const account = await admin.getLedgerAccount("acct-9");
    expect(account.id).toBe("acct-9");
    expect(account.entries).toEqual([]);
  });

  it("surfaces the uniform error envelope as WisperError", async () => {
    stubFetch({
      status: 403,
      body: { error: { code: "forbidden", message: "not an admin", request_id: "r1" } },
    });
    await expect(admin.getOverview()).rejects.toMatchObject({
      status: 403,
      code: "forbidden",
      message: "not an admin",
    });
    await expect(admin.getOverview()).rejects.toBeInstanceOf(WisperError);
  });
});
