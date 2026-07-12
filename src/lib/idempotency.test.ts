import { describe, expect, it } from "vitest";
import { newIdempotencyKey } from "./idempotency";

describe("newIdempotencyKey", () => {
  it("returns a non-empty string", () => {
    expect(newIdempotencyKey().length).toBeGreaterThan(0);
  });

  it("returns a fresh, distinct key each call", () => {
    const keys = new Set(Array.from({ length: 50 }, () => newIdempotencyKey()));
    expect(keys.size).toBe(50);
  });
});
