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
    const calls = stubFetch({
      body: {
        revenue_total: 100,
        revenue_30d: 10,
        active_leases: 3,
        hosts_total: 5,
        hosts_suspended: 1,
        users_total: 8,
        users_suspended: 0,
        pending_payouts: 42,
        generated_at: "2026-07-12T00:00:00Z",
      },
    });
    const overview = await admin.getOverview();
    expect(overview.active_leases).toBe(3);
    expect(calls[0].url).toBe("/wisper/v1/admin/overview");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(
      "Bearer jwt-token",
    );
  });

  it("listHosts unwraps the {hosts} envelope", async () => {
    stubFetch({ body: { hosts: [{ id: "h-1" }, { id: "h-2" }] } });
    const hosts = await admin.listHosts();
    expect(hosts.map((h) => h.id)).toEqual(["h-1", "h-2"]);
  });

  it("updatePolicy PUTs a JSON body", async () => {
    const policy = {
      platform_fee_bps: 500,
      min_price_per_hour: 1,
      max_price_per_hour: 100,
      min_topup: 500,
      default_network: "egress" as const,
      max_active_leases_per_user: 4,
      host_signups_enabled: true,
    };
    const calls = stubFetch({ body: policy });
    await admin.updatePolicy(policy);
    expect(calls[0].url).toBe("/wisper/v1/admin/policy");
    expect(calls[0].init.method).toBe("PUT");
    expect(JSON.parse(calls[0].init.body as string).platform_fee_bps).toBe(500);
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

  it("getAudit encodes query params", async () => {
    const calls = stubFetch({ body: { entries: [] } });
    await admin.getAudit({ actor: "admin@wisper.dev", limit: 25 });
    expect(calls[0].url).toBe(
      "/wisper/v1/admin/audit?actor=admin%40wisper.dev&limit=25",
    );
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
