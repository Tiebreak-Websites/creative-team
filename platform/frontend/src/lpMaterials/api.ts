// API client for the LP Materials workspace (review avatars, section-card
// image sets, advertorial images). Mirrors the fetch pattern of the other
// self-contained clients.

import { API_BASE as BASE, asJson } from '../http'

const LPM_URL = `${BASE}/tools/lp-materials`

export interface AvatarRow {
  name: string
  language?: string
  country: string
  gender: 'female' | 'male'
  age: '20s' | '30s' | '40s' | '50s' | '60s'
}

export interface AvatarStyle {
  group_crop: boolean
  low_quality: boolean
  candid: boolean
  degrade: boolean
}

export interface MaterialItem {
  index: number
  label: string
  size: string
  status: 'pending' | 'running' | 'ok' | 'failed'
  error: string | null
  /** no-text QA warning when text sneaked into the image, else null */
  qa: string | null
  url: string | null
}

export interface MaterialJob {
  job_id: string
  kind: 'avatars' | 'cards' | 'advertorial'
  status: 'running' | 'done' | 'partial' | 'failed'
  error: string | null
  created_by: string
  created_at: string
  updated_at: string
  params: Record<string, unknown>
  items: MaterialItem[]
}

async function fail(r: Response, fallback: string): Promise<never> {
  const body = await asJson(r)
  const message =
    (typeof body.detail === 'string' && body.detail) ||
    (typeof body.error === 'string' && body.error) ||
    `${fallback} (HTTP ${r.status}).`
  throw new Error(message)
}

async function post<T>(path: string, payload: unknown, fallback: string): Promise<T> {
  const r = await fetch(`${LPM_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  })
  if (!r.ok) return fail(r, fallback)
  return r.json()
}

/** Names (any language) → detected {language, country, gender, age} rows. */
export async function detectNames(names: string[]): Promise<AvatarRow[]> {
  const d = await post<{ rows: AvatarRow[] }>('/avatars/detect', { names }, 'Name detection failed')
  return d.rows
}

export function createAvatars(rows: AvatarRow[], style: AvatarStyle): Promise<MaterialJob> {
  return post('/avatars', { rows, style }, 'Could not start the avatar job')
}

export function createCards(payload: {
  cards: { title: string; text: string }[]
  same_person: boolean
  aspect: string
  style_note?: string
}): Promise<MaterialJob> {
  return post('/cards', payload, 'Could not start the card set')
}

export function createAdvertorial(payload: {
  title: string
  text: string
  aspect: string
  candidates: number
}): Promise<MaterialJob> {
  return post('/advertorial', payload, 'Could not start the advertorial image')
}

export async function listJobs(): Promise<MaterialJob[]> {
  const r = await fetch(`${LPM_URL}/jobs`, { credentials: 'include' })
  if (!r.ok) return fail(r, 'Failed to load jobs')
  return (await r.json()).jobs ?? []
}

export async function getJob(jobId: string): Promise<MaterialJob> {
  const r = await fetch(`${LPM_URL}/jobs/${jobId}`, { credentials: 'include' })
  if (!r.ok) return fail(r, 'Failed to load the job')
  return r.json()
}

export function regenerateItem(jobId: string, index: number): Promise<MaterialJob> {
  return post(`/jobs/${jobId}/items/${index}/regenerate`, {}, 'Could not regenerate')
}

export async function deleteJob(jobId: string): Promise<void> {
  const r = await fetch(`${LPM_URL}/jobs/${jobId}`, { method: 'DELETE', credentials: 'include' })
  if (!r.ok) await fail(r, 'Could not delete the job')
}

export function itemUrl(jobId: string, index: number, download = false): string {
  return `${LPM_URL}/jobs/${jobId}/items/${index}.png${download ? '?download=1' : ''}`
}

export function zipUrl(jobId: string): string {
  return `${LPM_URL}/jobs/${jobId}/download.zip`
}
