// CRM Email Builder — shell and campaign list.
//
// Same shape as the LP Builder: a dashboard of work, and an editor. Campaigns
// are grouped by entity kind, because a broker's mail and a white label's mail
// are different products carrying different compliance footers.

import { useEffect, useMemo, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { listSections, type Language } from '@/lpBuilder/api'
import { ENTITY_KINDS, KIND_LABEL, kindOf, listBrands, type Brand } from '@/bannerBuilder/brandsApi'
import { Dashboard } from './Dashboard'
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
  // null = closed; otherwise the brand id the folder was opened from, so a
  // campaign created inside a folder lands in that folder.
  const [creating, setCreating] = useState<string | null>(null)

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
      <Dashboard
        campaigns={campaigns}
        brands={brands}
        languages={languages}
        onOpen={open}
        onCreate={(brandId) => setCreating(brandId)}
        onChanged={refresh}
        onError={setError}
      />

      {creating !== null && (
        <CreateModal
          brands={brands}
          languages={languages}
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

function CreateModal({
  brands, languages, initialBrandId, onClose, onCreated, onError,
}: {
  brands: Brand[]
  languages: Language[]
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
