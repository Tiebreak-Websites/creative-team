import type {
  Meta,
  RunData,
  SecretFlag,
  SuggestedConcept,
  ToolsResponse,
} from './types'

const BASE = import.meta.env.VITE_API_BASE ?? '/api'

export class ApiError extends Error {
  status: number
  errors?: string[]
  missingSecrets?: SecretFlag[]
  constructor(
    status: number,
    message: string,
    opts?: { errors?: string[]; missingSecrets?: SecretFlag[] },
  ) {
    super(message)
    this.status = status
    this.errors = opts?.errors
    this.missingSecrets = opts?.missingSecrets
  }
}

async function asJson(r: Response): Promise<any> {
  return r.json().catch(() => ({}))
}

/** Map a backend-provided "/api/..." asset path to the configured base. */
export function assetUrl(backendPath: string): string {
  if (BASE === '/api') return backendPath
  return BASE + backendPath.replace(/^\/api/, '')
}

export async function fetchTools(): Promise<ToolsResponse> {
  const r = await fetch(`${BASE}/tools`)
  if (!r.ok) throw new ApiError(r.status, `Failed to load tools (HTTP ${r.status})`)
  return r.json()
}

export async function fetchMeta(): Promise<Meta> {
  const r = await fetch(`${BASE}/meta`)
  if (!r.ok) throw new ApiError(r.status, `Failed to load meta (HTTP ${r.status})`)
  return r.json()
}

export interface ConceptPayload {
  key: string
  title: string
  locale: string
  hook_phrase: string
  creative_brief: string
  cta?: string
  button_combo?: [string, string]
}

export interface RunRequest {
  banner_text: string
  locale: string
  model: string
  quality: string
  sizes: string[]
  concepts: ConceptPayload[]
}

export async function createRun(payload: RunRequest): Promise<RunData> {
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

export async function getRun(runId: string): Promise<RunData> {
  const r = await fetch(`${BASE}/tools/banner-builder/runs/${runId}`)
  if (!r.ok) throw new ApiError(r.status, `Failed to poll run (HTTP ${r.status})`)
  return r.json()
}

export function zipUrl(runId: string): string {
  return assetUrl(`/api/tools/banner-builder/runs/${runId}/download.zip`)
}

/** Zip every ok PNG across several runs (used by "Download all" once runs accumulate). */
export function zipAllUrl(runIds: string[]): string {
  return assetUrl(`/api/tools/banner-builder/download_all.zip?ids=${runIds.join(',')}`)
}

export interface SuggestRequest {
  banner_text: string
  cta?: string
  locale: string
  concept_count: number
}

export async function suggestConcepts(payload: SuggestRequest): Promise<SuggestedConcept[]> {
  const r = await fetch(`${BASE}/tools/banner-builder/suggest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await asJson(r)
  if (r.ok) return body.concepts ?? []
  if (r.status === 503) throw new ApiError(503, body.error ?? 'AI-assist unavailable.')
  if (r.status === 422) {
    throw new ApiError(422, 'AI brief failed validation.', {
      errors: body.detail?.errors ?? ['Could not produce valid concepts.'],
    })
  }
  throw new ApiError(r.status, `AI-assist failed (HTTP ${r.status}).`)
}
