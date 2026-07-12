// Idempotency keys for money-moving admin actions (refunds, adjustments). The
// same key is reused across retries of one logical submission so a network
// failure and re-click can't double-post; a fresh key is minted per new entry.

/** Generate an opaque idempotency key. Prefers crypto.randomUUID, with a
 *  timestamp-free fallback for environments without the Web Crypto API. */
export function newIdempotencyKey(): string {
  const c = typeof crypto !== "undefined" ? crypto : undefined;
  if (c?.randomUUID) return c.randomUUID();
  if (c?.getRandomValues) {
    const bytes = c.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Last-resort fallback: two 32-bit random hex chunks. Only reached in
  // non-browser environments without Web Crypto.
  const rand = () => Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");
  return `${rand()}${rand()}${rand()}${rand()}`;
}
