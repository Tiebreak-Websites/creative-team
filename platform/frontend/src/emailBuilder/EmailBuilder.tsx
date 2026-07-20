// CRM Email Builder — shell and campaign list.
//
// Same shape as the LP Builder: a dashboard of work, and an editor. Campaigns
// are grouped by entity kind, because a broker's mail and a white label's mail
// are different products carrying different compliance footers.

import { useEffect, useMemo, useState } from 'react'
import { FilePlus2, Loader2, Mail, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { flagUrl } from '@/lib/flags'
import { listSections, type Language } from '@/lpBuilder/api'
import { ENTITY_KINDS, KIND_LABEL, kindOf, listBrands, type Brand } from '@/bannerBuilder/brandsApi'
import { Editor } from './Editor'
import {
  createCampaign, deleteCampaign, getCampaign, listBlocks, listCampaigns,
  type BlockDef, type Campaign, type CampaignSummary,
} from './api'

type View = { kind: 'home' } | { kind: 'editor'; campaign: Campaign }

export function EmailBuilder() {
  const [view, setView] = useState<View>({ kind: 'home' })
  const [campaigns, setCampaigns] = useState<CampaignSummary[] | null>(null)
  const [blocks, setBlocks] = useState<BlockDef[]>([])
  const [brands, setBrands] = useState<Brand[]>([])
  const [languages, setLanguages] = useState<Language[]>([])
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const refresh = () => listCampaigns().then(setCampaigns).catch((e) => setError(e.message))

  useEffect(() => {
    refresh()
    listBlocks().then(setBlocks).catch((e) => setError(e.message))
    listBrands().then(setBrands).catch(() => { /* the picker just stays empty */ })
    listSections().then((d) => setLanguages(d.languages)).catch(() => { /* ditto */ })
  }, [])

  const open = (id: string) =>
    getCampaign(id)
      .then((c) => setView({ kind: 'editor', campaign: c }))
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
    <div className="h-full overflow-y-auto">
      <ErrorBar message={error} onClose={() => setError(null)} />
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6 flex items-start gap-3 animate-fade-up">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight">CRM Emails</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Campaign emails built to render in Outlook and Gmail, with the risk warning
              set from each brand's regulation.
            </p>
          </div>
          <Button className="ml-auto shrink-0" onClick={() => setCreating(true)}>
            <FilePlus2 className="h-4 w-4" /> New campaign
          </Button>
        </div>

        {campaigns === null ? (
          <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : campaigns.length === 0 ? (
          <div className="animate-fade-up rounded-2xl border border-dashed border-border p-12 text-center">
            <Mail className="mx-auto h-7 w-7 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">No campaigns yet</p>
            <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
              A new campaign starts with the standard layout — logo, hero, headline, body,
              CTA and a compliance footer — ready to fill in.
            </p>
          </div>
        ) : (
          <CampaignGroups
            campaigns={campaigns}
            brands={brands}
            languages={languages}
            onOpen={open}
            onDeleted={refresh}
            onError={setError}
          />
        )}
      </div>

      {creating && (
        <CreateModal
          brands={brands}
          languages={languages}
          onClose={() => setCreating(false)}
          onCreated={(c) => { setCreating(false); setView({ kind: 'editor', campaign: c }) }}
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

/** Grouped by entity kind, mirroring the LP folder view. */
function CampaignGroups({
  campaigns, brands, languages, onOpen, onDeleted, onError,
}: {
  campaigns: CampaignSummary[]
  brands: Brand[]
  languages: Language[]
  onOpen: (id: string) => void
  onDeleted: () => void
  onError: (m: string) => void
}) {
  const brandById = useMemo(
    () => Object.fromEntries(brands.map((b) => [b.id, b])) as Record<string, Brand>,
    [brands],
  )

  const groups = useMemo(() => {
    const out: { label: string; items: CampaignSummary[] }[] = []
    for (const kind of ENTITY_KINDS) {
      const items = campaigns.filter((c) => {
        const b = brandById[c.brand_id]
        return b && kindOf(b) === kind
      })
      if (items.length) out.push({ label: KIND_LABEL[kind], items })
    }
    const orphans = campaigns.filter((c) => !brandById[c.brand_id])
    if (orphans.length) out.push({ label: 'No brand', items: orphans })
    return out
  }, [campaigns, brandById])

  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <section key={g.label}>
          <div className="mb-2 flex items-baseline gap-2 border-b border-border pb-1.5">
            <h2 className="font-display text-sm font-semibold">{g.label}</h2>
            <span className="rounded-full bg-secondary px-1.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
              {g.items.length}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {g.items.map((c) => (
              <CampaignCard
                key={c.id}
                c={c}
                brand={brandById[c.brand_id]}
                languages={languages}
                onOpen={() => onOpen(c.id)}
                onDeleted={onDeleted}
                onError={onError}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function CampaignCard({
  c, brand, languages, onOpen, onDeleted, onError,
}: {
  c: CampaignSummary
  brand?: Brand
  languages: Language[]
  onOpen: () => void
  onDeleted: () => void
  onError: (m: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const lang = languages.find((l) => l.code === c.language)
  const url = flagUrl(c.language)

  return (
    <div className="group overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
      <button type="button" onClick={onOpen} className="block w-full p-3 text-left">
        <p className="truncate font-display text-sm font-semibold" title={c.name}>{c.name}</p>
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={c.subject}>
          {c.subject || <span className="italic">No subject line yet</span>}
        </p>
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          {url && <img src={url} alt="" className="h-3 w-[18px] rounded-[2px] object-cover ring-1 ring-inset ring-black/10" />}
          <span>{lang?.label ?? c.language.toUpperCase()}</span>
          <span>·</span>
          <span>{c.blocks} blocks</span>
          {brand && <><span>·</span><span className="truncate">{brand.name}</span></>}
        </p>
      </button>
      <div className="flex items-center gap-1 border-t border-border px-2 py-1.5 opacity-0 transition-opacity group-hover:opacity-100">
        <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
          by {c.created_by || 'unknown'}
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          title={`Delete ${c.name}`}
          onClick={() => {
            if (!window.confirm(`Delete "${c.name}"? This cannot be undone.`)) return
            setBusy(true)
            deleteCampaign(c.id).then(onDeleted).catch((e) => onError(e.message)).finally(() => setBusy(false))
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}

function CreateModal({
  brands, languages, onClose, onCreated, onError,
}: {
  brands: Brand[]
  languages: Language[]
  onClose: () => void
  onCreated: (c: Campaign) => void
  onError: (m: string) => void
}) {
  const [name, setName] = useState('')
  const [brandId, setBrandId] = useState('')
  const [language, setLanguage] = useState('en')
  const [subject, setSubject] = useState('')
  const [busy, setBusy] = useState(false)

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
    createCampaign({ name: name.trim(), brand_id: brandId, language, subject: subject.trim() })
      .then(onCreated)
      .catch((e) => onError(e.message))
      .finally(() => setBusy(false))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-lg font-bold">New campaign</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Starts with the standard layout, ready to fill in.
        </p>
        <div className="mt-4 space-y-3">
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
      </div>
    </div>
  )
}
