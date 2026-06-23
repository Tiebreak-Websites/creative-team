// Brand & defaults — persisted in localStorage (per browser), read by the
// Banner Builder on mount to pre-seed the palette and campaign defaults. Set in
// the admin Settings screen. Frontend-only; the backend never sees these.

export interface BrandDefaults {
  scene: string | null // brand background/scene colour (hex)
  text: string | null // brand headline text colour (hex)
  colorMood: string | null // a COLOR_MOODS key
  model: string | null // default image model id
  quality: string | null // default render quality
  locale: string | null // default on-image language
}

export const EMPTY_BRAND: BrandDefaults = {
  scene: null,
  text: null,
  colorMood: null,
  model: null,
  quality: null,
  locale: null,
}

const KEY = 'tb.brand.v1'

export function loadBrand(): BrandDefaults {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return EMPTY_BRAND
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return EMPTY_BRAND
    return { ...EMPTY_BRAND, ...parsed }
  } catch {
    return EMPTY_BRAND
  }
}

export function saveBrand(b: BrandDefaults): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(b))
  } catch {
    /* best-effort (private mode / quota) */
  }
}
