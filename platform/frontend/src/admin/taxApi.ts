// Admin taxonomy lists — Target Markets and Domains. Same edit-whole-list
// contract the language registry uses.

import { API_BASE, asJson } from '../http'

export interface Market {
  code: string
  label: string
  /** LATAM | GCC | NA | APAC | EU | '' (ungrouped) */
  region: string
}

export const REGIONS = ['LATAM', 'GCC', 'NA', 'APAC', 'EU'] as const

export interface Domain {
  domain: string
  note: string
}

async function fail(r: Response, fallback: string): Promise<never> {
  const body = await asJson(r)
  throw new Error(
    (typeof body.detail === 'string' && body.detail) || `${fallback} (HTTP ${r.status}).`)
}

export async function getMarkets(): Promise<Market[]> {
  const r = await fetch(`${API_BASE}/admin/markets`, { credentials: 'include' })
  if (!r.ok) return fail(r, 'Could not load markets')
  return (await r.json()).markets ?? []
}

export async function putMarkets(markets: Market[]): Promise<Market[]> {
  const r = await fetch(`${API_BASE}/admin/markets`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ markets }),
  })
  if (!r.ok) return fail(r, 'Could not save markets')
  return (await r.json()).markets ?? []
}

export async function getDomains(): Promise<Domain[]> {
  const r = await fetch(`${API_BASE}/admin/domains`, { credentials: 'include' })
  if (!r.ok) return fail(r, 'Could not load domains')
  return (await r.json()).domains ?? []
}

export async function putDomains(domains: Domain[]): Promise<Domain[]> {
  const r = await fetch(`${API_BASE}/admin/domains`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ domains }),
  })
  if (!r.ok) return fail(r, 'Could not save domains')
  return (await r.json()).domains ?? []
}
