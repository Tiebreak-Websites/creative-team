// CRM Email Builder — shell and campaign list.
//
// Same shape as the LP Builder: a dashboard of work, and an editor. Campaigns
// are grouped by entity kind, because a broker's mail and a white label's mail
// are different products carrying different compliance footers.

import { useEffect, useMemo, useState } from 'react'
import { CalendarClock, Link2, Loader2, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { listSections, type Language } from '@/lpBuilder/api'
import { ENTITY_KINDS, KIND_LABEL, kindOf, listBrands, type Brand } from '@/bannerBuilder/brandsApi'
import { Chip, Dashboard } from './Dashboard'
import { Editor } from './Editor'
import { ReadyQueueStrip, useReadyQueue } from '@/components/ReadyQueue'
import type { QueueTask } from '@/bannerBuilder/campaignApi'
import {
  createCampaign, crmQueue, deleteCampaign, getCampaign, listBlocks, listCampaigns,
  mondayItem, mondaySearch,
  type BlockDef, type Campaign, type CampaignSummary, type Layout,
  type MondayItem, type MondayPull,
} from './api'

type View = { kind: 'home' } | { kind: 'editor'; campaign: Campaign }

export function EmailBuilder() {
  const [view, setView] = useState<View>({ kind: 'home' })
  const [campaigns, setCampaigns] = useState<CampaignSummary[] | null>(null)
  const [blocks, setBlocks] = useState<BlockDef[]>([])
  const [layouts, setLayouts] = useState<Layout[]>([])
  const [brands, setBrands] = useState<Brand[]>([])
  const [languages, setLanguages] = useState<Language[]>([])
  const [error, setError] = useState<string | null>(null)
  // null = closed; otherwise the brand id the folder was opened from, so a
  // campaign created inside a folder lands in that folder.
  const [creating, setCreating] = useState<string | null>(null)
  // The Monday work queue — the SAME shared strip as Banner/LP (Mine/All +
  // priority tints), fed by the CRM board's "Ready for Builder" status.
  const { tasks: queueTasks, scope: queueScope, setScope: setQueueScope, meta: queueMeta } =
    useReadyQueue(crmQueue)

  const refresh = () => listCampaigns().then(setCampaigns).catch((e) => setError(e.message))

  useEffect(() => {
    refresh()
    listBlocks()
      .then((d) => { setBlocks(d.blocks); setLayouts(d.layouts) })
      .catch((e) => setError(e.message))
    listBrands().then(setBrands).catch(() => { /* the picker just stays empty */ })
    listSections().then((d) => setLanguages(d.languages)).catch(() => { /* ditto */ })
  }, [])

  const open = (id: string) =>
    getCampaign(id)
      .then((c) => setView({ kind: 'editor', campaign: c }))
      .catch((e) => setError(e.message))

  /** One click from a Monday task to a working campaign: the task's name,
   *  brand and layout, the snapshot attached — and always the English source
   *  first; the task's language list drives the variant fan-out later. */
  const startFromTask = (t: QueueTask) =>
    // The strip carries a light task row; pull the full Monday snapshot on click
    // so the new campaign prefills exactly as the old queue did.
    mondayItem(t.item.id)
      .then((full) =>
        createCampaign({
          name: full.item.name,
          brand_id: full.match.brand_id,
          language: 'en',
          layout: full.match.layout || undefined,
          monday_id: full.item.id,
          monday: full.item,
        }),
      )
      .then((c) => { setView({ kind: 'editor', campaign: c }); refresh() })
      .catch((e) => setError(e.message))

  if (view.kind === 'editor') {
    return (
      <div className="flex h-full flex-col">
        <ErrorBar message={error} onClose={() => setError(null)} />
        <div className="min-h-0 flex-1">
          <Editor
            campaign={view.campaign}
            blocks={blocks}
            brands={brands}
            languages={languages}
            onBack={() => { setView({ kind: 'home' }); refresh() }}
            onError={setError}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <ErrorBar message={error} onClose={() => setError(null)} />
      {queueMeta.allCount > 0 && (
        <ReadyQueueStrip
          label="Ready for Builder"
          tasks={queueTasks}
          scope={queueScope}
          linked={queueMeta.linked}
          mineCount={queueMeta.mineCount}
          allCount={queueMeta.allCount}
          onScopeChange={setQueueScope}
          onOpen={(t) => void startFromTask(t)}
        />
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Dashboard
          campaigns={campaigns}
          brands={brands}
          languages={languages}
          onOpen={open}
          onCreate={(brandId) => setCreating(brandId)}
          onChanged={refresh}
          onError={setError}
        />
      </div>

      {creating !== null && (
        <CreateModal
          brands={brands}
          languages={languages}
          layouts={layouts}
          initialBrandId={creating}
          onClose={() => setCreating(null)}
          onCreated={(c) => { setCreating(null); setView({ kind: 'editor', campaign: c }) }}
          onError={setError}
        />
      )}
    </div>
  )
}

function ErrorBar({ message, onClose }: { message: string | null; onClose: () => void }) {
  if (!message) return null
  return (
    <div className="flex items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">
      <span className="min-w-0 flex-1">{message}</span>
      <button type="button" onClick={onClose} aria-label="Dismiss">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

/** Schematic mini-preview of a layout — the abstract shape, the way every
 *  ESP's template picker draws them. Real previews would need a composed email
 *  per layout per brand; the wireframe answers the actual question (what order
 *  is the content in?) for free. */
function LayoutSketch({ blocks }: { blocks: string[] }) {
  return (
    <span className="flex h-full w-full flex-col items-center gap-[3px] overflow-hidden rounded-lg bg-secondary/60 p-2">
      {blocks.map((k, i) => {
        const key = k.replace('em-', '')
        if (key === 'logo-header') return <span key={i} className="h-1.5 w-8 shrink-0 rounded-sm bg-muted-foreground/40" />
        if (key === 'hero') return <span key={i} className="h-7 w-full shrink-0 rounded-sm bg-muted-foreground/25" />
        if (key === 'headline') return <span key={i} className="h-2 w-3/4 shrink-0 rounded-sm bg-foreground/60" />
        if (key === 'cta') return <span key={i} className="h-2.5 w-14 shrink-0 rounded-full bg-primary/70" />
        if (key === 'highlight') return <span key={i} className="h-5 w-full shrink-0 rounded-sm bg-primary/15" />
        if (key === 'support') return <span key={i} className="h-2 w-2/3 shrink-0 rounded-sm bg-muted-foreground/30" />
        if (key === 'signoff') return <span key={i} className="h-1 w-1/3 shrink-0 self-start rounded-sm bg-muted-foreground/30" />
        if (key === 'footer') return <span key={i} className="mt-auto h-2.5 w-full shrink-0 rounded-sm bg-muted-foreground/15" />
        /* body */ return <span key={i} className="h-1 w-full shrink-0 rounded-sm bg-muted-foreground/30" />
      })}
    </span>
  )
}

function CreateModal({
  brands, languages, layouts, initialBrandId, onClose, onCreated, onError,
}: {
  brands: Brand[]
  languages: Language[]
  layouts: Layout[]
  /** Preselected when the modal was opened from inside a brand's folder — a
   *  campaign started in a folder should land in that folder. */
  initialBrandId: string
  onClose: () => void
  onCreated: (c: Campaign) => void
  onError: (m: string) => void
}) {
  const [name, setName] = useState('')
  const [brandId, setBrandId] = useState(initialBrandId)
  const [language, setLanguage] = useState('en')
  const [subject, setSubject] = useState('')
  const [busy, setBusy] = useState(false)
  // Layout first, details second: the shape decides what you are writing, so
  // it is the first question — the same order every ESP asks in.
  const [layout, setLayout] = useState<string | null>(null)
  // ---- Monday pull: link the campaign to its Monday task and let
  // the task fill the form (name, brand, language) instead of re-typing it.
  const [monday, setMonday] = useState<MondayItem | null>(null)
  const [mQuery, setMQuery] = useState('')
  const [mResults, setMResults] = useState<MondayItem[] | null>(null)
  const [mBusy, setMBusy] = useState(false)
  const [mNote, setMNote] = useState<string | null>(null)

  const applyPull = (p: MondayPull) => {
    setMonday(p.item)
    setMResults(null)
    setMNote(null)
    setMQuery('')
    // Prefill, never clobber: anything already typed wins over the pull.
    if (!name.trim()) setName(p.item.name)
    if (p.match.brand_id) setBrandId(p.match.brand_id)
    // The task's "Layout #" label decides the starting shape.
    if (p.match.layout) setLayout(p.match.layout)
    // Campaigns ALWAYS start from the English source — the task's language
    // list is for the variant fan-out after the source is approved.
    setLanguage('en')
  }

  const pull = () => {
    const q = mQuery.trim()
    if (q.length < 2 || mBusy) return
    setMBusy(true)
    setMNote(null)
    const digits = /^\d+$/.test(q)
    ;(digits
      ? mondayItem(q).then(applyPull)
      : mondaySearch(q).then((items) => {
          setMResults(items)
          if (!items.length) setMNote('Nothing on the Monday board matches that.')
        })
    )
      .catch((e) => setMNote(e.message))
      .finally(() => setMBusy(false))
  }

  const pick = (id: string) => {
    setMBusy(true)
    mondayItem(id)
      .then(applyPull)
      .catch((e) => setMNote(e.message))
      .finally(() => setMBusy(false))
  }

  // A brand's declared languages narrow the picker — offering all 15 when the
  // brand sells in 3 invites a campaign nobody can send.
  const brand = brands.find((b) => b.id === brandId)
  const offered = useMemo(() => {
    const codes = brand?.languages ?? []
    return codes.length ? languages.filter((l) => codes.includes(l.code)) : languages
  }, [brand, languages])

  useEffect(() => {
    if (offered.length && !offered.some((l) => l.code === language)) setLanguage(offered[0].code)
  }, [offered, language])

  const submit = () => {
    if (!name.trim()) return
    setBusy(true)
    createCampaign({
      name: name.trim(), brand_id: brandId, language, subject: subject.trim(),
      layout: layout ?? undefined,
      monday_id: monday?.id, monday: monday ?? undefined,
    })
      .then(onCreated)
      .catch((e) => onError(e.message))
      .finally(() => setBusy(false))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {layout === null ? (
          <>
            <h2 className="font-display text-lg font-bold">New campaign</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Pick a starting layout — you can reorder, add and remove blocks after.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {layouts.map((l) => (
                <button
                  key={l.key}
                  type="button"
                  onClick={() => setLayout(l.key)}
                  className="group flex flex-col rounded-xl border border-border p-2 text-left transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-sm"
                >
                  <span className="h-32 w-full">
                    <LayoutSketch blocks={l.blocks} />
                  </span>
                  <span className="mt-2 font-display text-xs font-semibold">{l.name}</span>
                  <span className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
                    {l.description}
                  </span>
                </button>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
            </div>
          </>
        ) : (
          <>
        <h2 className="font-display text-lg font-bold">New campaign</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {layouts.find((l) => l.key === layout)?.name ?? 'Layout'} —{' '}
          <button type="button" className="text-primary underline-offset-2 hover:underline"
                  onClick={() => setLayout(null)}>
            change layout
          </button>
        </p>
        <div className="mt-4 space-y-3">
          {/* Monday pull — link the Monday task and it fills the form. */}
          <div className="rounded-xl border border-border bg-secondary/40 p-2.5">
            <Label htmlFor="nc-monday" className="text-xs">Monday task (optional)</Label>
            {monday ? (
              <div className="mt-1.5 flex items-start gap-2 rounded-lg border border-primary/40 bg-card px-2.5 py-2">
                <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="min-w-0 flex-1">
                  <a
                    href={monday.url} target="_blank" rel="noreferrer"
                    className="block truncate text-sm font-medium underline-offset-2 hover:underline"
                  >
                    {monday.name}
                  </a>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                    <span className="tabular-nums">#{monday.id}</span>
                    {monday.status && <Chip>{monday.status}</Chip>}
                    {monday.brand && <Chip>{monday.brand}</Chip>}
                    {monday.language && <Chip>{monday.language}</Chip>}
                    {monday.deadline && (
                      <Chip><CalendarClock className="h-2.5 w-2.5" /> {monday.deadline}</Chip>
                    )}
                  </span>
                  {monday.brief && (
                    <span className="mt-1 block text-[10px] leading-snug text-muted-foreground">
                      Brief attached — the AI hero generator will start from it.
                    </span>
                  )}
                </span>
                <button
                  type="button" aria-label="Unlink Monday task"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setMonday(null)}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <>
                <div className="mt-1 flex gap-1.5">
                  <Input
                    id="nc-monday" value={mQuery}
                    onChange={(e) => setMQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); pull() } }}
                    className="h-9" placeholder="Paste a Monday ID or search the board"
                  />
                  <Button
                    variant="outline" className="h-9 shrink-0"
                    disabled={mBusy || mQuery.trim().length < 2}
                    onClick={pull}
                  >
                    {mBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                    Pull
                  </Button>
                </div>
                {mResults && mResults.length > 0 && (
                  <div className="mt-1.5 max-h-40 space-y-1 overflow-y-auto">
                    {mResults.map((it) => (
                      <button
                        key={it.id} type="button" disabled={mBusy}
                        onClick={() => pick(it.id)}
                        className="flex w-full items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 text-left transition-colors hover:border-primary/50"
                      >
                        <span className="min-w-0 flex-1 truncate text-xs font-medium">{it.name}</span>
                        {it.brand && <Chip>{it.brand}</Chip>}
                        {it.language && <Chip>{it.language}</Chip>}
                        {it.status && <Chip>{it.status}</Chip>}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
            {/* Pull outcome notes — including a language the brand doesn't
                declare, which must stay visible next to the linked card. */}
            {mNote && <p className="mt-1.5 text-[10px] leading-snug text-amber-600 dark:text-amber-500">{mNote}</p>}
          </div>
          <div>
            <Label htmlFor="nc-name" className="text-xs">Campaign name</Label>
            <Input
              id="nc-name" value={name} autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              className="mt-1 h-9" placeholder="Welcome series — email 1"
            />
          </div>
          <div>
            <Label htmlFor="nc-brand" className="text-xs">Brand</Label>
            <select
              id="nc-brand" value={brandId}
              onChange={(e) => setBrandId(e.target.value)}
              className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-2 text-sm"
            >
              <option value="">No brand</option>
              {ENTITY_KINDS.map((kind) => {
                const items = brands.filter((b) => kindOf(b) === kind)
                if (!items.length) return null
                return (
                  <optgroup key={kind} label={KIND_LABEL[kind]}>
                    {items.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </optgroup>
                )
              })}
            </select>
            {brand && (
              <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
                {brand.regulation === 'eu'
                  ? 'EU-regulated — the footer will carry the CFD risk disclosure.'
                  : brand.regulation === 'international'
                  ? 'International — the footer will carry the general risk statement.'
                  : 'No regulation set on this brand, so no risk warning will be added.'}
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="nc-lang" className="text-xs">Language</Label>
            <select
              id="nc-lang" value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-2 text-sm"
            >
              {offered.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="nc-subject" className="text-xs">Subject line (optional)</Label>
            <Input
              id="nc-subject" value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="mt-1 h-9" placeholder="Can be written later"
            />
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !name.trim()}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Create
          </Button>
        </div>
          </>
        )}
      </div>
    </div>
  )
}
