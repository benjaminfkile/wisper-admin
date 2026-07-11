import { afterEach, describe, expect, it, vi } from "vitest";
import { getHealth, WisperError } from "./client";

describe("wisper client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("getHealth returns true when the API reports ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ status: "ok" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    expect(await getHealth()).toBe(true);
  });

  it("getHealth returns false on a network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    expect(await getHealth()).toBe(false);
  });

  it("WisperError carries status, code, and message", () => {
    const err = new WisperError(402, "insufficient_funds", "wallet too low");
    expect(err.status).toBe(402);
    expect(err.code).toBe("insufficient_funds");
    expect(err.message).toBe("wallet too low");
  });
});
