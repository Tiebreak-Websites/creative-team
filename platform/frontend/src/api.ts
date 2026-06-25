import type {
  Meta,
  RunData,
  SecretFlag,
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

/** Zip one banner version's sizes → v{N}-{title}.zip (files v{N}-{size}-{title}.png). */
export function versionZipUrl(runId: string, concept: string, v: number, title: string): string {
  const q = new URLSearchParams({ concept, v: String(v), title: title || '' })
  return assetUrl(`/api/tools/banner-builder/runs/${runId}/version.zip?${q.toString()}`)
}

/** Zip a hand-picked set of banners → banners-selected.zip. Items are {runId,label}. */
export function selectionZipUrl(items: { runId: string; label: string }[]): string {
  const q = items.map((i) => `${i.runId}:${i.label}`).join(',')
  return assetUrl(`/api/tools/banner-builder/selection.zip?items=${encodeURIComponent(q)}`)
}

/** Cancel an in-progress run; the runner stops between frames and settles to `cancelled`. */
export async function cancelRun(runId: string): Promise<void> {
  await fetch(`${BASE}/tools/banner-builder/runs/${runId}/cancel`, { method: 'POST' }).catch(() => {})
}

/** Delete one banner for EVERYONE — removes the PNG from the disk + the shared gallery. */
export async function deleteBanner(runId: string, label: string): Promise<void> {
  await fetch(
    `${BASE}/tools/banner-builder/runs/${runId}/banners/${encodeURIComponent(label)}.png`,
    { method: 'DELETE' },
  ).catch(() => {})
}

/** Upload 1–4 style-reference images; returns server ids to pass in the run payload. */
export async function uploadReferences(files: File[]): Promise<string[]> {
  const fd = new FormData()
  files.forEach((f) => fd.append('files', f))
  const r = await fetch(`${BASE}/tools/banner-builder/references`, { method: 'POST', body: fd })
  if (!r.ok) {
    const body = await asJson(r)
    throw new ApiError(
      r.status,
      typeof body.detail === 'string' ? body.detail : `Upload failed (HTTP ${r.status})`,
    )
  }
  return (await r.json()).ids ?? []
}

export interface DetectedConcept {
  title: string
  subtitle?: string
  button?: string
}

/** Detect Title / Subtitle / Button from a pasted copy deck → concept cards. */
export async function parseCopy(text: string): Promise<DetectedConcept[]> {
  const r = await fetch(`${BASE}/tools/banner-builder/parse-copy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  if (!r.ok) throw new ApiError(r.status, `Copy detection failed (HTTP ${r.status}).`)
  return (await r.json()).concepts ?? []
}
