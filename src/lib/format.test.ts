import { describe, expect, it } from "vitest";
import { formatBps, formatDateTime, formatMoney, formatNumber } from "./format";

describe("format helpers", () => {
  it("formats minor units as currency", () => {
    expect(formatMoney(0)).toBe("$0.00");
    expect(formatMoney(1234)).toBe("$12.34");
    expect(formatMoney(100000)).toBe("$1,000.00");
    expect(formatMoney(-500)).toBe("-$5.00");
  });

  it("formats basis points as a percentage", () => {
    expect(formatBps(0)).toBe("0%");
    expect(formatBps(500)).toBe("5%");
    expect(formatBps(1250)).toBe("12.5%");
    expect(formatBps(10000)).toBe("100%");
  });

  it("formats integer counts with separators", () => {
    expect(formatNumber(7)).toBe("7");
    expect(formatNumber(12345)).toBe("12,345");
  });

  it("formats timestamps and passes through unparseable input", () => {
    expect(formatDateTime("not-a-date")).toBe("not-a-date");
    expect(formatDateTime("2026-07-12T00:00:00Z")).toMatch(/2026/);
  });
});
