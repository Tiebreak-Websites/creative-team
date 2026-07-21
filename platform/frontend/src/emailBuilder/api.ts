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

/** A Monday.com language subtask — each language variant is its own item. */
export interface MondaySubitem {
  id: string
  name: string
  status?: string
  language?: string
  brand?: string
  asset_type?: string
  topic?: string
}

/** A Monday.com task as the builder sees it — normalized from the CRM Tasks
 *  board's columns by the backend. */
export interface MondayItem {
  id: string
  name: string
  url: string
  board?: string
  group?: string
  status?: string
  priority?: string
  /** CRM board's Type column — WTL, ACQ/RND, RTN, Dormant… */
  type?: string
  asset_type?: string
  brand?: string
  /** Brand_LANG segment labels, comma-joined ("Tradit_EN, Tradit_IT"). */
  label?: string
  white_label?: string
  language?: string
  /** The task's language list, comma-joined as Monday sends it ("EN, IT"). */
  languages?: string
  /** The board's "Layout #" label — e.g. "Classic promo". */
  layout_label?: string
  market?: string
  deadline?: string
  start_date?: string
  brief?: string
  topic?: string
  figma_url?: string
  requestor?: string
  owner?: string
  subitems?: MondaySubitem[]
}

export interface Campaign {
  id: string
  /** '' for a parent, the parent's id for a language variant. Authoring is
   *  one level deep: a campaign is written once and translated outward. */
  parent_id: string
  /** Monday.com item id — each variant is tracked as its own Monday item. */
  monday_id: string
  /** Snapshot of the linked Monday task at pull time — prefill source and
   *  provenance, not a live mirror. */
  monday?: MondayItem | null
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
    // Dormant features answer 424 with detail: {missing_secrets, error} —
    // the .error sentence is the human-readable half.
    (typeof body.detail?.error === 'string' && body.detail.error) ||
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
  /** The pulled Monday task — stored on the campaign as its snapshot. */
  monday?: MondayItem
  /** Layout key from listBlocks().layouts — which shape to seed. */
  layout?: string
}): Promise<Campaign> {
  const r = await fetch(`${EB}/campaigns`, {
    method: 'POST', headers: j, credentials: 'include', body: JSON.stringify(payload),
  })
  if (!r.ok) return fail(r, 'Could not create the campaign')
  return r.json()
}

/** What the builder should prefill from a pulled Monday task — the item plus
 *  its labels resolved into builder vocabulary: a brand id, a layout key,
 *  and the task's language list as builder codes (for the variant fan-out;
 *  campaigns themselves always start in English). */
export interface MondayPull {
  item: MondayItem
  match: { brand_id: string; language: string; languages: string[]; layout: string }
}

export async function mondayItem(id: string): Promise<MondayPull> {
  const r = await fetch(`${EB}/monday/item/${encodeURIComponent(id.trim())}`,
    { credentials: 'include' })
  if (!r.ok) return fail(r, 'Could not pull the Monday task')
  return r.json()
}

/** The work queue: CRM tasks with Status "Ready for design". */
export async function mondayReady(): Promise<MondayPull[]> {
  const r = await fetch(`${EB}/monday/ready`, { credentials: 'include' })
  if (!r.ok) return fail(r, 'Could not load the Monday queue')
  return (await r.json()).tasks ?? []
}

export async function mondaySearch(q: string): Promise<MondayItem[]> {
  const r = await fetch(`${EB}/monday/search?q=${encodeURIComponent(q.trim())}`,
    { credentials: 'include' })
  if (!r.ok) return fail(r, 'Monday search failed')
  return (await r.json()).items ?? []
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

/** A background generation job. The pipeline runs server-side and writes its
 *  result into the campaign there — refresh or navigate away freely; polling
 *  is only how the page SHOWS progress, not what keeps the job alive. */
export interface GenJob {
  id: string
  kind: string
  campaign_id: string
  iid: string
  status: 'running' | 'done' | 'failed'
  error: string | null
  result: { value: string; url: string; direction: string; applied?: boolean } | null
  created_at: string
}

export async function generateHeroImage(payload: {
  brand_id: string
  campaign_id: string
  iid: string
  brief: string
  with_text: boolean
  headline?: string
  subtitle?: string
  visual_style?: 'auto' | 'photo' | 'illustration' | 'render3d'
  people?: 'any' | 'none'
  avoid?: string
  direction_override?: string
}): Promise<GenJob> {
  const r = await fetch(`${EB}/hero/generate`, {
    method: 'POST', headers: j, credentials: 'include', body: JSON.stringify(payload),
  })
  if (!r.ok) {
    const body = await asJson(r)
    if (r.status === 424) throw new Error('OPENAI_API_KEY is not configured on this server.')
    throw new Error(
      (typeof body.detail === 'string' && body.detail) || 'Could not start the generation.')
  }
  return r.json()
}

export async function getHeroJob(id: string): Promise<GenJob> {
  const r = await fetch(`${EB}/hero/jobs/${id}`, { credentials: 'include' })
  if (!r.ok) return fail(r, 'Could not check the generation')
  return r.json()
}

/** Jobs for a campaign — how a freshly-loaded page finds a generation that a
 *  previous page started. */
export async function listHeroJobs(campaignId: string): Promise<GenJob[]> {
  const r = await fetch(`${EB}/hero/jobs?campaign_id=${encodeURIComponent(campaignId)}`,
    { credentials: 'include' })
  if (!r.ok) return fail(r, 'Could not check generations')
  return (await r.json()).jobs ?? []
}

// ---------------------------------------------------------------- AI copy

/** The house copywriter's output: subject A/B variants, the pre-header, and one
 *  value per filled block field (mapped back onto the campaign server-side, so a
 *  finished job has already updated the blocks). */
export interface CopyResult {
  subjects: string[]
  preheader: string
  items: { iid: string; key: string; value: string }[]
  segment: 'REG' | 'NONREG' | 'NONE'
  tier: 'Retail' | 'Pro'
  applied?: boolean
}

export interface CopyJob {
  id: string
  kind: string
  campaign_id: string
  iid: string
  status: 'running' | 'done' | 'failed'
  error: string | null
  result: CopyResult | null
  created_at: string
}

export async function generateCopy(payload: {
  campaign_id: string
  brief: string
  /** '' lets the brand's regulation decide; explicit REG/NONREG/NONE overrides. */
  segment?: 'REG' | 'NONREG' | 'NONE' | ''
  tier?: 'Retail' | 'Pro'
}): Promise<CopyJob> {
  const r = await fetch(`${EB}/copy/generate`, {
    method: 'POST', headers: j, credentials: 'include', body: JSON.stringify(payload),
  })
  if (!r.ok) {
    const body = await asJson(r)
    if (r.status === 424) throw new Error('OPENAI_API_KEY is not configured on this server.')
    throw new Error(
      (typeof body.detail === 'string' && body.detail) || 'Could not start copy generation.')
  }
  return r.json()
}

export async function getCopyJob(id: string): Promise<CopyJob> {
  const r = await fetch(`${EB}/copy/jobs/${id}`, { credentials: 'include' })
  if (!r.ok) return fail(r, 'Could not check copy generation')
  return r.json()
}

export async function listCopyJobs(campaignId: string): Promise<CopyJob[]> {
  const r = await fetch(`${EB}/copy/jobs?campaign_id=${encodeURIComponent(campaignId)}`,
    { credentials: 'include' })
  if (!r.ok) return fail(r, 'Could not check copy generations')
  return (await r.json()).jobs ?? []
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
