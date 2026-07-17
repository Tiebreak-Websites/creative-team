// Self-contained API client for the Banner Builder "Brands" resource.
// Mirrors the fetch + throw-on-!ok pattern in ../api.ts and keeps the same
// VITE_API_BASE handling. Brand mutations are admin-only on the backend, so we
// send credentials explicitly (matching the tool-config writes in admin/).

import { API_BASE as BASE, asJson } from '../http'

const BRANDS_URL = `${BASE}/tools/banner-builder/brands`

/**
 * Three entity kinds, two roles. A `broker` is the product being sold. A
 * `whitelabel` is a routing/regulatory surface that fronts a brand (many-to-many,
 * rendered "WL › Brand"). An `academy` sells education instead of a broker
 * account — it behaves exactly like a broker; `kind` separates it only so admin
 * and reporting can bucket it.
 *
 * "Brand" is the umbrella for what's being sold (broker or academy), not a kind.
 * Mirrors ENTITY_KINDS in backend/app/brands.py, which validates on write.
 */
export type EntityKind = 'broker' | 'whitelabel' | 'academy'

export const ENTITY_KINDS: EntityKind[] = ['broker', 'whitelabel', 'academy']

export const KIND_LABEL: Record<EntityKind, string> = {
  broker: 'Broker',
  whitelabel: 'White label',
  academy: 'Academy',
}

export const KIND_HINT: Record<EntityKind, string> = {
  broker: 'The product being sold — who the customer transacts with.',
  whitelabel: 'A marketing surface that routes traffic to a broker.',
  academy: 'Sells education. Picks like a broker; counted separately.',
}

/** `broker` was originally called `brand`; anything persisted under the old name
 * still resolves. Mirrors _KIND_ALIASES in backend/app/brands.py. */
const KIND_ALIASES: Record<string, EntityKind> = { brand: 'broker' }

/**
 * The ONE name normaliser: lowercase, then [\s-]+ -> '-', then trim.
 * Byte-identical to `normalise_name` in backend/app/brands.py — any name
 * comparison or derived slug must route through it, so a lookup can never
 * disagree with a slug the way 'Digital-Spearhead' vs 'Digital Spearhead' did.
 */
export function normaliseName(name: string | null | undefined): string {
  return (name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Every spelling of "no white label" real data arrives with. Mirrors the
 * backend set — without it, direct-brand records fall through to the neutral
 * default instead of the brand's own colour. */
const NO_WHITELABEL = new Set([
  '', '-', '--', '—', '–', 'none', 'no-wl', 'no-white-label', 'n/a', 'na',
  'direct', 'no-whitelabel', 'null',
])

/** True when the value is any spelling of "no white label". */
export function isNoWhitelabel(value: string | null | undefined): boolean {
  return NO_WHITELABEL.has(normaliseName(value))
}

/** Neutral fallback when neither a white label nor a brand offers a colour. */
export const NEUTRAL_ACCENT = '#94A3B8'

/** One entity's colour contribution: explicit accent, else first palette colour. */
export function entityAccent(entity: Pick<Brand, 'accent' | 'colors'> | null | undefined): string | null {
  if (!entity) return null
  if (entity.accent && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(entity.accent)) {
    return entity.accent.toUpperCase()
  }
  return entity.colors?.[0] ?? null
}

/**
 * The single accent a card/stripe/tint resolves, in precedence order:
 *   1. the white label's colour, when a real WL is present
 *   2. the brand's colour, when there's no WL (or the WL has no colour)
 *   3. a neutral default
 * The white label is what the visitor actually sees, so it wins.
 */
export function resolveAccent(
  whitelabel: Brand | null | undefined,
  brand: Brand | null | undefined,
): string {
  return entityAccent(whitelabel) ?? entityAccent(brand) ?? NEUTRAL_ACCENT
}

/** Registry lookup by name, case- and separator-insensitive. */
export function findByName(entities: Brand[], name: string | null | undefined): Brand | null {
  const slug = normaliseName(name)
  if (!slug) return null
  return entities.find((e) => normaliseName(e.name) === slug) ?? null
}

const isActive = (e: Brand) => e.active !== false

/** An entity's kind, with any legacy alias resolved. */
export const kindOf = (e: Brand): EntityKind =>
  KIND_ALIASES[(e.kind as string) ?? ''] ?? e.kind ?? 'broker'

/** Everything selectable in a BRAND picker — brokers AND academies. */
export function brandOptions(entities: Brand[], includeRetired = false): Brand[] {
  return entities.filter(
    (e) => (kindOf(e) === 'broker' || kindOf(e) === 'academy') && (includeRetired || isActive(e)),
  )
}

/** Everything selectable in a WHITE-LABEL picker — never an academy. */
export function whitelabelOptions(entities: Brand[], includeRetired = false): Brand[] {
  return entities.filter((e) => kindOf(e) === 'whitelabel' && (includeRetired || isActive(e)))
}

/** The academy admin/reporting bucket — a subset of brandOptions(), not a role. */
export function academyOptions(entities: Brand[], includeRetired = false): Brand[] {
  return entities.filter((e) => kindOf(e) === 'academy' && (includeRetired || isActive(e)))
}

/** One palette colour with an optional human role (e.g. "Primary · CTA"). */
export interface BrandSwatch {
  hex: string
  role: string
}

/** A reusable brand: name, palette, optional logo, plus optional brand-kit hints. */
export interface Brand {
  id: string
  name: string
  /** Registry role — drives every picker, filter and bucket. Defaults to 'brand'
   * for records saved before the entity model existed. */
  kind?: EntityKind
  /** Retired entities keep rendering on historical records but are filtered out
   * of every picker. Entities are retired, never deleted. */
  active?: boolean
  /** Server-resolved accent (accent > first palette colour > null), so clients
   * don't each re-derive it. */
  resolved_accent?: string | null
  colors: string[]
  /** The square registry mark shown in lists and cards. Distinct from logo_svg:
   * icons carry an opaque plate, so they aren't composited onto banners. */
  icon_svg?: string | null
  logo_svg: string | null
  /** Optional dark-theme logo variant (white lettering) — shown wherever the
   * app renders the logo on dark surfaces. */
  logo_svg_dark?: string | null
  /** Typography hint folded into the art direction (e.g. "Inter / geometric sans"). */
  font?: string | null
  /** Preferred CTA / accent hex hint (the director still ensures contrast). */
  accent?: string | null
  /** Tone of voice folded into the art direction (e.g. "confident, concise"). */
  voice?: string | null
  /** Built-in brands ship with the app: always present; edits are stored as
   * overrides (deleting a built-in resets it to the shipped defaults). */
  builtin?: boolean
  /** Optional role-annotated palette (built-ins) for the showcase card. */
  swatches?: BrandSwatch[]
  /** Landing-page token hints (website background / card fill). */
  lp?: { bg?: string; card?: string }
}

/** Fields accepted when creating a brand. */
export interface BrandInput {
  name: string
  kind?: EntityKind
  active?: boolean
  colors: string[]
  icon_svg?: string | null
  logo_svg: string | null
  logo_svg_dark?: string | null
  font?: string | null
  accent?: string | null
  voice?: string | null
}

/** Partial update — any subset of the brand's editable fields. */
export type BrandPatch = Partial<BrandInput>

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
