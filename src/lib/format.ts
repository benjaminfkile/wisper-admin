// Presentation helpers shared across admin views. Ledger amounts are integer
// minor units (cents); fees are basis points. Formatting is locale-fixed to
// "en-US" so tests and the UI agree regardless of the host environment.

/** Format an integer minor-unit amount (e.g. cents) as a currency string. */
export function formatMoney(minor: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(minor / 100);
}

/** Parse a user-entered major-unit amount (e.g. "5", "5.00", "$5.5") into
 *  integer minor units (cents). Returns null when the input isn't a valid,
 *  non-negative amount with at most two decimal places. */
export function parseMoneyToMinor(value: string): number | null {
  const trimmed = value.trim().replace(/^\$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const num = Number(trimmed);
  if (Number.isNaN(num)) return null;
  return Math.round(num * 100);
}

/** Format basis points as a percentage (500 → "5%", 1250 → "12.5%"). */
export function formatBps(bps: number): string {
  const pct = bps / 100;
  return `${pct.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

/** Format an integer count with thousands separators. */
export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

/** Format an RFC3339 timestamp for display; echoes the input if unparseable. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}
