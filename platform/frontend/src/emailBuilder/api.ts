// API client for the CRM Email Builder.
//
// Mirrors lpBuilder/api.ts, with one deliberate difference: there is no
// `tokens` mapping helper here. Email colours are resolved to literal hex by
// the BACKEND compositor, because Outlook cannot read CSS custom properties —
// so unlike the LP builder, the frontend never computes a token set.

import { API_BASE as BASE, asJson } from '../http'

const EB = `${BASE}/tools/email-builder`

export interface BlockField {
  kind: 'text' | 'rich' | 'img' | 'link'
  key: string
}

export interface BlockDef {
  key: string
  name: string
  /** Which of the three stacked tables the block renders into:
   *  'header' above the card, 'card' inside it, 'footer' below it.
   *  Reordering is constrained to within a zone — a card block cannot move
   *  above the logo, because it physically cannot render there. */
  zone: 'header' | 'card' | 'footer'
  category: string
  position: number
  enabled: boolean
  built_in: boolean
  html: string
  texts: Record<string, Record<string, string>>
  assets: Record<string, string>
  /** Display name per slot key ('cta_label' -> 'Button label'). */
  names: Record<string, string>
  fields: BlockField[]
  /** Which {{token}} placeholders the block references. */
  tokens_used: string[]
}

/** One placed block in a campaign. */
export interface BlockInstance {
  iid: string
  block_key: string
  texts: Record<string, string>
  images: Record<string, string>
  links: Record<string, string>
  /** Spacing overrides in px: pad_top / pad_bottom on the block's outer cell. */
  props?: Record<string, string>
}

export interface Campaign {
  id: string
  /** '' for a parent, the parent's id for a language variant. Authoring is
   *  one level deep: a campaign is written once and translated outward. */
  parent_id: string
  /** Monday.com item id — each variant is tracked as its own Monday item. */
  monday_id: string
  /** Draft until someone approves it. The UI calls this Approved/Draft; the
   *  field keeps its original name so stored campaigns need no migration.
   *  Campaigns are never deleted, only un-approved — a sent campaign is a
   *  record, not a scratch file. */
  active: boolean
  name: string
  subject: string
  preheader: string
  brand_id: string
  language: string
  sections: BlockInstance[]
  tokens: Record<string, string>
  created_by: string
  created_at: string
  updated_at: string
}

export interface CampaignSummary {
  id: string
  parent_id: string
  monday_id: string
  active: boolean
  /** How many language variants hang off this one (parents only). */
  variants: number
  name: string
  subject: string
  brand_id: string
  language: string
  created_by: string
  created_at: string
  updated_at: string
  blocks: number
}

export interface Composed {
  html: string
  text: string
  size_bytes: number
  /** Deliverability problems worth surfacing before a send — size against
   *  Gmail's clip limit, empty image slots, a missing footer. */
  warnings: string[]
}

async function fail(r: Response, fallback: string): Promise<never> {
  const body = await asJson(r)
  const message =
    (typeof body.detail === 'string' && body.detail) ||
    (typeof body.error === 'string' && body.error) ||
    `${fallback} (HTTP ${r.status}).`
  throw new Error(message)
}

const j = { 'Content-Type': 'application/json' }

/** A starting shape for a new campaign — a named sequence of block keys. */
export interface Layout {
  key: string
  name: string
  description: string
  blocks: string[]
}

export async function listBlocks(all = false): Promise<{ blocks: BlockDef[]; layouts: Layout[] }> {
  const r = await fetch(`${EB}/blocks${all ? '?all=1' : ''}`, { credentials: 'include' })
  if (!r.ok) return fail(r, 'Failed to load the block library')
  const d = await r.json()
  return { blocks: d.blocks ?? [], layouts: d.layouts ?? [] }
}

export async function listCampaigns(): Promise<CampaignSummary[]> {
  const r = await fetch(`${EB}/campaigns`, { credentials: 'include' })
  if (!r.ok) return fail(r, 'Failed to load campaigns')
  return (await r.json()).campaigns ?? []
}

export async function createCampaign(payload: {
  name: string
  brand_id?: string
  language?: string
  subject?: string
  monday_id?: string
  /** Layout key from listBlocks().layouts — which shape to seed. */
  layout?: string
}): Promise<Campaign> {
  const r = await fetch(`${EB}/campaigns`, {
    method: 'POST', headers: j, credentials: 'include', body: JSON.stringify(payload),
  })
  if (!r.ok) return fail(r, 'Could not create the campaign')
  return r.json()
}

export async function getCampaign(id: string): Promise<Campaign> {
  const r = await fetch(`${EB}/campaigns/${id}`, { credentials: 'include' })
  if (!r.ok) return fail(r, 'Could not load the campaign')
  return r.json()
}

export async function saveCampaign(c: Campaign): Promise<Campaign> {
  const r = await fetch(`${EB}/campaigns/${c.id}`, {
    method: 'PUT', headers: j, credentials: 'include', body: JSON.stringify(c),
  })
  if (!r.ok) return fail(r, 'Could not save')
  return r.json()
}

/** Flip Approved/Draft without loading the whole campaign. */
export async function setCampaignActive(id: string, active: boolean): Promise<void> {
  const r = await fetch(`${EB}/campaigns/${id}`, {
    method: 'PUT', headers: j, credentials: 'include', body: JSON.stringify({ active }),
  })
  if (!r.ok) return fail(r, 'Could not update the campaign')
}

export async function deleteCampaign(id: string): Promise<void> {
  const r = await fetch(`${EB}/campaigns/${id}`, { method: 'DELETE', credentials: 'include' })
  if (!r.ok && r.status !== 204) return fail(r, 'Could not delete')
}

/** Compose the campaign to final email HTML + plain-text alternative. */
export async function composeEmail(campaign: Campaign): Promise<Composed> {
  const r = await fetch(`${EB}/compose`, {
    method: 'POST', headers: j, credentials: 'include',
    body: JSON.stringify({ project: campaign }),
  })
  if (!r.ok) return fail(r, 'Could not render the email')
  return r.json()
}

/** Fan a parent out into one campaign per language. Each variant is a full
 *  copy — translation edits the copy, so a later parent tweak cannot silently
 *  rewrite copy already signed off in nine languages. */
export async function createVariants(
  id: string, languages: string[],
): Promise<{ created: Campaign[]; skipped: string[] }> {
  const r = await fetch(`${EB}/campaigns/${id}/variants`, {
    method: 'POST', headers: j, credentials: 'include',
    body: JSON.stringify({ languages }),
  })
  if (!r.ok) return fail(r, 'Could not create the variants')
  return r.json()
}

/** Composed HTML for a dashboard card thumbnail. Its own route so the list
 *  response doesn't carry a composed email per campaign. */
export async function campaignThumb(id: string): Promise<string> {
  const r = await fetch(`${EB}/campaigns/${id}/thumb`, { credentials: 'include' })
  if (!r.ok) return fail(r, 'Could not render the thumbnail')
  return (await r.json()).html ?? ''
}

/** AI hero image — art-director pass + image model, styled from the brand's
 *  Settings. `direction` is the art direction actually used, for transparency. */
export async function generateHeroImage(payload: {
  brand_id: string
  brief: string
  with_text: boolean
  headline?: string
  subtitle?: string
}): Promise<{ id: string; url: string; direction: string }> {
  const r = await fetch(`${EB}/hero/generate`, {
    method: 'POST', headers: j, credentials: 'include', body: JSON.stringify(payload),
  })
  if (!r.ok) {
    const body = await asJson(r)
    const detail = body.detail
    if (r.status === 424) throw new Error('OPENAI_API_KEY is not configured on this server.')
    throw new Error(
      (typeof detail === 'string' && detail) || 'Could not generate the image.')
  }
  return r.json()
}

export async function uploadEmailAsset(file: File): Promise<{ id: string; url: string }> {
  const fd = new FormData()
  fd.append('file', file)
  const r = await fetch(`${EB}/assets`, { method: 'POST', credentials: 'include', body: fd })
  if (!r.ok) return fail(r, 'Upload failed')
  return r.json()
}

/** Gmail hides everything past ~102KB behind "View entire message" — including
 *  the unsubscribe link. Surfaced in the editor as a live budget. */
export const SIZE_LIMIT = 102_000
export const SIZE_WARN = 90_000
