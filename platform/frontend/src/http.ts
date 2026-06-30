// Shared HTTP helpers for the API clients.
//
// Previously every client (api.ts, campaignApi.ts, brandsApi.ts) re-declared its
// own `const BASE` and a private `asJson`. This is the single source of truth so
// the base-URL handling and safe-JSON parsing don't drift apart.

/** API base — same-origin '/api' in dev (Vite proxies it) and in the single-origin deploy. */
export const API_BASE = import.meta.env.VITE_API_BASE ?? '/api'

/** Parse a response body as JSON, tolerating an empty/non-JSON body (returns {}). */
export async function asJson(r: Response): Promise<any> {
  return r.json().catch(() => ({}))
}
