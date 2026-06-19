// Banner Builder request types + createRun for the campaign/card request shape.
//
// The shared src/api.ts createRun targets the legacy hook/brief request body.
// The reworked Banner Builder sends a campaign-settings menu + simple concept
// cards (Title / Subtitle / Button) — the engine concept is synthesized
// server-side — so it owns its own typed POST here. Polling, asset URLs, the
// zip link, and ApiError are reused from the shared api module unchanged.
import { ApiError } from '../api'
import type { RunData } from '../types'

const BASE = import.meta.env.VITE_API_BASE ?? '/api'

/** One concept card as the user types it. Engine fields are derived on the server. */
export interface ConceptCardPayload {
  key: string
  title: string
  subtitle?: string
  button?: string
}

/** Campaign settings menu + concept cards. */
export interface CampaignRunRequest {
  model: string
  quality: string
  locale: string
  sizes: string[]
  style?: string
  concepts: ConceptCardPayload[]
}

async function asJson(r: Response): Promise<any> {
  return r.json().catch(() => ({}))
}

export async function createRun(payload: CampaignRunRequest): Promise<RunData> {
  const r = await fetch(`${BASE}/tools/banner-builder/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (r.status === 202) return r.json()
  const body = await asJson(r)
  if (r.status === 424) {
    throw new ApiError(424, 'A required key is missing.', {
      missingSecrets: body.missing_secrets ?? [],
    })
  }
  if (r.status === 422) {
    const errors = body.detail?.errors ?? [String(body.detail ?? 'Validation failed')]
    throw new ApiError(422, 'Validation failed.', { errors })
  }
  throw new ApiError(r.status, `Run failed (HTTP ${r.status}).`)
}
