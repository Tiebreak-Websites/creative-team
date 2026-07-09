// API client for the banner Edit workspace (text correction on an existing
// banner). Mirrors the fetch pattern of brandsApi.ts / sizesApi.ts.

import { API_BASE as BASE, asJson } from '../http'
import type { RunData } from '../types'

const EDITS_URL = `${BASE}/tools/banner-builder/edits`

/** The banner being corrected: a gallery pick OR an uploaded image. */
export type EditSource = { run_id: string; label: string } | { upload: string }

export interface DetectedBlock {
  x_pct: number
  y_pct: number
  w_pct: number
  h_pct: number
  text: string
}

export interface EditRegionInput {
  x_pct: number
  y_pct: number
  w_pct: number
  h_pct: number
  current_text?: string
  new_text: string
  hints?: string
}

export interface EditCandidate {
  index: number
  ready: boolean
  error: string | null
  /** true = the new text read back exactly; false = mismatch; null = QA unavailable */
  qa_ok: boolean | null
  qa_read: string
  url: string | null
}

export interface EditJob {
  job_id: string
  status: 'running' | 'done' | 'failed'
  error: string | null
  width: number
  height: number
  source_url: string
  candidates: (EditCandidate | null)[]
  created_at: string
}

async function fail(r: Response, fallback: string): Promise<never> {
  const body = await asJson(r)
  const message =
    (typeof body.detail === 'string' && body.detail) ||
    (typeof body.error === 'string' && body.error) ||
    `${fallback} (HTTP ${r.status}).`
  throw new Error(message)
}

/** Upload the banner to correct (PNG/JPG/WebP ≤10MB). */
export async function uploadEditSource(
  file: File,
): Promise<{ id: string; width: number; height: number; url: string }> {
  const fd = new FormData()
  fd.append('file', file)
  const r = await fetch(`${EDITS_URL}/source`, { method: 'POST', credentials: 'include', body: fd })
  if (!r.ok) return fail(r, 'Upload failed')
  return r.json()
}

/** Vision pass: every text block on the source (bbox in % + the text it reads). */
export async function detectText(
  source: EditSource,
): Promise<{ blocks: DetectedBlock[]; typography: string }> {
  const r = await fetch(`${EDITS_URL}/detect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ source }),
  })
  if (!r.ok) return fail(r, 'Text detection failed')
  return r.json()
}

/** Start a correction job (masked edit, N candidates). */
export async function createEdit(payload: {
  source: EditSource
  regions: EditRegionInput[]
  candidates: number
  typography?: string
}): Promise<EditJob> {
  const r = await fetch(EDITS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  })
  if (!r.ok) return fail(r, 'Could not start the correction')
  return r.json()
}

export async function getEditJob(jobId: string): Promise<EditJob> {
  const r = await fetch(`${EDITS_URL}/${jobId}`, { credentials: 'include' })
  if (!r.ok) return fail(r, 'Could not load the job')
  return r.json()
}

/** Accept a candidate → it becomes a normal run (gallery + add-sizes work). */
export async function acceptEdit(
  jobId: string,
  candidate: number,
  opts?: { title?: string; editedFrom?: { run_id: string; label: string } },
): Promise<RunData> {
  const r = await fetch(`${EDITS_URL}/${jobId}/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      candidate,
      title: opts?.title,
      edited_from: opts?.editedFrom,
    }),
  })
  if (!r.ok) return fail(r, 'Could not accept the candidate')
  return (await r.json()).run
}
