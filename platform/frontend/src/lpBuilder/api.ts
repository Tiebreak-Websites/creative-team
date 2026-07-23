// API client for the LP Builder (sections library, projects, compose, export).

import { API_BASE as BASE, asJson } from '../http'
import { fetchReadyQueue, type QueueResult } from '../bannerBuilder/campaignApi'

const LPB = `${BASE}/tools/lp-builder`

/** The LP work queue: Ready-for-Design tasks (Landing Page / Prelander) not
 *  yet turned into a project — same shape/scoping as the banner queue. */
export function lpQueue(scope: 'mine' | 'all' = 'mine'): Promise<QueueResult> {
  return fetchReadyQueue(`${LPB}/queue`, scope)
}

export type Breakpoint = 'base' | 'tablet' | 'mobile'
export type Device = 'desktop' | 'tablet' | 'mobile'
export const DEVICE_WIDTH: Record<Device, number> = { desktop: 1920, tablet: 1199, mobile: 375 }
export const DEVICE_BUCKET: Record<Device, Breakpoint> = { desktop: 'base', tablet: 'tablet', mobile: 'mobile' }

export interface SectionField {
  kind: 'text' | 'rich' | 'img' | 'link'
  key: string
}

export interface SectionRepeat {
  key: string
  fields: SectionField[]
}

export interface SectionDef {
  key: string
  name: string
  category: string
  position: number
  enabled: boolean
  built_in: boolean
  languages: string[]
  fields: SectionField[]
  repeats: SectionRepeat[]
  /** What this block calls each slot, keyed by slot key ('q' -> 'Question').
   * Slot keys are never renamed (saved content is keyed by them), so this is
   * the display layer over them. Mirrors BRAINTRADE_ELEMENT_NAMES. */
  names?: Record<string, string>
  has_form: boolean
  html: string
  css: string
  texts: Record<string, Record<string, string>>
  assets: Record<string, string>
}

export interface Language {
  code: string
  label: string
}

/** One placed section instance on the page. */
export interface Instance {
  iid: string
  template_key: string
  texts: Record<string, string>
  images: Record<string, string>
  /** Mobile-only image overrides (≤575px swaps via <picture> in the compositor). */
  images_mobile?: Record<string, string>
  links: Record<string, string>
  repeats: Record<string, number>
  /** field key (or "_section") -> breakpoint -> prop -> css value */
  props: Record<string, Partial<Record<Breakpoint, Record<string, string | boolean>>>>
  /** Layer names from the Layers tree, keyed the same way it keys things:
   * a field key ('title', 'steps.1.icon') or a repeat item ('steps.1').
   * Exported as `data-name` on the matching element. */
  names?: Record<string, string>
}

export interface SeoSettings {
  og_title: string
  og_description: string
  og_image: string
  favicon: string
  canonical: string
  robots_index: boolean
}

export interface Project {
  id: string
  name: string
  brand_id: string
  language: string
  /** Monday.com item id (digits only) — the project's tracking key. */
  monday_id?: string
  /** The Monday item's name (creative name) — rides with the id. */
  monday_name?: string
  campaign_id: string
  sections: Instance[]
  tokens: Record<string, string>
  form: { action_url: string; success_url: string }
  fonts: 'system' | 'google'
  /** Google font applied to the WHOLE page ('' = template/system default).
   *  Optional on projects created before the font picker existed. */
  font_family?: string
  meta_title: string
  meta_description: string
  /** Optional on projects created before the SEO tab existed. */
  seo?: Partial<SeoSettings>
  /** Copywriter workflow: assignee email, copy status and the writing brief.
   *  Optional on projects saved before copywriter mode existed. */
  assigned_to?: string | null
  status?: 'draft' | 'copy_ready'
  brief?: string
  created_by: string
  created_at: string
  updated_at: string
}

export interface ProjectSummary {
  id: string
  name: string
  brand_id: string
  language: string
  monday_id?: string
  monday_name?: string
  campaign_id: string
  created_by: string
  created_at: string
  updated_at: string
  sections: number
  /** The page's own hero-ish image (first placed image) — the card cover. */
  cover_url?: string | null
  assigned_to?: string | null
  status?: 'draft' | 'copy_ready'
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

export async function listSections(all = false): Promise<{ sections: SectionDef[]; languages: Language[] }> {
  const r = await fetch(`${LPB}/sections${all ? '?all=1' : ''}`, { credentials: 'include' })
  if (!r.ok) return fail(r, 'Failed to load the section library')
  return r.json()
}

export interface GoogleFont {
  family: string
  category: string
}

/** The Google Fonts catalog for the page-font picker (server-cached). */
export async function listGoogleFonts(): Promise<GoogleFont[]> {
  const r = await fetch(`${LPB}/fonts`, { credentials: 'include' })
  if (!r.ok) return fail(r, 'Failed to load the font catalog')
  return (await r.json()).fonts ?? []
}

/** Template icon library (bundled SVGs) — assignable to any image slot. */
export async function listLpIcons(): Promise<{ name: string; url: string }[]> {
  const r = await fetch(`${LPB}/icons`, { credentials: 'include' })
  if (!r.ok) return fail(r, 'Failed to load the icon library')
  return (await r.json()).icons ?? []
}

export async function createSection(payload: {
  key: string
  name: string
  category?: string
  clone_of?: string
}): Promise<SectionDef> {
  const r = await fetch(`${LPB}/sections`, { method: 'POST', headers: j, credentials: 'include', body: JSON.stringify(payload) })
  if (!r.ok) return fail(r, 'Could not create the section')
  return r.json()
}

export async function updateSection(key: string, patch: Partial<SectionDef>): Promise<SectionDef> {
  const r = await fetch(`${LPB}/sections/${key}`, { method: 'PUT', headers: j, credentials: 'include', body: JSON.stringify(patch) })
  if (!r.ok) return fail(r, 'Could not save the section')
  return r.json()
}

export async function deleteSection(key: string): Promise<void> {
  const r = await fetch(`${LPB}/sections/${key}`, { method: 'DELETE', credentials: 'include' })
  if (!r.ok && r.status !== 204) return fail(r, 'Could not delete the section')
}

export async function putLanguages(languages: Language[]): Promise<Language[]> {
  const r = await fetch(`${LPB}/languages`, { method: 'PUT', headers: j, credentials: 'include', body: JSON.stringify({ languages }) })
  if (!r.ok) return fail(r, 'Could not save languages')
  return (await r.json()).languages
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const r = await fetch(`${LPB}/projects`, { credentials: 'include' })
  if (!r.ok) return fail(r, 'Failed to load landing pages')
  return (await r.json()).projects ?? []
}

export async function createProject(payload: {
  name: string
  brand_id?: string
  language: string
  monday_id?: string
  monday_name?: string
  tokens?: Record<string, string>
  assigned_to?: string
}): Promise<Project> {
  const r = await fetch(`${LPB}/projects`, { method: 'POST', headers: j, credentials: 'include', body: JSON.stringify(payload) })
  if (!r.ok) return fail(r, 'Could not create the landing page')
  return r.json()
}

export async function getProject(id: string): Promise<Project> {
  const r = await fetch(`${LPB}/projects/${id}`, { credentials: 'include' })
  if (!r.ok) return fail(r, 'Could not load the landing page')
  return r.json()
}

export async function saveProject(p: Project): Promise<Project> {
  const r = await fetch(`${LPB}/projects/${p.id}`, { method: 'PUT', headers: j, credentials: 'include', body: JSON.stringify(p) })
  if (!r.ok) return fail(r, 'Could not save')
  return r.json()
}

export async function duplicateProject(id: string, opts?: { language?: string; name?: string }): Promise<Project> {
  const r = await fetch(`${LPB}/projects/${id}/duplicate`, { method: 'POST', headers: j, credentials: 'include', body: JSON.stringify(opts ?? {}) })
  if (!r.ok) return fail(r, 'Could not duplicate')
  return r.json()
}

export async function deleteProject(id: string): Promise<void> {
  const r = await fetch(`${LPB}/projects/${id}`, { method: 'DELETE', credentials: 'include' })
  if (!r.ok && r.status !== 204) return fail(r, 'Could not delete')
}

export async function composePage(
  project: Project,
  mode: 'editor' | 'preview',
  draftSection?: Partial<SectionDef> & { key: string },
  /** writer_mode: copywriter editor — structure + text stay editable, image/link
   *  selection and asset drops are suppressed. */
  opts?: { writer_mode?: boolean },
): Promise<string> {
  const r = await fetch(`${LPB}/compose`, {
    method: 'POST', headers: j, credentials: 'include',
    body: JSON.stringify({
      project, mode, draft_section: draftSection,
      ...(opts?.writer_mode ? { writer_mode: true } : {}),
    }),
  })
  if (!r.ok) return fail(r, 'Could not render the page')
  return (await r.json()).html
}

export async function uploadLpAsset(file: File): Promise<{ id: string; url: string }> {
  const fd = new FormData()
  fd.append('file', file)
  const r = await fetch(`${LPB}/assets`, { method: 'POST', credentials: 'include', body: fd })
  if (!r.ok) return fail(r, 'Upload failed')
  return r.json()
}

/** Copy a sibling-tool image (LP Materials / banner) into the LP asset store
 * so exports can bundle it. Returns the local asset. */
export async function importLpAsset(url: string): Promise<{ id: string; url: string }> {
  const r = await fetch(`${LPB}/assets/import`, { method: 'POST', headers: j, credentials: 'include', body: JSON.stringify({ url }) })
  if (!r.ok) return fail(r, 'Could not import that image')
  return r.json()
}

// ---------------------------------------------------------------------------
// Copywriter mode — assignment + one-shot AI copy jobs.
// ---------------------------------------------------------------------------
export interface Writer {
  email: string
  name: string
}

/** Users with the copywriter role — the "Assign to…" sources. */
export async function getWriters(): Promise<Writer[]> {
  const r = await fetch(`${LPB}/writers`, { credentials: 'include' })
  if (!r.ok) return fail(r, 'Failed to load copywriters')
  return (await r.json()).writers ?? []
}

export interface LpCopyJob {
  id: string
  project_id: string
  status: 'queued' | 'running' | 'done' | 'error'
  error: string | null
  rewrote_iids: string[]
  meta_written: boolean
}

/** Start the one-shot page-copy job. A 409 means one is ALREADY running for
 * this project — its id comes back so the caller simply resumes polling it. */
export async function generateLpCopy(payload: {
  project_id: string
  brief: string
  sections: { iid: string; mode: 'rewrite' | 'keep' }[]
  include_meta?: boolean
}): Promise<{ job_id: string }> {
  const r = await fetch(`${LPB}/copy/generate`, {
    method: 'POST', headers: j, credentials: 'include', body: JSON.stringify(payload),
  })
  if (r.status === 409) {
    const body = await asJson(r)
    const id = body?.detail?.job_id
    if (id) return { job_id: id }
  }
  if (r.status === 424) throw new Error("AI writing isn't configured on this server yet.")
  if (!r.ok) return fail(r, 'Could not start the AI writer')
  return r.json()
}

export async function getLpCopyJob(id: string): Promise<LpCopyJob> {
  const r = await fetch(`${LPB}/copy/jobs/${id}`, { credentials: 'include' })
  if (!r.ok) return fail(r, 'Could not check the writing job')
  return (await r.json()).job
}

/** Put one section's pre-AI text back (then re-fetch the project + recompose). */
export async function restoreLpCopySection(jobId: string, iid: string): Promise<void> {
  const r = await fetch(`${LPB}/copy/jobs/${jobId}/restore`, {
    method: 'POST', headers: j, credentials: 'include', body: JSON.stringify({ iid }),
  })
  if (!r.ok) return fail(r, 'Could not restore the previous text')
}

export async function downloadExportZip(p: Project): Promise<void> {
  const r = await fetch(`${LPB}/projects/${p.id}/export.zip`, { credentials: 'include' })
  if (!r.ok) return fail(r, 'Export failed')
  const blob = await r.blob()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${(p.name || 'landing-page').replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}.zip`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(a.href)
}

/** Map a brand from the brands store onto the LP design tokens. Brands may
 * carry explicit landing-page hints (`lp.bg` website background, `lp.card`
 * card fill — e.g. BrainTrade ships #FBFBFB / #FFFFFF). */
export function brandTokens(brand: {
  colors: string[]
  logo_svg?: string | null
  logo_wide?: string | null
  font?: string | null
  lp?: { bg?: string; card?: string }
  tokens?: Record<string, string> | null
  typography?: {
    heading_font?: string
    body_font?: string
    scale?: Record<string, { size?: number; weight?: number; line?: number }>
  } | null
}): Record<string, string> {
  const [c1, c2, c3] = brand.colors || []
  // An explicitly set token always wins. The palette-position fallbacks below
  // are what every brand relied on before the token editor existed, so brands
  // that haven't been given tokens keep rendering exactly as they did.
  // Logos are deliberately NOT emitted here. They used to be inlined as data
  // URIs, and a >6KB logo hit the 6000-char token cap on save and shipped a
  // data URI cut off mid-path — a broken <img>. compose_page() now reads them
  // straight from the brand registry, so the page always shows the CURRENT
  // logo and nothing large is ever stored on the project.
  const t = brand.tokens || {}
  const primary = t.primary || c1 || '#E71E25'
  const out: Record<string, string> = {
    primary,
    accent: t.accent || c2 || '#0A0F2E',
    // The CTA used to be hardwired to primary with white text, so those stay
    // the defaults — set them to give the button its own colour.
    cta: t.cta || primary,
    'cta-text': t['cta_text'] || '#FFFFFF',
    bg: t.bg || brand.lp?.bg || '#FFFFFF',
    surface: t.surface || c3 || '#F4F6FB',
    card: t.card || brand.lp?.card || '#FFFFFF',
    text: t.text || '#0B1220',
    muted: t.muted || '#5B6472',
  }

  // Type scale -> --lp-<role>-size / -weight / -line. Existing sections hardcode
  // their own sizes and ignore these; they're here for templates that opt in.
  const ty = brand.typography || {}
  if (ty.heading_font) out['font-heading'] = ty.heading_font
  if (ty.body_font) out['font-body'] = ty.body_font
  for (const [role, spec] of Object.entries(ty.scale || {})) {
    if (spec?.size != null) out[`${role}-size`] = `${spec.size}px`
    if (spec?.weight != null) out[`${role}-weight`] = String(spec.weight)
    if (spec?.line != null) out[`${role}-line`] = String(spec.line)
  }
  return out
}
