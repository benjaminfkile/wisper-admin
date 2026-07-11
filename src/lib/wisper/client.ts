import type { ErrorEnvelope, HealthResponse } from "./types";

// The app always calls same-origin `/wisper/*`; Next rewrites it to the Wisper API
// (see next.config.mjs), so there is no CORS in the browser.
const BASE = "/wisper";

/** A typed Wisper API error, parsed from the uniform envelope (docs/API.md §3). */
export class WisperError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "WisperError";
  }
}

/** Perform a JSON request against the Wisper API, throwing WisperError on non-2xx. */
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Accept: "application/json", ...(init?.headers ?? {}) },
  });

  if (!res.ok) {
    let code = "internal";
    let message = res.statusText || "request failed";
    let details: unknown;
    try {
      const body = (await res.json()) as Partial<ErrorEnvelope>;
      if (body.error) {
        code = body.error.code ?? code;
        message = body.error.message ?? message;
        details = body.error.details;
      }
    } catch {
      // Non-JSON error body; keep the status text.
    }
    throw new WisperError(res.status, code, message, details);
  }

  return (await res.json()) as T;
}

/** Liveness check against the Wisper API (docs/API.md §4). Never throws. */
export async function getHealth(): Promise<boolean> {
  try {
    const body = await request<HealthResponse>("/healthz");
    return body.status === "ok";
  } catch {
    return false;
  }
}
