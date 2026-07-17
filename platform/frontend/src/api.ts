import type {
  Meta,
  RunData,
  SecretFlag,
  ToolsResponse,
} from './types'
import { API_BASE as BASE, asJson } from './http'

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

/** Re-roll ONE banner (a single size) in place. Returns the updated run, or throws
 * (409 if it can't be regenerated, e.g. the master image is gone). Owner-only.
 *
 * promptOverride: pass an edited prompt to re-roll from it verbatim (it sticks for
 * future re-rolls); pass '' to reset back to the generated prompt; omit (undefined)
 * for a plain re-roll that keeps whatever prompt the frame already uses. */
export async function regenerateBanner(
  runId: string,
  label: string,
  promptOverride?: string,
): Promise<RunData> {
  const r = await fetch(
    `${BASE}/tools/banner-builder/runs/${runId}/banners/${encodeURIComponent(label)}/regenerate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(promptOverride === undefined ? {} : { prompt_override: promptOverride }),
    },
  )
  if (!r.ok) {
    const body = await asJson(r)
    const detail = typeof body.detail === 'string' ? body.detail : `Regenerate failed (HTTP ${r.status}).`
    throw new ApiError(r.status, detail)
  }
  return r.json()
}

/** Add more sizes to an already-approved version → recompose them off its master.
 * Returns the updated run; the caller should resume polling. Owner-only (409 if the
 * version was rejected or its master image is gone). */
export async function addSizes(runId: string, concept: string, sizes: string[]): Promise<RunData> {
  const r = await fetch(`${BASE}/tools/banner-builder/runs/${runId}/sizes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ concept, sizes }),
  })
  if (!r.ok) {
    const body = await asJson(r)
    const detail = typeof body.detail === 'string' ? body.detail : `Add sizes failed (HTTP ${r.status}).`
    throw new ApiError(r.status, detail)
  }
  return r.json()
}

export interface BulkDeleteResult {
  deleted_runs: number
  deleted_banners: number
  freed_bytes: number
  errors: string[]
}

/**
 * Admin disk cleanup — delete whole runs and/or individual banners in one call.
 * Removes the real files from the mounted disk; returns counts + bytes reclaimed.
 */
export async function bulkDelete(payload: {
  runs?: string[]
  banners?: { runId: string; label: string }[]
}): Promise<BulkDeleteResult> {
  const body = {
    runs: payload.runs ?? [],
    banners: (payload.banners ?? []).map((b) => ({ run_id: b.runId, label: b.label })),
  }
  const r = await fetch(`${BASE}/tools/banner-builder/runs/bulk-delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new ApiError(r.status, `Delete failed (HTTP ${r.status}).`)
  return r.json()
}

export interface StorageInfo {
  used_bytes: number
  total_bytes: number
  free_bytes: number
}

/** Disk usage of the banner artifact disk (used / total / free bytes). */
export async function fetchStorage(): Promise<StorageInfo> {
  const r = await fetch(`${BASE}/tools/banner-builder/storage`)
  if (!r.ok) throw new ApiError(r.status, `Failed to load storage (HTTP ${r.status})`)
  return r.json()
}

/** Owner approves version(s) → recompose to all sizes. Omit concepts to approve all awaiting. */
export async function approveConcepts(runId: string, concepts?: string[]): Promise<void> {
  const r = await fetch(`${BASE}/tools/banner-builder/runs/${runId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(concepts && concepts.length ? { concepts } : {}),
  })
  if (!r.ok) throw new ApiError(r.status, `Approve failed (HTTP ${r.status}).`)
}

/** Owner rejects version(s) — keep the MVP only, skip recompose. */
export async function rejectConcepts(runId: string, concepts: string[]): Promise<void> {
  const r = await fetch(`${BASE}/tools/banner-builder/runs/${runId}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ concepts }),
  })
  if (!r.ok) throw new ApiError(r.status, `Reject failed (HTTP ${r.status}).`)
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
