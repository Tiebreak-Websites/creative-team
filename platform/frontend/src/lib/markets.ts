// Target markets an entity can operate in.
//
// Codes are ISO-3166 alpha-2, which is also the flag CDN's key — so a flag is
// derived straight from the code (see countryFlagUrl) with no second mapping to
// drift. Mirrors MARKETS in backend/app/brands.py, which validates on write:
// a code the backend doesn't know is dropped on save rather than stored.
//
// Declaration order is display order.

export type MarketRegion = 'EU' | 'GCC' | 'LATAM' | 'APAC' | 'NA' | 'OTHER'

export interface Market {
  /** ISO-3166 alpha-2, uppercase. */
  code: string
  name: string
  region: MarketRegion
}

export const MARKETS: Market[] = [
  { code: 'FR', name: 'France', region: 'EU' },
  { code: 'DE', name: 'Germany', region: 'EU' },
  { code: 'IT', name: 'Italy', region: 'EU' },
  { code: 'NO', name: 'Norway', region: 'EU' },
  { code: 'PL', name: 'Poland', region: 'EU' },
  { code: 'ES', name: 'Spain', region: 'EU' },
  { code: 'SE', name: 'Sweden', region: 'EU' },

  { code: 'BH', name: 'Bahrain', region: 'GCC' },
  { code: 'IN', name: 'India GCC', region: 'GCC' },
  { code: 'KW', name: 'Kuwait', region: 'GCC' },
  { code: 'OM', name: 'Oman', region: 'GCC' },
  { code: 'QA', name: 'Qatar', region: 'GCC' },
  { code: 'SA', name: 'Saudi Arabia', region: 'GCC' },
  { code: 'AE', name: 'UAE', region: 'GCC' },

  { code: 'AR', name: 'Argentina', region: 'LATAM' },
  { code: 'BR', name: 'Brazil', region: 'LATAM' },
  { code: 'CL', name: 'Chile', region: 'LATAM' },
  { code: 'CO', name: 'Colombia', region: 'LATAM' },
  { code: 'CR', name: 'Costa Rica', region: 'LATAM' },
  { code: 'EC', name: 'Ecuador', region: 'LATAM' },
  { code: 'SV', name: 'El Salvador', region: 'LATAM' },
  { code: 'MX', name: 'Mexico', region: 'LATAM' },
  { code: 'PE', name: 'Peru', region: 'LATAM' },
  { code: 'UY', name: 'Uruguay', region: 'LATAM' },

  { code: 'CN', name: 'China', region: 'APAC' },
  { code: 'JP', name: 'Japan', region: 'APAC' },
  { code: 'MY', name: 'Malaysia', region: 'APAC' },
  { code: 'SG', name: 'Singapore', region: 'APAC' },
  { code: 'TH', name: 'Thailand', region: 'APAC' },
  { code: 'VN', name: 'Vietnam', region: 'APAC' },

  { code: 'CA', name: 'Canada', region: 'NA' },

  // No region in the source list — grouped apart rather than guessed at.
  { code: 'ZA', name: 'South Africa', region: 'OTHER' },
]

export const MARKET_REGIONS: MarketRegion[] = ['EU', 'GCC', 'LATAM', 'APAC', 'NA', 'OTHER']

export const REGION_LABEL: Record<MarketRegion, string> = {
  EU: 'EU',
  GCC: 'GCC',
  LATAM: 'LATAM',
  APAC: 'APAC',
  NA: 'North America',
  OTHER: 'Unassigned',
}

const BY_CODE = new Map(MARKETS.map((m) => [m.code, m]))

export function marketByCode(code: string): Market | undefined {
  return BY_CODE.get((code || '').trim().toUpperCase())
}

/** Markets grouped for display, empty regions dropped. */
export function marketsByRegion(): { region: MarketRegion; items: Market[] }[] {
  return MARKET_REGIONS.map((region) => ({
    region,
    items: MARKETS.filter((m) => m.region === region),
  })).filter((g) => g.items.length > 0)
}
