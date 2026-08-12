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

  it("listHosts unwraps the {data, next_offset} envelope", async () => {
    const calls = stubFetch({
      body: { data: [{ id: "h-1" }, { id: "h-2" }], next_offset: 2 },
    });
    const hosts = await admin.listHosts();
    expect(hosts.map((h) => h.id)).toEqual(["h-1", "h-2"]);
    expect(calls[0].url).toBe("/wisper/v1/admin/hosts");
  });

  it("listHosts degrades a misshaped envelope to an empty list", async () => {
    stubFetch({ body: { unexpected: true } });
    await expect(admin.listHosts()).resolves.toEqual([]);
  });

  it("listUsers unwraps the {data, next_offset} envelope", async () => {
    stubFetch({
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
    const users = await admin.listUsers();
    expect(users[0].email).toBe("dana@example.com");
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
      host_signups_enabled: true,
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

  it("createRefund POSTs the body with an Idempotency-Key header", async () => {
    const calls = stubFetch({ body: { id: "r-1", account_id: "acct-1", amount: 500 } });
    await admin.createRefund(
      { user_id: "u-1", lease_id: "l-1", amount_cents: 500, reason: "outage" },
      "idem-key-123",
    );
    expect(calls[0].url).toBe("/wisper/v1/admin/refunds");
    expect(calls[0].init.method).toBe("POST");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("idem-key-123");
    const body = JSON.parse(calls[0].init.body as string);
    expect(body).toMatchObject({ user_id: "u-1", amount_cents: 500, reason: "outage" });
  });

  it("createAdjustment POSTs a signed amount with an Idempotency-Key", async () => {
    const calls = stubFetch({ body: { id: "a-1", account_id: "acct-9", amount: -250 } });
    await admin.createAdjustment(
      { account_id: "acct-9", amount: -250, reason: "correction" },
      "idem-key-999",
    );
    expect(calls[0].url).toBe("/wisper/v1/admin/adjustments");
    expect((calls[0].init.headers as Record<string, string>)["Idempotency-Key"]).toBe(
      "idem-key-999",
    );
    expect(JSON.parse(calls[0].init.body as string).amount).toBe(-250);
  });

  it("getAudit encodes query params and unwraps {data, next_cursor}", async () => {
    const calls = stubFetch({
      body: {
        data: [
          {
            id: "e-1",
            actor_id: "admin@wisper.dev",
            action: "host.suspend",
            target_type: "host",
            target_id: "h-2",
            context: { reason: "fraud" },
            created_at: "2026-07-20T00:00:00Z",
          },
        ],
        next_cursor: "cursor-2",
      },
    });
    const res = await admin.getAudit({ actor: "admin@wisper.dev", limit: 25 });
    expect(calls[0].url).toBe(
      "/wisper/v1/admin/audit?actor=admin%40wisper.dev&limit=25",
    );
    // Tolerant normalization maps actor_id -> actor and context -> metadata.
    expect(res.data[0]).toMatchObject({
      id: "e-1",
      actor: "admin@wisper.dev",
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

  it("getLedgerAccount targets the account path", async () => {
    const calls = stubFetch({ body: { id: "acct-1", entries: [] } });
    await admin.getLedgerAccount("acct-1");
    expect(calls[0].url).toBe("/wisper/v1/admin/ledger/accounts/acct-1");
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
