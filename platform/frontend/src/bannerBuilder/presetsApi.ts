// API client for the Banner Builder "Presets" resource — saved campaign setups
// (sizes + art direction + brand + model/quality/effort + locale + concept cards)
// that pre-fill the form in one click. Mirrors brandsApi.ts.
import { API_BASE as BASE, asJson } from '../http'
import type { ArtDirection } from './artDirection'
import type { ConceptCardPayload } from './campaignApi'

const PRESETS_URL = `${BASE}/tools/banner-builder/presets`

/** The campaign config a preset captures. Opaque to the backend (stored verbatim). */
export interface PresetData {
  sizes?: string[]
  style?: string
  art?: ArtDirection
  brandId?: string | null
  logoCorner?: 'tl' | 'tr' | 'bl' | 'br' | null
  model?: string
  quality?: string
  effort?: string
  locale?: string
  concepts?: ConceptCardPayload[]
}

export interface Preset {
  id: string
  name: string
  created_by: string
  created_at: string
  data: PresetData
}

async function fail(r: Response, fallback: string): Promise<never> {
  const body = await asJson(r)
  const message =
    (typeof body.detail === 'string' && body.detail) ||
    (typeof body.error === 'string' && body.error) ||
    `${fallback} (HTTP ${r.status}).`
  throw new Error(message)
}

export async function listPresets(): Promise<Preset[]> {
  const r = await fetch(PRESETS_URL, { credentials: 'include' })
  if (!r.ok) return fail(r, 'Failed to load presets')
  return (await r.json()).presets ?? []
}

export async function createPreset(name: string, data: PresetData): Promise<Preset> {
  const r = await fetch(PRESETS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ name, data }),
  })
  if (!r.ok) return fail(r, 'Failed to save preset')
  return (await r.json()).preset
}

export async function deletePreset(id: string): Promise<void> {
  const r = await fetch(`${PRESETS_URL}/${id}`, { method: 'DELETE', credentials: 'include' })
  if (!r.ok) await fail(r, 'Failed to delete preset')
}
