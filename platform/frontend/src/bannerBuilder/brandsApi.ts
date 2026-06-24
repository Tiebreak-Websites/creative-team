// Self-contained API client for the Banner Builder "Brands" resource.
// Mirrors the fetch + throw-on-!ok pattern in ../api.ts and keeps the same
// VITE_API_BASE handling. Brand mutations are admin-only on the backend, so we
// send credentials explicitly (matching the tool-config writes in admin/).

const BASE = import.meta.env.VITE_API_BASE ?? '/api'

const BRANDS_URL = `${BASE}/tools/banner-builder/brands`

/** One palette colour with an optional human role (e.g. "Primary · CTA"). */
export interface BrandSwatch {
  hex: string
  role: string
}

/** A reusable brand: a name, an ordered palette, and an optional inline SVG logo. */
export interface Brand {
  id: string
  name: string
  colors: string[]
  logo_svg: string | null
  /** Built-in brands ship with the app: always present, not editable/deletable. */
  builtin?: boolean
  /** Optional role-annotated palette (built-ins) for the showcase card. */
  swatches?: BrandSwatch[]
}

/** Fields accepted when creating a brand. */
export interface BrandInput {
  name: string
  colors: string[]
  logo_svg: string | null
}

/** Partial update — any subset of the brand's editable fields. */
export type BrandPatch = Partial<BrandInput>

async function asJson(r: Response): Promise<any> {
  return r.json().catch(() => ({}))
}

/** Throw a useful Error for a failed response, preferring a backend `detail`/`error`. */
async function fail(r: Response, fallback: string): Promise<never> {
  const body = await asJson(r)
  const message =
    (typeof body.detail === 'string' && body.detail) ||
    (typeof body.error === 'string' && body.error) ||
    `${fallback} (HTTP ${r.status}).`
  throw new Error(message)
}

/** GET all brands. */
export async function listBrands(): Promise<Brand[]> {
  const r = await fetch(BRANDS_URL, { credentials: 'include' })
  if (!r.ok) return fail(r, 'Failed to load brands')
  const body = await r.json()
  return body.brands ?? []
}

/** POST a new brand, returning the created record. */
export async function createBrand(input: BrandInput): Promise<Brand> {
  const r = await fetch(BRANDS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input),
  })
  if (!r.ok) return fail(r, 'Failed to create brand')
  const body = await r.json()
  return body.brand
}

/** PUT a partial update to one brand, returning the updated record. */
export async function updateBrand(id: string, patch: BrandPatch): Promise<Brand> {
  const r = await fetch(`${BRANDS_URL}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(patch),
  })
  if (!r.ok) return fail(r, 'Failed to update brand')
  const body = await r.json()
  return body.brand
}

/** DELETE one brand. Resolves on the expected 204 (or any 2xx). */
export async function deleteBrand(id: string): Promise<void> {
  const r = await fetch(`${BRANDS_URL}/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  if (!r.ok) await fail(r, 'Failed to delete brand')
}
