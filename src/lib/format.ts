// Presentation helpers shared across admin views. Ledger amounts are integer
// minor units (cents); fees are basis points. Formatting is locale-fixed to
// "en-US" so tests and the UI agree regardless of the host environment.

/** Placeholder rendered for a missing/absent numeric value. */
export const PLACEHOLDER = "n/a";

/** Format an integer minor-unit amount (e.g. cents) as a currency string.
 *  A missing/non-finite amount renders as the placeholder rather than "$NaN",
 *  so callers can pass fields straight off a (possibly drifted) API response. */
export function formatMoney(
  minor: number | null | undefined,
  currency = "USD",
): string {
  if (minor == null || !Number.isFinite(minor)) return PLACEHOLDER;
  let cur = currency;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: cur }).format(
      minor / 100,
    );
  } catch {
    // An unrecognized currency code from the API must not crash formatting.
    cur = "USD";
    return new Intl.NumberFormat("en-US", { style: "currency", currency: cur }).format(
      minor / 100,
    );
  }
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

/** Format basis points as a percentage (500 -> "5%", 1250 -> "12.5%").
 *  A missing/non-finite value renders as the placeholder. */
export function formatBps(bps: number | null | undefined): string {
  if (bps == null || !Number.isFinite(bps)) return PLACEHOLDER;
  const pct = bps / 100;
  return `${pct.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

/** Format an integer count with thousands separators. A missing/non-finite
 *  value renders as the placeholder so a drifted or absent field never shows
 *  "NaN". */
export function formatNumber(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return PLACEHOLDER;
  return n.toLocaleString("en-US");
}

/** Format an RFC3339 timestamp for display; echoes the input if unparseable
 *  and renders the placeholder for a missing value. */
export function formatDateTime(iso: string | null | undefined): string {
  if (iso == null || iso === "") return PLACEHOLDER;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}
