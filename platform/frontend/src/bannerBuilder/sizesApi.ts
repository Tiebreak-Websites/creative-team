// Self-contained API client for the Banner Builder size configuration:
// the shared size GROUPS (one organization used by the dashboard's left rail
// AND the add-sizes picker), one-click size BUNDLES, and user-added CUSTOM
// sizes. Mirrors the fetch pattern of brandsApi.ts.

import { API_BASE as BASE, asJson } from '../http'

const CONFIG_URL = `${BASE}/tools/banner-builder/size-config`

/** One collapsible group of sizes (list order = display order). */
export interface SizeGroup {
  id: string
  label: string
  sizes: string[]
}

/** A one-click set of sizes (e.g. "Standard bundle"). */
export interface SizeBundle {
  id: string
  label: string
  sizes: string[]
}

export interface SizeConfig {
  groups: SizeGroup[]
  bundles: SizeBundle[]
  /** Every size the app can generate right now (built-ins + registered customs). */
  sizes: string[]
  master_size: string
  /** Id of the special group new custom sizes land in. */
  custom_group_id: string
  /** False when the last write did not reach the server disk — the change holds
   * for now but may be lost on a restart (admin UI shows a warning). */
  persisted?: boolean
}

async function fail(r: Response, fallback: string): Promise<never> {
  const body = await asJson(r)
  const message =
    (typeof body.detail === 'string' && body.detail) ||
    (typeof body.error === 'string' && body.error) ||
    `${fallback} (HTTP ${r.status}).`
  throw new Error(message)
}

/** GET the shared size configuration. */
export async function getSizeConfig(): Promise<SizeConfig> {
  const r = await fetch(CONFIG_URL, { credentials: 'include' })
  if (!r.ok) return fail(r, 'Failed to load size groups')
  return r.json()
}

/** POST one custom size (e.g. "500x500") — any logged-in user; it lands in the
 * shared "Custom sizes" group. Returns the refreshed config. */
export async function addCustomSize(size: string): Promise<SizeConfig> {
  const r = await fetch(`${CONFIG_URL}/custom`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ size }),
  })
  if (!r.ok) return fail(r, 'Failed to add the custom size')
  return r.json()
}

/** PUT the whole organization (admin): groups in display order + bundles. */
export async function saveSizeConfig(payload: {
  groups: SizeGroup[]
  bundles: SizeBundle[]
}): Promise<SizeConfig> {
  const r = await fetch(CONFIG_URL, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  })
  if (!r.ok) return fail(r, 'Failed to save size groups')
  return r.json()
}
